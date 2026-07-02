import Foundation
import UIKit
import MediaPlayer
import AVFoundation
import Capacitor

// Native lock-screen / Control Center / AirPods "Now Playing" bridge.
//
// WebKit still does the actual audio playback (the renderer's <audio> element), but
// the Web MediaSession session is given up by WebKit the moment the app is
// backgrounded/suspended — so lock-screen control breaks when the screen is off.
// This plugin owns the SYSTEM Now Playing surface natively, which survives
// backgrounding: MPRemoteCommandCenter handlers fire even when the app isn't
// foregrounded, and MPNowPlayingInfoCenter keeps the metadata/scrubber on screen.
//
//   JS -> native:  update({title,artist,album,coverTrackId,duration,position,isPlaying})
//                  clear()
//   native -> JS:  notifyListeners("remoteCommand", {action, position?})
//                  where action ∈ play|pause|toggle|next|prev|seekTo
//
// Position is written event-driven only (play/pause/seek/track-change). iOS
// extrapolates the scrubber from elapsedTime + playbackRate, so we must NOT write
// continuously — doing so in the background gets silently dropped and can surface as
// a backward scrub.
@objc(FolderifyNowPlayingPlugin)
public class FolderifyNowPlayingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FolderifyNowPlayingPlugin"
    public let jsName = "FolderifyNowPlaying"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private var commandsRegistered = false
    private var sessionActive = false

    override public func load() {
        registerRemoteCommands()
    }

    // MARK: - JS -> native

    @objc func update(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? ""
        let artist = call.getString("artist") ?? ""
        let album = call.getString("album") ?? ""
        let coverId = call.getString("coverTrackId")
        let duration = call.getDouble("duration") ?? 0
        let position = call.getDouble("position") ?? 0
        let isPlaying = call.getBool("isPlaying") ?? false

        activateSession()

        DispatchQueue.main.async {
            let center = MPNowPlayingInfoCenter.default()
            var info = center.nowPlayingInfo ?? [:]
            info[MPMediaItemPropertyTitle] = title
            info[MPMediaItemPropertyArtist] = artist
            info[MPMediaItemPropertyAlbumTitle] = album
            info[MPMediaItemPropertyPlaybackDuration] = duration
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
            info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
            if let coverId = coverId, let art = self.artwork(forTrackId: coverId) {
                info[MPMediaItemPropertyArtwork] = art
            } else {
                info.removeValue(forKey: MPMediaItemPropertyArtwork)
            }
            center.nowPlayingInfo = info
            center.playbackState = isPlaying ? .playing : .paused
        }
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
        call.resolve()
    }

    // MARK: - session

    private func activateSession() {
        guard !sessionActive else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
        sessionActive = true
    }

    // MARK: - artwork (from the persisted thumb LibraryCache writes during scans)

    private func artwork(forTrackId id: String) -> MPMediaItemArtwork? {
        let url = LibraryCache.shared.thumbURL(forTrackId: id)
        guard let data = try? Data(contentsOf: url), let image = UIImage(data: data) else { return nil }
        return MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    }

    // MARK: - native -> JS (remote commands)

    private func registerRemoteCommands() {
        guard !commandsRegistered else { return }
        commandsRegistered = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ in self?.emit("play") ?? .commandFailed }
        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak self] _ in self?.emit("pause") ?? .commandFailed }
        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak self] _ in self?.emit("toggle") ?? .commandFailed }
        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak self] _ in self?.emit("next") ?? .commandFailed }
        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak self] _ in self?.emit("prev") ?? .commandFailed }
        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self = self, let e = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            return self.emit("seekTo", extra: ["position": e.positionTime])
        }
    }

    @discardableResult
    private func emit(_ action: String, extra: [String: Any] = [:]) -> MPRemoteCommandHandlerStatus {
        var data: [String: Any] = ["action": action]
        for (k, v) in extra { data[k] = v }
        notifyListeners("remoteCommand", data: data)
        return .success
    }
}
