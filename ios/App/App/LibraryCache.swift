import Foundation

/// One cached parse result, validated by mtime+size (same contract as desktop's
/// folderify-cache.json). `hasArt` implies a persisted thumb exists on disk.
struct CachedTrackMeta: Codable {
    let mtimeMs: Double
    let size: Int
    let title: String
    let artist: String
    let album: String
    let durationSec: Double?
    let hasArt: Bool
}

/// Phase-2 persistence: a JSON metadata cache + on-disk artwork thumbnails, so
/// relaunch scans skip AVFoundation for unchanged files and covers resolve
/// immediately (desktop parity: cache.ts + thumbnails.ts). Thread-safe — the
/// scanner parses in concurrent task groups.
final class LibraryCache {
    static let shared = LibraryCache()
    private init() {}

    private static let VERSION = 1

    private struct Envelope: Codable {
        let version: Int
        let entries: [String: CachedTrackMeta]
    }

    private let lock = NSLock()
    private var entries: [String: CachedTrackMeta] = [:]
    /// Paths seen by the current scan — used to prune stale entries afterwards.
    private var seenPaths = Set<String>()

    // MARK: - locations (Application Support persists and is backed up; Caches can be purged)

    private var supportDir: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Folderify", isDirectory: true)
    }
    private var cacheFile: URL { supportDir.appendingPathComponent("library-cache-v1.json") }
    var thumbsDir: URL { supportDir.appendingPathComponent("thumbs", isDirectory: true) }

    func thumbURL(forTrackId id: String) -> URL {
        thumbsDir.appendingPathComponent("\(id).jpg")
    }

    // MARK: - lifecycle

    /// Load the cache from disk (idempotent per scan; also resets the seen-set).
    func beginScan() {
        lock.lock(); defer { lock.unlock() }
        seenPaths.removeAll()
        try? FileManager.default.createDirectory(at: thumbsDir, withIntermediateDirectories: true)
        guard entries.isEmpty else { return }
        guard let data = try? Data(contentsOf: cacheFile),
              let env = try? JSONDecoder().decode(Envelope.self, from: data),
              env.version == Self.VERSION else { return }
        entries = env.entries
    }

    /// Persist the cache, dropping entries (and their thumbs) for files that no
    /// longer exist. Call once after a scan completes with the live track ids.
    func endScan(liveTrackIds: Set<String>) {
        lock.lock()
        entries = entries.filter { seenPaths.contains($0.key) }
        let snapshot = Envelope(version: Self.VERSION, entries: entries)
        lock.unlock()

        if let data = try? JSONEncoder().encode(snapshot) {
            try? data.write(to: cacheFile, options: .atomic)
        }
        // Prune orphaned thumbs (files whose track vanished).
        let fm = FileManager.default
        if let names = try? fm.contentsOfDirectory(atPath: thumbsDir.path) {
            for name in names where name.hasSuffix(".jpg") {
                let id = String(name.dropLast(4))
                if !liveTrackIds.contains(id) {
                    try? fm.removeItem(at: thumbsDir.appendingPathComponent(name))
                }
            }
        }
    }

    /// Wipe everything (used by "forget" — on iOS this is the only reset path).
    func clear() {
        lock.lock(); defer { lock.unlock() }
        entries.removeAll()
        seenPaths.removeAll()
        try? FileManager.default.removeItem(at: cacheFile)
        try? FileManager.default.removeItem(at: thumbsDir)
    }

    // MARK: - per-file

    /// Cache hit iff path+mtime+size all match. Marks the path as seen either way.
    func lookup(path: String, mtimeMs: Double, size: Int) -> CachedTrackMeta? {
        lock.lock(); defer { lock.unlock() }
        seenPaths.insert(path)
        guard let e = entries[path], e.mtimeMs == mtimeMs, e.size == size else { return nil }
        return e
    }

    func store(path: String, meta: CachedTrackMeta) {
        lock.lock(); defer { lock.unlock() }
        entries[path] = meta
    }
}
