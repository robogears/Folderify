import Foundation
import WebKit

// Serves the same media:// and cover:// URLs the desktop app uses (see
// src/shared/ipc.ts mediaUrl()/coverUrl()), so the shared renderer resolves audio
// and album art identically inside the Capacitor WebView.
//
//   media://localhost/<percent-encoded absolute file path>
//   cover://localhost/<track id>?s=sm|lg
//
// Both handlers do their file IO on a background queue and guard every
// WKURLSchemeTask callback against a prior stop() — WebKit cancels media tasks
// aggressively on seek, and calling back a stopped task crashes.

private func mimeType(forExtension ext: String) -> String {
    switch ext.lowercased() {
    case "mp3": return "audio/mpeg"
    case "m4a", "aac", "mp4": return "audio/mp4"
    case "wav": return "audio/wav"
    case "flac": return "audio/flac"
    case "aiff", "aif", "aifc": return "audio/aiff"
    case "opus": return "audio/opus"
    case "ogg", "oga": return "audio/ogg"
    case "caf": return "audio/x-caf"
    default: return "application/octet-stream"
    }
}

/// Tracks which tasks WebKit has cancelled, so background work never calls a dead
/// task. `run` executes the task callbacks atomically w.r.t. stop(), closing the
/// check-then-call race that would otherwise crash on rapid seeks.
private final class TaskGuard {
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()
    private func key(_ task: WKURLSchemeTask) -> ObjectIdentifier { ObjectIdentifier(task as AnyObject) }

    func markStopped(_ task: WKURLSchemeTask) {
        lock.lock(); stopped.insert(key(task)); lock.unlock()
    }
    func clear(_ task: WKURLSchemeTask) {
        lock.lock(); stopped.remove(key(task)); lock.unlock()
    }
    /// Run `body` (the task callbacks) only if the task hasn't been stopped, holding
    /// the lock so stop() can't interleave. Returns false if the task was already dead.
    @discardableResult
    func run(_ task: WKURLSchemeTask, _ body: () -> Void) -> Bool {
        lock.lock(); defer { lock.unlock() }
        if stopped.contains(key(task)) { return false }
        body()
        return true
    }
}

// MARK: - media:// (seekable audio with HTTP Range support)

