import Foundation
import AVFoundation
import CoreMedia
import CryptoKit
import UIKit

// Recursively enumerates audio files under the connected root and builds the same
// LibraryModel the desktop app produces (src/shared/models.ts): a flat track list
// plus playlists derived from the first path segment under the root.
//
// Phase 2: unchanged files (path+mtime+size) are served from LibraryCache with NO
// AVFoundation parse — relaunch scans are near-instant. Artwork is written once to
// disk (LibraryCache.thumbsDir) and served from there by the cover:// handler.
// Progress is reported through a callback so the plugin can stream scanProgress
// events to the renderer.
enum LibraryScanner {

    static let LOOSE_ID = "__root__"
    static let LOOSE_NAME = "Loose Tracks"

    static let audioExts: Set<String> = [
        "mp3", "m4a", "aac", "wav", "flac", "aiff", "aif", "aifc", "opus", "ogg", "oga", "caf", "alac"
    ]
    // WebKit on iOS can't decode these — flagged so the UI shows a "Can't play" badge
    // and playback navigation skips them (mirrors the desktop codec gate).
    static let unsupportedExts: Set<String> = ["opus", "ogg", "oga"]

    /// Mirrors ScanProgress in src/shared/models.ts.
    typealias Progress = (_ scanned: Int, _ total: Int, _ done: Bool, _ phase: String) -> Void

    /// One parsed file: the JSON-ready track dict.
    typealias TrackResult = [String: Any]

