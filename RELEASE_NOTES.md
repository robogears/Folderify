# What's new in v0.1.13

## Fixes

- **Updates work again.** A bug introduced in v0.1.10 made the in-app updater reject
  every download (it showed "Download failed — retry"). Fixed.
- **Listen Together sends the track.** Fixed "the other Mac couldn't send that track" —
  the song now streams reliably to the person you're listening with.

> ### ⚠️ One-time manual update required
> Because the update bug is in the app you're *currently* running (v0.1.10–v0.1.12), the
> in-app **Update** button can't install this fix — it'll keep failing. To get onto
> v0.1.13 you have to **download the dmg below and install it once by hand**. After that,
> the in-app updater works normally again.

---

# Install / update

- **Getting the fix (v0.1.10–v0.1.12 users):** download `Folderify-0.1.13-arm64.dmg`
  below, open it, and drag Folderify to Applications (replacing the old one). The in-app
  Update button won't work for *this* jump — that's the bug this release fixes.
- **From v0.1.13 onward:** the in-app **Update** button self-installs normally again.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.12...v0.1.13
