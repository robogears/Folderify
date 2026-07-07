// Shared contract for the "Listen Together" LAN feature (design:
// docs/listen-together-design.md). Imported by main (discovery/signaling relay),
// preload (window.api.listen), and the renderer (peer + session).
//
// Keep this DOM-free — it compiles under the node tsconfig too. WebRTC SDP/ICE are
// carried as plain strings/objects and reconstituted into RTC types in the renderer.

/** A device discovered on the LAN. */
export interface ListenPeer {
  id: string
  name: string
}

/** Who a just-established signaling connection belongs to. */
export interface ListenConnected {
  role: 'caller' | 'callee'
  peer: ListenPeer
}

export interface ListenErrorPayload {
  reason: string
  message: string
}

/** WebRTC handshake payloads relayed opaquely by main between the two renderers. */
export type SignalPayload =
  | { kind: 'sdp'; type: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }

/** Metadata the source sends so the receiver can display the now-playing track. */
export interface RemoteTrackMeta {
  title: string
  artist: string
  album: string
  durationSec: number | null
  codec: string
  ext: string
}

/** A queued-track summary shared so both sides can see what's up next. */
export interface QueueItem {
  title: string
  artist: string
}

/** One upcoming track in the source's play order (manual queue + context). */
export interface HorizonItem {
  /** Source-local track id — the cache/prefetch key. Never a path. */
  srcId: string
  title: string
  artist: string
  durationSec: number | null
  /** ORIGINAL file size (display/budgeting; a transcoded transfer may be smaller). */
  size: number
  ext: string
}

/**
 * Control-channel protocol, renderer ↔ renderer over the data channel.
 *
 * Transfers are TAGGED: every binary frame carries a 4-byte LE transferId header
 * (LISTEN_FRAME_HEADER), so a live track and background prefetches can interleave.
 * `load` = "switch playback to this now" (receiver replies `need` or `have`);
 * `prefetch` = "bytes you asked for via `fetch`, cache them for later".
 */
export type ControlMsg =
  | { t: 'ping'; t0: number }
  | { t: 'pong'; t0: number; t1: number }
  | {
      t: 'load'
      transferId: number
      srcId: string
      /** Size of the TRANSFER bytes (transcoded size when compressed). */
      size: number
      /** Container of the transfer bytes ('mp3', 'webm', …) — not always the track ext. */
      container: string
      meta: RemoteTrackMeta
      position: number
      playing: boolean
    }
  /** Receiver → source: I don't have it, stream the bytes. */
  | { t: 'need'; transferId: number }
  /** Receiver → source: cached from a prefetch — skip streaming entirely. */
  | { t: 'have'; transferId: number }
  | { t: 'loaded'; transferId: number }
  | { t: 'load-failed'; transferId: number }
  /** Receiver → source: please background-stream this horizon track. */
  | { t: 'fetch'; srcId: string }
  | { t: 'fetch-failed'; srcId: string }
  /** Source → receiver: header for prefetch bytes tagged `transferId`. */
  | { t: 'prefetch'; transferId: number; srcId: string; size: number; container: string }
  | { t: 'prefetch-done'; transferId: number }
  /** Either direction: transfer was preempted/cancelled — drop its partial bytes. */
  | { t: 'xfer-abort'; transferId: number }
  | { t: 'state'; playing: boolean; position: number; atClock: number; transferId: number }
  | { t: 'command'; cmd: 'play' | 'pause' | 'seek'; value?: number }
  /** Sent whenever a side's up-next queue changes: what THAT side has queued.
   *  Coordinates whose track takes the next slot (source's queue wins) and lets
   *  the peer render the shared "Up next" view. */
  | { t: 'queue-notice'; items: QueueItem[] }
  /** Source → receiver: the next ~20 tracks in play order (drives display + prefetch). */
  | { t: 'horizon'; items: HorizonItem[] }
  /** Source → receiver: a track's album art (JPEG, base64). Sent alongside `load` and
   *  `prefetch` so the receiver can render cover art for streamed tracks. */
  | { t: 'cover'; srcId: string; b64: string }
  | { t: 'bye' }

/** LAN discovery beacon group + port (link-local multicast, TTL 1). */
export const LISTEN_MULTICAST_ADDR = '239.255.71.14'
export const LISTEN_MULTICAST_PORT = 50777
/** Preferred fixed TCP signaling port, so "connect by IP" knows where to reach a peer
 *  even when multicast discovery is blocked. Falls back to an ephemeral port if taken. */
export const LISTEN_SIG_PORT = 50778
/** Max PAYLOAD bytes per data-channel binary frame. Both ends are Chromium (SCTP max
 *  message ~256 KB), so 64 KB is safe and ~3× faster than the old 16 KB. */
export const LISTEN_CHUNK_SIZE = 64 * 1024
/** Bytes of transfer-id header prepended to every binary frame (uint32 LE). */
export const LISTEN_FRAME_HEADER = 4
/** Hard ceiling on a single streamed track (the whole file buffers in renderer memory
 *  before playback). Larger than any real audio file; caps a malicious/buggy peer that
 *  declares a huge `size` and streams forever. 1 GiB. */
export const LISTEN_MAX_TRANSFER = 1024 * 1024 * 1024
/** How many upcoming tracks the source broadcasts in its horizon. */
export const LISTEN_HORIZON_COUNT = 20
/** How many upcoming tracks the receiver keeps pre-downloaded. */
export const LISTEN_PREFETCH_COUNT = 5
/** Receiver prefetch-cache caps (LRU eviction past either limit). */
export const LISTEN_CACHE_MAX_ENTRIES = 8
export const LISTEN_CACHE_MAX_BYTES = 256 * 1024 * 1024
/** Cover-art transfer caps: raw thumb bytes read on the source, and the base64 string
 *  the receiver will accept (~4/3 of raw + slack). Comfortably under the ~256 KB SCTP
 *  message ceiling so a cover always fits ONE control frame. */
export const LISTEN_COVER_MAX_BYTES = 160 * 1024
export const LISTEN_COVER_MAX_B64 = 224 * 1024
/** How many covers the receiver keeps decoded (data URLs, tiny). */
export const LISTEN_COVER_CACHE_MAX = 24

/** Identity + reachability returned when advertising starts. */
export interface ListenIdentity {
  id: string
  name: string
  pin: string
  /** This Mac's LAN IPv4 address(es) — shown so a peer can connect by IP. */
  addresses: string[]
  /** The TCP signaling port actually bound (LISTEN_SIG_PORT unless it was taken). */
  sigPort: number
}
