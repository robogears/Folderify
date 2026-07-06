import { create } from 'zustand'
import * as session from '../listen/session'
import type { QueueItem, HorizonItem } from '@shared/listen'

/**
 * Listen Together — UI state machine for the Connect panel. Real networking (LAN
 * discovery + WebRTC data-channel streaming) lives in ../listen/session, which this
 * store delegates to and which pushes state back here. Pairing is APPROVAL-based (no
 * PIN): you click a discovered device, the other Mac gets an Allow/Deny prompt (and can
 * trust you forever). When the native backend is absent (browser harness), the session
 * falls back to a local simulation. See docs/listen-together-design.md.
 */

export type ListenStatus = 'idle' | 'discovering' | 'connecting' | 'connected' | 'error'

export interface ListenPeer {
  id: string
  name: string
}

/** Once connected, who is currently driving playback. */
export type ListenRole = 'source' | 'receiver' | null

interface ListenState {
  /** Transient: whether the Connect panel is open. */
  panelOpen: boolean
  status: ListenStatus
  /** Name shown to the other Mac when we advertise ourselves. */
  deviceName: string
  /** This Mac's LAN IPv4 address(es) — shown so a peer can connect by IP. */
  localAddresses: string[]
  /** Devices found on the LAN. */
  peers: ListenPeer[]
  /** The peer we're connecting to / connected to. */
  peer: ListenPeer | null
  /** A peer asking to connect to US — drives the Allow/Deny prompt (callee side). */
  incoming: ListenPeer | null
  role: ListenRole
  error: string | null
  /** What the connected peer has queued (titles only; via queue-notice frames). */
  peerQueue: QueueItem[]
  /** The source's upcoming play order (next ~20; drives display + prefetch). */
  peerHorizon: HorizonItem[]

  openPanel: () => void
  closePanel: () => void
  startDiscovery: () => void
  stopDiscovery: () => void
  /** Connect to a discovered peer (the peer approves, or auto-accepts if it trusts us). */
  connectToPeer: (peer: ListenPeer) => void
  /** Connect to a peer by typed IP (multicast fallback). */
  connectByIp: (host: string) => void
  /** Answer an incoming request (callee): Allow/Deny + whether to trust forever. */
  respondIncoming: (accept: boolean, trust: boolean) => void
  /** Clear every trusted device — each will be re-prompted on its next connect. */
  forgetTrusted: () => void
  disconnect: () => void
}

export const useListen = create<ListenState>((set, get) => ({
  panelOpen: false,
  status: 'idle',
  deviceName: 'This Mac',
  localAddresses: [],
  peers: [],
  peer: null,
  incoming: null,
  role: null,
  error: null,
  peerQueue: [],
  peerHorizon: [],

  openPanel: () => {
    set({ panelOpen: true })
    // Begin advertising + discovery + signaling; adopt our real name + LAN IPs.
    void session.start().then((info) => {
      if (info) set({ deviceName: info.name, localAddresses: info.addresses })
    })
  },

  closePanel: () => {
    if (get().status === 'connected') {
      set({ panelOpen: false }) // keep the live session; just hide the UI
    } else {
      session.stop()
      set({ panelOpen: false, status: 'idle', peers: [], peer: null, incoming: null, error: null })
    }
  },

  startDiscovery: () => {
    set({ status: 'discovering', error: null })
    session.discover()
  },

  stopDiscovery: () => {
    session.stopDiscovery()
    set({ status: 'idle' })
  },

  connectToPeer: (peer) => {
    set({ status: 'connecting', peer, error: null })
    session.connect(peer)
  },

  connectByIp: (host) => {
    const h = host.trim()
    if (!h) return
    set({ status: 'connecting', peer: { id: `manual:${h}`, name: h }, error: null })
    session.connectManual(h)
  },

  respondIncoming: (accept, trust) => {
    session.respondIncoming(accept, trust)
    set({ incoming: null })
  },

  forgetTrusted: () => session.forgetTrusted(),

  disconnect: () => {
    session.disconnect() // teardown() resets status / peer / role
  }
}))
