# What's new in v0.1.2

## A proper Mac app
- Folderify has a real app icon now, replacing the generic Electron one.
- The build is ad-hoc code-signed, so Apple Silicon no longer rejects it as "damaged," and the `.dmg` opens to a clean drag-to-Applications window.

## Automatic updates
- Folderify checks GitHub for new versions on launch and shows an **"Update to vX.Y.Z"** pill in the top bar when one is available.
- **Settings → Updates** shows your current version and a **Check for updates** button for on-demand checks.
- One-click self-update: download with live progress, then **Restart to apply** — Folderify swaps in the new version and relaunches itself. No more manual re-downloading.

---

# Install

- **macOS (Apple Silicon)**: download `Folderify-0.1.2-arm64.dmg`, open it, and drag Folderify to Applications.
- **macOS (Intel)**: download `Folderify-0.1.2-x64.dmg`.

The app isn't notarized yet, so macOS Gatekeeper holds it back on first launch. On macOS 15+ (Sequoia/Tahoe): try to open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**. You only do this once.

**Upgrading from v0.1.1:** v0.1.1 predates the updater, so download this DMG manually one time. From v0.1.2 onward, updates apply themselves from inside the app.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later.
- No account, API key, or subscription. Cloud files that aren't downloaded locally (e.g. Dropbox online-only) must be synced to disk before they can play.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.1...v0.1.2
