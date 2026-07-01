# What's new in v0.1.5

## Matching logo
- The sidebar logo (top-left) is now the same clean music note as the app icon, with a little more breathing room above it so it clears the window buttons. It also adapts to each layout — light on the dark themes, dark on Clean 01.

## Under the hood
- More iPhone groundwork landed in the repo: the native library plugin (folder access, on-device scanning, album art) — not part of this desktop release.

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon)**: download `Folderify-0.1.5-arm64.dmg`, open it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy & Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.4...v0.1.5
