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

/** Control-channel protocol, renderer ↔ renderer over the data channel. */
export type ControlMsg =
  | { t: 'ping'; t0: number }
  | { t: 'pong'; t0: number; t1: number }
  | {
      t: 'load'
      transferId: number
      size: number
      meta: RemoteTrackMeta
      position: number
      playing: boolean
    }
  | { t: 'loaded'; transferId: number }
  | { t: 'load-failed'; transferId: number }
  | { t: 'state'; playing: boolean; position: number; atClock: number; transferId: number }
  | { t: 'command'; cmd: 'play' | 'pause' | 'seek'; value?: number }
  /** Sent whenever a side's up-next queue changes: what THAT side has queued.
   *  Coordinates whose track takes the next slot (source's queue wins) and lets
   *  the peer render the shared "Up next" view. */
  | { t: 'queue-notice'; items: QueueItem[] }
  | { t: 'bye' }

/** LAN discovery beacon group + port (link-local multicast, TTL 1). */
export const LISTEN_MULTICAST_ADDR = '239.255.71.14'
export const LISTEN_MULTICAST_PORT = 50777
/** Preferred fixed TCP signaling port, so "connect by IP" knows where to reach a peer
 *  even when multicast discovery is blocked. Falls back to an ephemeral port if taken. */
export const LISTEN_SIG_PORT = 50778
/** Max bytes per data-channel binary send (SCTP-safe portable chunk size). */
export const LISTEN_CHUNK_SIZE = 16 * 1024
/** Hard ceiling on a single streamed track (the whole file buffers in renderer memory
 *  before playback). Larger than any real audio file; caps a malicious/buggy peer that
 *  declares a huge `size` and streams forever. 1 GiB. */
export const LISTEN_MAX_TRANSFER = 1024 * 1024 * 1024

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
