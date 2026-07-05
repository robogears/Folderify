# Listen Together — design & research (LAN, 1:1, two-way)

A peer-to-peer "listen together" feature: two Folderify instances on the **same LAN**
pair 1:1; **either** person can pick a track from **their own** library and it plays,
**in sync**, on both laptops. The listener needs **none** of the files — they hear the
other laptop. Control hands off: whoever picks a song becomes the source.

> **Scope (v1):** LAN only (no internet/NAT/TURN), 1:1, two-way. Designed so
> internet/rooms can be added later, but not built now.

> **Research provenance:** the architecture call below is backed by a deep-research pass
> (parallel web search → fetch → adversarial 3-vote verification). Claims marked
> **[confirmed]** survived verification; a few LAN/mDNS specifics are marked
> **[needs device test]** because their verification was cut short by a usage limit —
> they're my engineering judgment, flagged honestly.

---

## TL;DR — the recommendation

**Stream the encoded audio file over a WebRTC `RTCDataChannel`; the receiver buffers it
and plays its own copy, kept in lockstep by a tiny clock-synced control protocol.** Do
**not** capture the `<audio>` element into a WebRTC `MediaStream`.

- **Transport:** one `RTCPeerConnection` with two data channels — `control` (reliable,
  ordered JSON) and `media` (reliable, ordered binary chunks). WebRTC is **DTLS-encrypted
  by default** — no extra crypto needed.