    static func trackId(forPath path: String) -> String {
        let digest = SHA256.hash(data: Data(path.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// True when the file's bytes are on device. iCloud Drive (CloudStorage) files
    /// can be "dataless" — real name + metadata present, content not downloaded.
    /// Reads on dataless files block while the system materializes them (or fail),
    /// so the scanner must not hand them to AVFoundation.
    static func isMaterializedLocally(_ url: URL) -> Bool {
        guard let v = try? url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey]),
              v.isUbiquitousItem == true,
              let status = v.ubiquitousItemDownloadingStatus else { return true }
        return status == .current || status == .downloaded
    }

    static func scan(root: URL, rootName: String, progress: Progress? = nil) async -> [String: Any] {
        let rootPath = root.standardizedFileURL.path
        LibraryCache.shared.beginScan()

        let fileURLs = enumerateAudioFiles(under: root) { found in
            progress?(found, 0, false, "walking")
        }
        progress?(0, fileURLs.count, false, "parsing")

        var tracks: [TrackResult] = []
        tracks.reserveCapacity(fileURLs.count)

        // Bounded concurrency: parse in batches so we don't open hundreds of AVAssets at once.
        var parsed = 0
        for batch in fileURLs.chunked(into: 8) {
            let results: [TrackResult] = await withTaskGroup(of: TrackResult?.self) { group in
                for url in batch {
                    group.addTask { await buildTrack(url: url, rootPath: rootPath) }
                }
                var arr: [TrackResult] = []
                for await r in group { if let r { arr.append(r) } }
                return arr
            }
            tracks.append(contentsOf: results)
            parsed += batch.count
            progress?(parsed, fileURLs.count, false, "parsing")
        }

        let liveIds = Set(tracks.compactMap { $0["id"] as? String })
        LibraryCache.shared.endScan(liveTrackIds: liveIds)
        progress?(fileURLs.count, fileURLs.count, true, "done")

        let playlists = buildPlaylists(from: tracks, rootPath: rootPath)
        return [
            "root": rootPath,
            "rootName": rootName,
            "playlists": playlists,
            "tracks": tracks,
            "scanning": false
        ]
    }

    // MARK: - enumeration

    private static func enumerateAudioFiles(under root: URL, onFound: ((Int) -> Void)? = nil) -> [URL] {
        let fm = FileManager.default
        let keys: [URLResourceKey] = [.isRegularFileKey]
        var out: [URL] = []
        guard let en = fm.enumerator(at: root,
                                     includingPropertiesForKeys: keys,
                                     options: [.skipsHiddenFiles, .skipsPackageDescendants],
                                     errorHandler: nil) else { return out }
        for case let url as URL in en {
            guard audioExts.contains(url.pathExtension.lowercased()) else { continue }
            if let vals = try? url.resourceValues(forKeys: [.isRegularFileKey]), vals.isRegularFile == true {
                out.append(url)
                if out.count % 50 == 0 { onFound?(out.count) }
            }
        }
        return out
    }

    // MARK: - per-file track

    private static func buildTrack(url: URL, rootPath: String) async -> TrackResult? {
        let path = url.standardizedFileURL.path
        let id = trackId(forPath: path)
        let ext = url.pathExtension.lowercased()

        let rv = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let mtimeMs = (rv?.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000.0
        let size = rv?.fileSize ?? 0

        let (playlistId, _) = playlistInfo(path: path, rootPath: rootPath)

        // Cache hit → no AVFoundation, no thumbnail work (the thumb is already on disk).
        // Note this also covers files the system later EVICTED: their cached metadata
        // and thumb stay valid, and playing one re-materializes it on demand.
        if let cached = LibraryCache.shared.lookup(path: path, mtimeMs: mtimeMs, size: size) {
            return trackDict(id: id, path: path, mtimeMs: mtimeMs, size: size, ext: ext,
                             playlistId: playlistId, title: cached.title, artist: cached.artist,
                             album: cached.album, durationSec: cached.durationSec, hasArt: cached.hasArt)
        }

        // Online-only iCloud file we've never parsed: AVFoundation would block on the
        // network for each one. List it by filename instead; playing it triggers the
        // download (media handler). Deliberately NOT cached, so a rescan after it
        // downloads parses the real metadata.
        if !isMaterializedLocally(url) {
            return trackDict(id: id, path: path, mtimeMs: mtimeMs, size: size, ext: ext,
                             playlistId: playlistId,
                             title: url.deletingPathExtension().lastPathComponent,
                             artist: "", album: "", durationSec: nil, hasArt: false)
        }

        var title: String?
        var artist: String?
        var album: String?
        var durationSec: Double?
        var artData: Data?

        if #available(iOS 16.0, *) {
            let asset = AVURLAsset(url: url)
            // Batch-load both properties in one round-trip (Apple-recommended).
            if let (d, meta) = try? await asset.load(.duration, .commonMetadata) {
                let s = CMTimeGetSeconds(d)
                if s.isFinite && s > 0 { durationSec = s }
                title = await stringMeta(meta, .commonIdentifierTitle)
                artist = await stringMeta(meta, .commonIdentifierArtist)
                album = await stringMeta(meta, .commonIdentifierAlbumName)
                artData = await artworkMeta(meta)
            }
            // Some MP3/ID3 and iTunes files carry cover art outside common metadata.
            if artData == nil, let all = try? await asset.load(.metadata) {
                artData = await artworkFallback(all)
            }
        }

        // Persist artwork as a JPEG thumb; hasArt = the write succeeded.
        var hasArt = false
        if let artData, let jpeg = downscaledJPEG(artData) {
            let dest = LibraryCache.shared.thumbURL(forTrackId: id)
            hasArt = (try? jpeg.write(to: dest, options: .atomic)) != nil
        }

        let finalTitle = (title?.isEmpty == false) ? title! : url.deletingPathExtension().lastPathComponent
        let finalArtist = artist ?? ""
        let finalAlbum = album ?? ""

        LibraryCache.shared.store(path: path, meta: CachedTrackMeta(
            mtimeMs: mtimeMs, size: size, title: finalTitle, artist: finalArtist,
            album: finalAlbum, durationSec: durationSec, hasArt: hasArt))

        return trackDict(id: id, path: path, mtimeMs: mtimeMs, size: size, ext: ext,
                         playlistId: playlistId, title: finalTitle, artist: finalArtist,
                         album: finalAlbum, durationSec: durationSec, hasArt: hasArt)
    }

    private static func trackDict(id: String, path: String, mtimeMs: Double, size: Int, ext: String,
                                  playlistId: String, title: String, artist: String, album: String,
                                  durationSec: Double?, hasArt: Bool) -> TrackResult {
        return [
            "id": id,
            "path": path,
            "mtimeMs": mtimeMs,
            "size": size,
            "title": title,
            "artist": artist,
            "album": album,
            "albumArtist": artist,
            "year": NSNull(),
            "trackNo": NSNull(),
            "trackOf": NSNull(),
            "discNo": NSNull(),
            "genre": "",
            "durationSec": durationSec ?? NSNull(),
            "hasArt": hasArt,
            "codec": ext.uppercased(),
            "unsupported": unsupportedExts.contains(ext),
            "playlistId": playlistId
        ]
    }

    // MARK: - metadata helpers (async, iOS 16+)

    @available(iOS 16.0, *)
    private static func stringMeta(_ items: [AVMetadataItem], _ id: AVMetadataIdentifier) async -> String? {
        let filtered = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: id)
        guard let item = filtered.first else { return nil }
        let s = try? await item.load(.stringValue)
        return s?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    @available(iOS 16.0, *)
    private static func artworkMeta(_ items: [AVMetadataItem]) async -> Data? {
        let filtered = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: .commonIdentifierArtwork)
        guard let item = filtered.first else { return nil }
        return try? await item.load(.dataValue)
    }

