# What's new in v0.1.10

## Stability & security hardening

A pass over the whole app tightening reliability and safety:

- **Listen Together** is sturdier and safer: pairing now **locks after several wrong
  codes** (so the 6-digit code can't be guessed), oversized or stalled transfers are
  rejected instead of hanging or eating memory, and a dropped connection recovers cleanly
  with a clear message instead of freezing on "Connecting…".
- **Playing undownloaded files** (iCloud / Dropbox tracks that aren't local yet) now stops
  with a clear message instead of skipping through the whole folder forever.
- **Updates** report the *specific* reason when a download fails — corrupted, not enough
  disk space, or the app can't write to its folder — and an update that advertises a
  checksum but can't prove it now refuses to install rather than proceeding.

Under the hood: crash logging for the main process, hardened "reveal in Finder" and
mini-player, CI actions pinned to exact versions, and refreshed developer docs.

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or
  Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon):** download `Folderify-0.1.10-arm64.dmg`, open
  it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.9...v0.1.10
