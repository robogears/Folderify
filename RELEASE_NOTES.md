# What's new in v0.1.7

## Listen Together — play in sync with a friend (experimental)

- **New:** two Macs on the same Wi-Fi can now listen together. Either person picks a
  song from **their own** library and it plays, **in sync**, on both Macs — the listener
  needs **none** of the files. Open the **broadcast icon** in the top bar (left of
  Rescan) on both Macs, share the **6-digit code**, and connect.
- Whoever picks a track is **in control**; hand-off is automatic, and play / pause /
  seek stay in step on both ends.
- **Private by design:** the connection is peer-to-peer and encrypted (WebRTC/DTLS).
  Only the **currently-playing track's audio** is shared — never your files, folders,
  or library.

> **Experimental & LAN-only.** This is a brand-new feature that needs two Macs on the
> same Wi-Fi to exercise, so treat it as a preview: if a connection doesn't establish on
> your network, nothing else in the app is affected. One-to-one only, no internet, and
> the receiver doesn't show album art yet.

## Also in this release

- iPhone app polish (not part of this desktop app): fixed a freeze on large playlists,
  Library moved to its own tab, shuffle-aware Play, and a cleaner lock-screen Now Playing.

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or
  Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon):** download `Folderify-0.1.7-arm64.dmg`, open
  it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- Listen Together needs both Macs on the **same Wi-Fi / LAN**.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.6...v0.1.7
