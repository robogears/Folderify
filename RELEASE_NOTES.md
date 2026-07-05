# What's new in v0.1.8

## Listen Together — now actually connects (experimental)

v0.1.7 introduced Listen Together but couldn't reliably pair two Macs. This release fixes
the connection path:

- **Grant the network prompt.** The first time you open the Connect panel (broadcast icon,
  top bar), macOS asks to let Folderify **"find and connect to devices on your local
  network."** Allow it on **both** Macs — without it, macOS silently blocks the connection.
- **Can't see the other Mac?** The panel now shows each Mac's **IP address** and pairing
  code, and you can **connect by IP** directly when automatic discovery doesn't find it.
- **No more endless spinner.** If it can't connect, Folderify now tells you why (wrong
  Wi-Fi, permission not granted) instead of hanging on "Connecting…".

Still experimental and **LAN-only** (same Wi-Fi, one-to-one); the receiver doesn't show
album art yet.

---

# Install / update

- **Already on v0.1.2 or later?** Just click the in-app **Update** button (top bar or
  Settings → Updates) — it downloads and self-installs. No DMG needed.
- **Fresh install (macOS, Apple Silicon):** download `Folderify-0.1.8-arm64.dmg`, open
  it, and drag Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- Listen Together needs both Macs on the **same Wi-Fi / LAN**, with the **local network
  permission allowed** on each.
- No account, API key, or subscription.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.7...v0.1.8
