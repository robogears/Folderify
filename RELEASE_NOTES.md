# What's new in v0.1.15

**Listen Together now plays in near-perfect sync.**

## Tighter sync between the two Macs

When you listen together, both Macs now stay locked to within a few hundredths of a
second of each other — instead of drifting up to about half a second apart. The result is
that it actually sounds like one shared room, not two devices almost-together.

It gets there without any jumpiness:

- **Continuous, inaudible correction.** Rather than letting the two drift and then jumping
  to catch up, the listening Mac gently and constantly steers itself to match — using tiny
  tempo adjustments you can't hear (pitch is preserved). Big jumps (like a seek) still snap
  instantly.
- **Locks on faster when you connect**, and stays aligned more accurately over time thanks
  to smarter clock measurement.

Nothing about your library changes — this is all in how playback is kept in step.

---

# Install / update

- **From v0.1.14:** click the in-app **Update** button — it downloads, reinstalls, and
  relaunches itself.
- **Fresh install:** download `Folderify-0.1.15-arm64.dmg` below, open it, and drag
  Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.
- Listen Together needs both Macs on the **same Wi-Fi / local network**.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.14...v0.1.15
