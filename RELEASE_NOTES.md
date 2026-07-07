# What's new in v0.1.16

**Listen Together: album art on both screens, and snappier skipping.**

## Album art for the person listening

When someone streams you a track over Listen Together, you now see its **album art** —
in the player bar and in the macOS Now Playing widget (Control Center / lock screen) —
instead of a blank placeholder. The art is sent right alongside the track, and because
it travels with the pre-download, **skipping to an already-queued song shows its cover
instantly**.

## Faster, tighter skipping & scrubbing

- **Skips and scrubs keep up now.** When the person in control jumps to another point in a
  song (or skips tracks), the other Mac re-aligns almost immediately, instead of taking a
  moment to catch up.
- Under the hood: the controlling Mac announces a jump the instant it happens rather than
  waiting for the next sync tick, the follower checks in more often, and seeks are applied
  optimistically so playback doesn't briefly snap backwards before settling.

Together with the near-1:1 sync from v0.1.15, Listen Together now feels like one shared
player — same song, same spot, same cover, on both Macs.

---

# Install / update

- **From v0.1.15:** click the in-app **Update** button — it downloads, reinstalls, and
  relaunches itself.
- **Fresh install:** download `Folderify-0.1.16-arm64.dmg` below, open it, and drag
  Folderify to Applications.

On a fresh install, macOS Gatekeeper holds the app back on first launch (it isn't
notarized). On macOS 15+: try to open it, then go to **System Settings → Privacy &
Security → Open Anyway** — once only.

The first time you use Listen Together, macOS asks to let Folderify **find devices on your
local network** — allow it, or discovery and connections won't work.

Your settings, metadata cache, and thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later, on an Apple Silicon Mac.
- No account, API key, or subscription.
- Listen Together needs both Macs on the **same Wi-Fi / local network**.

---

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.15...v0.1.16