- **Media:** the *source* peer fetches its own track's bytes via the existing `media://`
  scheme (`fetch()` works — it's `supportFetchAPI` + `ACAO:*`), chunks them over the
  `media` channel; the *receiver* buffers to a **Blob → `blob:` URL** (MSE as an
  optimization for mp3/aac) and plays it through the audio engine.
- **Sync:** authoritative-source model. The source announces "track T, position P as of
  my clock C"; the receiver, having estimated the clock offset via ping/pong, sets its
  `currentTime` to match and nudges on drift. Because each side plays a **local decoded
  copy** (not a live stream), sync is far tighter than streaming a live `MediaStream`.
- **Discovery + signaling (no server):** advertise/browse a `_folderify._tcp` mDNS
  service from the **main** process; exchange WebRTC SDP/ICE over a tiny **main-process
  WebSocket** to the discovered peer. A 6-digit **PIN** pairs the two.
- **Where it runs:** `RTCPeerConnection` + data channels live in the **renderer**
  (Chromium WebRTC); mDNS + the signaling socket live in **main** (Node); preload relays
  SDP/ICE between them.

## Why NOT the "capture the audio element" approach

The intuitive design — `audioElement.captureStream()` → add the audio track to an
`RTCPeerConnection` → the peer hears it live — is a **dead end for this app**:

- **[confirmed, 3-0]** `captureStream()`/`createMediaElementSource()` only produce usable
  (non-silent) output for a cross-origin resource when the server sends `ACAO` **and** the
  element carries a **`crossOrigin` attribute**. `ACAO: *` **alone is not sufficient.**
  (Source: WebAudio/web-audio-api#2547.)
- **[confirmed, 3-0]** A tainted media element outputs **silence** through the audio graph:
  *"MediaElementAudioSource outputs zeroes due to CORS access restrictions."*
- **[confirmed, 3-0]** This holds **even with `ACAO: *`** unless `crossOrigin` is set.
- **[confirmed, 3-0]** Tainting is decided by **CORS-mode/principal checks, not** whether
  the bytes actually loaded — so a media element that successfully plays `media://` audio
  can *still* yield a stream WebRTC refuses.
- **[confirmed, 2-1]** Cross-origin media captured to a stream is **rejected by
  `RTCPeerConnection`/`MediaRecorder`** as a security error (documented in Gecko; Chromium
  behaves the same way in practice).

The catch that makes this fatal *here*: making `captureStream()` work requires setting
**`crossOrigin`** on the element — and setting `crossOrigin` on `media://` audio is the
exact thing Folderify ripped out because it **tainted the stream and broke playback**
(the documented "no crossOrigin / no Web Audio" gotcha in CLAUDE.md). So Option A would
either output silence to the peer or re-introduce the original playback bug. Avoid it.

## Options compared

| | **A. WebRTC audio `MediaStream`** (`captureStream`) | **B. Data-channel file bytes + local play** ✅ | **C. LAN HTTP server + `<audio>` + WS control** |
|---|---|---|---|
| Tainting risk | **High** — needs `crossOrigin` = the known breakage | **None** — never touches captureStream/Web Audio | None |
| Sync quality | Jittery (live network stream + buffering) | **Excellent** — both play a local copy on a shared clock | Good, but the joiner streams over HTTP (network jitter) |
| Audio fidelity | Re-encoded to Opus (lossy) | **Bit-exact** (original file bytes) | Bit-exact |
| Whole-track fit | Awkward (designed for live/mic) | **Ideal** (transfer a track, then play it) | Good |
| Latency to first sound | Low (live) | Moderate (buffer enough to start) — fine on LAN | Low |
| Bandwidth | Continuous while playing | One transfer per track, then idle | Continuous while the joiner plays |
| New attack surface | RTCPeerConnection only | RTCPeerConnection only | **An HTTP server bound to the LAN** (must scope hard) |
| Complexity | Medium (but blocked by tainting) | **Medium** | Low–Medium |

**B wins** for this exact use case (whole-track, tight two-way sync, no tainting, bit-exact,
minimal attack surface). C is a reasonable simpler fallback but exposes an HTTP endpoint on
the LAN and streams (rather than pre-buffers), so sync is looser. A is out.

## The design in detail

### Data channels
One `RTCPeerConnection`, two channels:
- **`control`** — `ordered: true`, reliable. Small JSON messages (see protocol).
- **`media`** — `ordered: true`, reliable, binary. File chunks (e.g. 16–64 KB). Respect
  backpressure: pause sending when `dataChannel.bufferedAmount` climbs past a threshold,
  resume on `bufferedamountlow`.

### Media transfer (source → receiver)
1. Source picks track T. Its **renderer** does `fetch(mediaUrl(T.path))` — allowed, since
   `media://` is `supportFetchAPI` with `ACAO:*` — and reads the `ReadableStream` in
   chunks. **No new filesystem exposure**: it reuses the existing scheme and only ever
   streams the *one* selected file's bytes; the peer never receives a path or fs access.
2. Send `{type:'load', transferId, track:{title,artist,album,codec,durationSec,ext,size}}`
   on `control`, then the raw chunks on `media`, then `{type:'loaded', transferId}`.
3. Receiver assembles chunks. Two playback paths for its engine:
   - **Blob (recommended default):** collect chunks → `new Blob(parts, {type: mimeFor(ext)})`
     → `URL.createObjectURL(blob)` → feed the engine. Works for **all** of Folderify's
     formats because it's the same decode path as a normal `<audio>` `src`. Slightly higher
     time-to-first-sound (wait for enough/all bytes), but LAN transfer of a 3–10 MB song is
     ~sub-second on Wi-Fi.
   - **MSE (optimization, mp3/aac only):** append chunks to a `MediaSource` `SourceBuffer`
     for progressive start + seeking. **[confirmed]** MSE can append raw MP3 (`audio/mpeg`)
     segments. **Caveat:** MSE codec support is **narrower** than `<audio>` — flac/wav/ogg
     are often not MSE-appendable in Chromium. So gate MSE to mp3/aac and fall back to Blob
     otherwise. Start with **Blob-only**; add MSE later if first-sound latency bothers you.

`engine.ts` gains a **"remote source" mode**: today it does `audio.src = mediaUrl(path)`;
add `engine.loadRemote(objectUrlOrMediaSourceUrl, startTime)` that points the same
`<audio>` element at the blob/MSE URL. Everything downstream (SeekBar, TransportControls,
tray/MediaSession) keeps working unchanged.

### Control protocol + clock sync
Authoritative-**source** model with a monotonic control counter to resolve hand-off races.

```
// clock sync (both directions, every ~2s on `control`)
{ type:'ping', t0 }            ->    { type:'pong', t0, t1 }
//  offset ≈ ((t1 - t0) - rtt/2); keep a smoothed estimate

// source announces state (on load, play, pause, seek, and every ~1s while playing)
{ type:'state', ctr, trackId, playing:true, position:P, atSourceClock:C }

// hand-off: the peer that picks a NEW track claims control
{ type:'takeControl', ctr }   // higher ctr wins; both sides adopt the new source
```

- Receiver computes target position = `P + (nowReceiverClock - offset) - C` and sets
  `currentTime` when it diverges by **> ~150 ms**, else lets it free-run (nudging avoids
  audible re-seeks). Play/pause/seek are immediate state messages.
- **Hand-off:** picking a track sends `takeControl` with `ctr = lastCtr + 1`; whoever holds
  the highest `ctr` is the source. This is last-writer-wins with a total order, so a
  simultaneous "both grab the aux cord" resolves deterministically.
- Two-way works because the transfer direction simply flips: when B picks a track, **B**
  becomes source and streams B's file bytes to A.

### Discovery + signaling (zero servers)
- **Discovery (main process):** advertise a Bonjour/mDNS service `_folderify._tcp` with the
  host name + the signaling port, using a pure-JS lib (`bonjour-service`) so there's no
  native build. The other instance browses and lists discovered peers.
- **Pairing:** show a 6-digit **PIN** on the host; the joiner enters it. The PIN is verified
  during signaling before the peer connection is accepted — stops a random LAN device from
  connecting.
- **Signaling (main process WebSocket):** once a peer is discovered (IP + port), main opens
  a WS to it and relays the WebRTC handshake: **SDP offer/answer + ICE candidates**. The
  **renderer** creates the `RTCPeerConnection` and produces/consumes SDP/ICE, passed to/from
  main over preload IPC. Keeping signaling in **main** means the renderer never opens a
  `ws://` socket, so the **strict CSP stays untouched** (RTCPeerConnection itself is *not*
  governed by `connect-src`).
- **STUN/TURN:** **not needed on a pure LAN** — host ICE candidates (the private LAN IPs)
  connect directly. **[needs device test]** Chromium obfuscates local IPs in ICE candidates
  behind `.local` **mDNS hostnames** by default; on the same LAN this normally resolves
  fine, but if it doesn't, either rely on the host candidates we gather ourselves or set
  Electron's `webRTCIPHandlingPolicy`/disable the mDNS-hide feature. Verify on two real
  machines early.

### Security
- **Encryption:** WebRTC data channels are **DTLS-encrypted** end to end by default.
- **Pairing:** the PIN gates connection; reject unpaired/mismatched offers.
- **No filesystem exposure:** the peer receives only the **bytes of the currently-selected
  track** plus the metadata you choose to send — never a path, never fs access, never
  arbitrary files. There is no path-traversal surface because the source, not the peer,
  chooses and fetches the file.
- **CSP/sandbox intact:** `RTCPeerConnection` runs in the sandboxed renderer with
  `contextIsolation`/`sandbox` on; signaling lives in main, so no CSP relaxation is needed.
- **[needs device test]** Confirm `RTCPeerConnection` instantiates cleanly under the current
  Electron/macOS build (one verification claim about newer macOS + WebRTC couldn't be
  confirmed before the research run was cut off — a 5-minute smoke test settles it).

### Legal / ethical note
Streaming **your own** library to **one friend** for a personal listen-together session is
ordinary personal use, materially like playing your files at home. **At product scale**,
though — public rooms, many listeners, or a hosted relay — retransmitting copyrighted audio
to others has real copyright implications (it starts to look like distribution/public
performance) that local personal playback does not. Not a blocker for a 1:1 LAN feature;
flag it before any "rooms"/internet expansion.

---

## Phased implementation plan (mapped to Folderify's files)

**Phase 0 — discovery + signaling plumbing (main).**
`src/main/listen/discovery.ts` (mDNS advertise/browse via `bonjour-service`),
`src/main/listen/signaling.ts` (WS server + client that relays SDP/ICE, gated by PIN).
Preload: add a `window.api.listen` surface (advertise, browse, connect(peer, pin),
send/recv signaling). Milestone: two instances discover each other and exchange arbitrary
JSON over the LAN.

**Phase 1 — peer connection (renderer).**
`src/renderer/src/listen/peer.ts` — build the `RTCPeerConnection`, the `control` + `media`
data channels, and the SDP/ICE dance driven over IPC. `src/renderer/src/state/listen-store.ts`
(zustand): connection state, peer name, role (source/receiver), PIN, errors. Milestone:
`control` channel open; ping/pong RTT + clock offset working.

**Phase 2 — control protocol + sync.**
Implement the state machine (source announces; receiver follows) and the clock-synced
position matching + drift correction. Wire it to `player-store`: when I'm **source** and a
track starts/seeks/pauses, broadcast `state`; when I'm **receiver**, drive the engine from
remote `state`. Milestone: play/pause/seek stays in sync with *both* sides holding the same
already-transferred file.

**Phase 3 — media transfer + receiver playback.**
Source `fetch(media://)` → chunk → `media` channel (with `bufferedAmount` backpressure).
Receiver assembles → Blob URL → `engine.loadRemote()`. Add the "remote source" mode to
`src/renderer/src/audio/engine.ts`. Milestone: pick a song on A, hear it on B, in sync,
neither has to have the other's files.

**Phase 4 — UI.**
A "Listen Together" panel/sheet: discover & pick a peer, show/enter PIN, connection status,
who's the source, and a "playing from <peer>" indicator on the now-playing bar. New
components + a sidebar/top-bar entry; keep it consistent with the existing layout tokens.

**Phase 5 — polish + hardening.**
Drift-correction tuning, reconnect on drop, clear error states (peer left, transfer failed,
PIN wrong), MSE fast-start for mp3/aac, and the PIN/pairing hardening. Optional: preload the
*next* track's bytes during the current one for gapless hand-off.

## Open questions to settle on-device (cheap tests, do these first)
1. Does Chromium's mDNS ICE obfuscation let two LAN peers connect with default settings, or
   do we need to gather/relay host candidates ourselves? (Phase 0/1.)
2. `RTCPeerConnection` smoke test under the current Electron + macOS build.
3. First-sound latency of the Blob path for a large FLAC on Wi-Fi — is MSE worth it?

## Dependencies to add
- `bonjour-service` (pure-JS mDNS; no native build — consistent with the project's
  "no native modules" rule). WebRTC and MSE are built into Chromium/Electron — no deps.
