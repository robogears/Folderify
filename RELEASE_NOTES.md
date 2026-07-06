# What's new in v0.1.14

**Listen Together got faster, and pairing is simpler — no more codes.**

## Simpler pairing (no more 6-digit code)

- **Just approve and go.** Click the other Mac in the Connect panel, and a request pops
  up on their screen — they tap **Allow** and you're connected. No typing a pairing code.
- **Trust a device once, connect anytime.** When they approve, they can tick **"Trust
  this device."** After that, you can reconnect with no prompt at all — even if they don't
  have the Connect panel open. As long as Folderify is running on both Macs, a trusted
  device just connects.
- **Changed your mind?** Settings → Playback → **Forget trusted devices** clears the list,
  and everyone gets asked again next time.

## Faster song streaming

Picking a song the other person doesn't have used to take 5–10 seconds. Now it's close to
instant, three ways — and **your music files are never touched or modified** (Folderify
stays strictly read-only; all of this happens on an in-memory copy):

- **Smaller transfers.** Lossless files (FLAC/WAV) are compressed on the fly to a high-
  quality ~192 kbps stream before sending — much less to download, so playback starts
  sooner.
- **Play while it loads.** Songs start playing before the whole file has arrived, instead
  of waiting for the full download.
- **The next songs are already there.** While you listen, the next few tracks quietly
  pre-download on the other Mac — so when someone skips ahead, it just plays.

You can turn the compression off in **Settings → Playback → "Compress Listen Together
transfers"** if you'd rather always send the original file.

## Also

- **See what's coming up** from the person you're listening with, right in the queue.

---

# Install / update

- **From v0.1.13:** click the in-app **Update** button — it downloads and reinstalls
  itself, then relaunches. That's it.
- **Fresh install:** download `Folderify-0.1.14-arm64.dmg` below, open it, and drag
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

**Full Changelog**: https://github.com/robogears/Folderify/compare/v0.1.13...v0.1.14
