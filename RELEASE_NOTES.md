# What's new in v0.1.4

## Fresh app icon
- New Folderify app icon — the music-note mark on a clean dark tile, matching the app's own look. You'll see it in the Dock, Launchpad, and wherever Folderify lives.
- The same icon now ships on the (in-progress) iPhone build, so both platforms match.

## Little things
- Tidied the sidebar header — the collapse toggle stays out of the way and only appears on hover.

## Under the hood
- Trimmed the shipped desktop build by moving the mobile (Capacitor) tooling to dev-only dependencies, so it's no longer bundled into the app.
- Early groundwork for an iPhone version has landed in the repo (not part of this desktop release).

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon)**: download `Folderify-0.1.4-arm64.dmg`, open it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy & Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.3...v0.1.4
