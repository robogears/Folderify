import Foundation

// Owns the user-picked root folder and the access to it. On iOS a folder chosen
// via UIDocumentPicker is a *security-scoped* URL: we persist a bookmark so access
// survives relaunch, and keep the scope started for the app session so the scanner
// and the media:///cover:// scheme handlers can read files under it.
//
// Artwork is served from the persisted thumbs directory (LibraryCache) — written
// during scans, so covers resolve immediately on relaunch.
final class LibraryAccess {
    static let shared = LibraryAccess()
    private init() {}

    private let bookmarkKey = "folderify.rootBookmark.v1"

    /// The active root (security scope started). nil until a folder is connected.
    private(set) var rootURL: URL?
    private var accessing = false

    var rootName: String? { rootURL?.lastPathComponent }

    // MARK: - Connect / persist / forget

    /// Persist and start accessing a freshly-picked folder. Returns false on failure.
    @discardableResult
    func connect(to pickedURL: URL) -> Bool {
        // The picked URL is already security-scoped; start accessing while we mint the
        // bookmark, and keep the scope open (it becomes the active root below).
        let didStart = pickedURL.startAccessingSecurityScopedResource()
        do {
            // iOS: plain bookmark (NO .withSecurityScope — that's macOS-only). A bookmark
            // from a security-scoped document-picker URL resolves back with scope on iOS.
            let data = try pickedURL.bookmarkData(options: [],
                                                  includingResourceValuesForKeys: nil,
                                                  relativeTo: nil)
            UserDefaults.standard.set(data, forKey: bookmarkKey)
        } catch {
            if didStart { pickedURL.stopAccessingSecurityScopedResource() }
            return false
        }
        // Release the previous root, then adopt the picked URL (scope stays started).
        stopAccessingCurrent()
        rootURL = pickedURL
        accessing = didStart
        return true
    }

    /// Resolve the saved bookmark (if any) and start accessing it. Returns the root URL.
    @discardableResult
    func resolveSavedRoot() -> URL? {
        if let rootURL { return rootURL }
        guard let data = UserDefaults.standard.data(forKey: bookmarkKey) else { return nil }
        var stale = false
        do {
            // iOS: resolve with [] options (NOT .withSecurityScope).
            let url = try URL(resolvingBookmarkData: data,
                              options: [],
                              relativeTo: nil,
                              bookmarkDataIsStale: &stale)
            let didStart = url.startAccessingSecurityScopedResource()
            rootURL = url
            accessing = didStart
            if stale {
                // Refresh the stored bookmark opportunistically.
                if let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
                    UserDefaults.standard.set(fresh, forKey: bookmarkKey)
                }
            }
            return url
        } catch {
            return nil
        }
    }

    /// The active root, resolving from the saved bookmark on first use.
    func ensureRoot() -> URL? {
        return rootURL ?? resolveSavedRoot()
    }

    func forget() {
        stopAccessingCurrent()
        rootURL = nil
        UserDefaults.standard.removeObject(forKey: bookmarkKey)
        // Unlike desktop (where forget is deliberately partial), iOS has no way for
        // the user to delete app data short of deleting the app — so forget IS the
        // full reset: metadata cache + thumbs go too.
        LibraryCache.shared.clear()
    }

    private func stopAccessingCurrent() {
        if accessing, let rootURL {
            rootURL.stopAccessingSecurityScopedResource()
        }
        accessing = false
    }

    // MARK: - media:// path resolution (with traversal safety)

    /// Decode a media://localhost/<percent-encoded abs path> URL to a file URL,
    /// verifying it stays inside the connected root (guards against traversal).
    func mediaFileURL(for url: URL) -> URL? {
        guard let root = rootURL else { return nil }
        let full = url.absoluteString
        guard let marker = full.range(of: "://localhost/") else { return nil }
        let encoded = String(full[marker.upperBound...])
        guard let decoded = encoded.removingPercentEncoding, !decoded.isEmpty else { return nil }

        let fileURL = URL(fileURLWithPath: decoded).standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        let filePath = fileURL.path
        // Must be strictly under the root directory.
        guard filePath == rootPath || filePath.hasPrefix(rootPath + "/") else { return nil }
        guard FileManager.default.fileExists(atPath: filePath) else { return nil }
        return fileURL
    }

    // MARK: - cover:// lookup

    /// Reads the persisted thumb (written during scans). Guard the id so a crafted
    /// cover:// URL can't path-traverse out of the thumbs directory.
    func artworkData(forTrackId id: String) -> Data? {
        guard !id.isEmpty, id.allSatisfy({ $0.isHexDigit }) else { return nil }
        return try? Data(contentsOf: LibraryCache.shared.thumbURL(forTrackId: id))
    }
}
