# What's new in v0.1.3

## Slimmer download
- Folderify now ships as a single **Apple Silicon** (`arm64`) build instead of separate Intel + Apple Silicon dmgs — one file, about half the size.

## Under the hood
- Hardened the in-app updater's release-asset matching so it keeps working across future packaging changes.
- This is the first release that updates *into* itself from the auto-updater added in v0.1.2. If you're on v0.1.2, you should see an **"Update to v0.1.3"** pill in the top bar — click it to download and self-install.

---

# Install

- **macOS (Apple Silicon)**: download `Folderify-0.1.3-arm64.dmg`, open it, and drag Folderify to Applications.

If you're already on **v0.1.2**, you don't need the DMG — just click the in-app **Update** button (top bar or Settings → Updates) and it installs itself.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy & Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription. Intel Macs: stay on v0.1.2, or ask for a universal build.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.2...v0.1.3
