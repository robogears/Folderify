# What's new in v0.1.9

## More reliable, more secure updates

The in-app updater is rebuilt on a hardened path:

- **Checksum-verified downloads.** Every update is verified against a SHA-256 published
  with the release before it's installed — a corrupted or truncated download is caught
  and rejected instead of installed.
- **Clearer feedback.** Instead of a generic "couldn't reach GitHub," a manual check now
  tells you exactly what happened — **"You're offline"**, **"Rate-limited — retry in Ns"**,
  or **"No releases yet"** — and recovers on its own when you're back online.
- **Quota-friendly checks** (they won't trip GitHub's rate limit), respect for **system
  proxies** and the macOS certificate store, and an automatic re-check after your Mac
  **wakes from sleep**.
- **Under the hood:** closed a couple of update-path security gaps (the app downloads
  only its own verified release asset now) and made the install swap safer — it re-signs
  **and verifies** the new app, and rolls back to the old one on any failure.

> This hardened updater takes effect for updates **from v0.1.9 onward**.

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or
  Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon):** download `Folderify-0.1.9-arm64.dmg`, open
  it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.8...v0.1.9
