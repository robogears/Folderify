# What's new in v0.1.12

## Exclusive media keys

- New **Settings → Playback → "Exclusive media keys"** toggle (off by default). Turn it
  on and your keyboard's **⏮ ⏯ ⏭ keys (F7/F8/F9) control only Folderify** — Spotify, your
  browser, or whatever played last can't steal them while it's on.
- macOS will ask once for **Accessibility** access (System Settings → Privacy & Security →
  Accessibility → enable Folderify) — that's the permission Apple requires for an app to
  capture media keys system-wide. If it isn't granted, the toggle switches itself back
  off and tells you what to do.
- Turn the toggle off and the keys go back to normal macOS behavior (whichever app
  played most recently).

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or
  Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon):** download `Folderify-0.1.12-arm64.dmg`, open
  it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- Exclusive media keys needs the Accessibility permission (macOS prompts when you enable it).
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.11...v0.1.12
