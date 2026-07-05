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
  | { t: 'state'; playing: boolean; position: number; atClock: number; transferId: number }
  | { t: 'command'; cmd: 'play' | 'pause' | 'seek'; value?: number }
  | { t: 'bye' }

/** LAN discovery beacon group + port (link-local multicast, TTL 1). */
export const LISTEN_MULTICAST_ADDR = '239.255.71.14'
export const LISTEN_MULTICAST_PORT = 50777
/** Max bytes per data-channel binary send (SCTP-safe portable chunk size). */
export const LISTEN_CHUNK_SIZE = 16 * 1024