final class MediaSchemeHandler: NSObject, WKURLSchemeHandler {
    private let queue = DispatchQueue(label: "folderify.media", qos: .userInitiated, attributes: .concurrent)
    private let guardian = TaskGuard()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guardian.clear(task)
        queue.async { [weak self] in self?.serve(task) }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        guardian.markStopped(task)
    }

    private func send(_ task: WKURLSchemeTask, response: URLResponse, data: Data?) {
        guardian.run(task) {
            task.didReceive(response)
            if let data = data { task.didReceive(data) }
            task.didFinish()
        }
    }

    private func fail(_ task: WKURLSchemeTask, code: Int) {
        let resp = HTTPURLResponse(url: task.request.url ?? URL(string: "media://localhost/")!,
                                   statusCode: code, httpVersion: "HTTP/1.1", headerFields: nil)!
        guardian.run(task) {
            task.didReceive(resp)
            task.didFinish()
        }
    }

    private func serve(_ task: WKURLSchemeTask) {
        guard let url = task.request.url,
              let fileURL = LibraryAccess.shared.mediaFileURL(for: url) else {
            fail(task, code: 404); return
        }

        let path = fileURL.path
        let fm = FileManager.default
        guard let attrs = try? fm.attributesOfItem(atPath: path),
              let fileSize = (attrs[.size] as? NSNumber)?.intValue,
              let handle = try? FileHandle(forReadingFrom: fileURL) else {
            fail(task, code: 404); return
        }
        defer { try? handle.close() }

        let mime = mimeType(forExtension: fileURL.pathExtension)
        let rangeHeader = task.request.value(forHTTPHeaderField: "Range")

        // IMPORTANT: use the throwing read APIs (read(upToCount:)/readToEnd), NOT the
        // Obj-C readData(ofLength:)/readDataToEndOfFile — those raise NSExceptions that
        // Swift cannot catch and CRASH the app. Cloud-backed files (iCloud Drive /
        // CloudStorage) routinely fail mid-read when online-only ("Stale NFS file handle").
        if let (start, end) = parseRange(rangeHeader, fileSize: fileSize) {
            let length = end - start + 1
            do {
                try handle.seek(toOffset: UInt64(start))
                guard let data = try handle.read(upToCount: length) else {
                    fail(task, code: 500); return
                }
                let headers = [
                    "Content-Type": mime,
                    "Content-Length": "\(data.count)",
                    "Content-Range": "bytes \(start)-\(start + data.count - 1)/\(fileSize)",
                    "Accept-Ranges": "bytes",
                    "Access-Control-Allow-Origin": "*"
                ]
                let resp = HTTPURLResponse(url: url, statusCode: 206, httpVersion: "HTTP/1.1", headerFields: headers)!
                send(task, response: resp, data: data)
            } catch {
                fail(task, code: 500)
            }
        } else {
            // No (valid) Range — return the whole file.
            do {
                guard let data = try handle.readToEnd(), !data.isEmpty else {
                    fail(task, code: 500); return
                }
                let headers = [
                    "Content-Type": mime,
                    "Content-Length": "\(data.count)",
                    "Accept-Ranges": "bytes",
                    "Access-Control-Allow-Origin": "*"
                ]
                let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
                send(task, response: resp, data: data)
            } catch {
                fail(task, code: 500)
            }
        }
    }

    /// Parse a single "bytes=start-end" range. Returns absolute [start, end] clamped to the file.
    private func parseRange(_ header: String?, fileSize: Int) -> (Int, Int)? {
        guard fileSize > 0,
              let header = header,
              header.lowercased().hasPrefix("bytes=") else { return nil }
        let spec = header.dropFirst("bytes=".count)
        // Only the first range is honored (the common single-range case).
        let firstSpec = spec.split(separator: ",").first.map(String.init) ?? String(spec)
        let parts = firstSpec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else { return nil }
        let startStr = parts[0].trimmingCharacters(in: .whitespaces)
        let endStr = parts[1].trimmingCharacters(in: .whitespaces)

        var start: Int
        var end: Int
        if startStr.isEmpty {
            // suffix range: bytes=-N  -> last N bytes
            guard let n = Int(endStr), n > 0 else { return nil }
            start = max(0, fileSize - n)
            end = fileSize - 1
        } else {
            guard let s = Int(startStr) else { return nil }
            start = s
            end = endStr.isEmpty ? fileSize - 1 : (Int(endStr) ?? fileSize - 1)
        }
        start = max(0, start)
        end = min(end, fileSize - 1)
        guard start <= end else { return nil }
        return (start, end)
    }
}

// MARK: - cover:// (album-art thumbnail for a track id)

final class CoverSchemeHandler: NSObject, WKURLSchemeHandler {
    private let queue = DispatchQueue(label: "folderify.cover", qos: .userInitiated, attributes: .concurrent)
    private let guardian = TaskGuard()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guardian.clear(task)
        queue.async { [weak self] in self?.serve(task) }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        guardian.markStopped(task)
    }

    private func serve(_ task: WKURLSchemeTask) {
        guard let url = task.request.url else { fail(task); return }
        // cover://localhost/<id>?s=sm  — id is the last path component.
        let id = url.lastPathComponent.removingPercentEncoding ?? url.lastPathComponent
        guard let data = LibraryAccess.shared.artworkData(forTrackId: id) else {
            // No art for this id (incl. the "placeholder" id) — 404. The renderer's
            // <img onError> hides the broken glyph, leaving a clean dark tile.
            fail(task); return
        }
        let headers = [
            "Content-Type": "image/jpeg",
            "Content-Length": "\(data.count)",
            "Cache-Control": "max-age=31536000",
            "Access-Control-Allow-Origin": "*"
        ]
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        guardian.run(task) {
            task.didReceive(resp)
            task.didReceive(data)
            task.didFinish()
        }
    }

    private func fail(_ task: WKURLSchemeTask) {
        let resp = HTTPURLResponse(url: task.request.url ?? URL(string: "cover://localhost/")!,
                                   statusCode: 404, httpVersion: "HTTP/1.1", headerFields: nil)!
        guardian.run(task) {
            task.didReceive(resp)
            task.didFinish()
        }
    }
}
