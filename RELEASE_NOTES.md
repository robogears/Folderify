# What's new in v0.1.6

## Now Playing on macOS
- Folderify now plugs into the macOS **Now Playing** widget (Control Center / menu bar), your **keyboard's media keys**, and AirPods. You'll see the real **track title, artist, album, and album art**, a live **scrubber** you can drag, and working **play / pause / next / previous** — all in sync with the app.

## Shuffle & repeat stick
- Your **shuffle and repeat** choices now persist across launches instead of resetting to off every time.

## Friendlier feedback
- Tapping play on a folder where nothing can be played on this device now tells you, instead of silently skipping through.
- Scan errors and folder problems now show a brief message instead of failing quietly.
- Album art that loads a moment late no longer stays hidden, and a missing large thumbnail falls back to the small one instead of the placeholder.

## Also in this release
- Under the hood: more iPhone groundwork (on-device metadata cache, persisted artwork, scan progress, iCloud-aware scanning) — not part of this desktop app.

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon)**: download `Folderify-0.1.6-arm64.dmg`, open it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy & Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.5...v0.1.6