    /// Cover-art fallback for formats that don't surface it under common metadata.
    @available(iOS 16.0, *)
    private static func artworkFallback(_ items: [AVMetadataItem]) async -> Data? {
        for id in [AVMetadataIdentifier.id3MetadataAttachedPicture, .iTunesMetadataCoverArt] {
            let filtered = AVMetadataItem.metadataItems(from: items, filteredByIdentifier: id)
            if let item = filtered.first, let data = try? await item.load(.dataValue) {
                return data
            }
        }
        return nil
    }

    private static func downscaledJPEG(_ data: Data, maxDim: CGFloat = 640) -> Data? {
        guard let img = UIImage(data: data) else { return nil }
        let w = img.size.width, h = img.size.height
        guard w > 0, h > 0 else { return nil }
        let scale = min(1, maxDim / max(w, h))
        if scale >= 1 { return img.jpegData(compressionQuality: 0.85) }
        let newSize = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(size: newSize, format: format)
        let out = renderer.image { _ in img.draw(in: CGRect(origin: .zero, size: newSize)) }
        return out.jpegData(compressionQuality: 0.85)
    }

    // MARK: - playlist derivation

    /// (playlistId, displayName) for a file, from its first path segment under root.
    private static func playlistInfo(path: String, rootPath: String) -> (String, String) {
        var rel = path
        if rel.hasPrefix(rootPath + "/") { rel = String(rel.dropFirst(rootPath.count + 1)) }
        let comps = rel.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if comps.count <= 1 {
            return (LOOSE_ID, LOOSE_NAME) // file sits directly in the root
        }
        let seg = comps[0]
        return (seg, seg)
    }

    private static func buildPlaylists(from tracks: [TrackResult], rootPath: String) -> [[String: Any]] {
        var byId: [String: [TrackResult]] = [:]
        for t in tracks {
            let pid = (t["playlistId"] as? String) ?? LOOSE_ID
            byId[pid, default: []].append(t)
        }
        var playlists: [[String: Any]] = []
        for (pid, list) in byId {
            let name = pid == LOOSE_ID ? LOOSE_NAME : pid
            let plPath = pid == LOOSE_ID ? rootPath : rootPath + "/" + pid
            let sorted = list.sorted {
                let a = ($0["path"] as? String) ?? ""
                let b = ($1["path"] as? String) ?? ""
                return a.localizedCaseInsensitiveCompare(b) == .orderedAscending
            }
            let trackIds = sorted.compactMap { $0["id"] as? String }
            let coverTrackId = sorted.first(where: { ($0["hasArt"] as? Bool) == true })?["id"] as? String
                ?? trackIds.first
            playlists.append([
                "id": pid,
                "name": name,
                "path": plPath,
                "trackIds": trackIds,
                "coverTrackId": coverTrackId ?? NSNull()
            ])
        }
        // Alphabetical, with Loose Tracks pinned last (mirrors the sidebar).
        playlists.sort { a, b in
            let ai = (a["id"] as? String) ?? "", bi = (b["id"] as? String) ?? ""
            if ai == LOOSE_ID { return false }
            if bi == LOOSE_ID { return true }
            let an = (a["name"] as? String) ?? "", bn = (b["name"] as? String) ?? ""
            return an.localizedCaseInsensitiveCompare(bn) == .orderedAscending
        }
        return playlists
    }
}

private extension Array {
    func chunked(into size: Int) -> [[Element]] {
        guard size > 0 else { return [self] }
        return stride(from: 0, to: count, by: size).map { Array(self[$0..<Swift.min($0 + size, count)]) }
    }
}
