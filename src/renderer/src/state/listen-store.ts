import { create } from 'zustand'
import * as session from '../listen/session'
import type { QueueItem } from '@shared/listen'

/**
 * Listen Together — UI state machine for the Connect panel. Real networking (LAN
 * discovery + WebRTC data-channel streaming) lives in ../listen/session, which this
 * store delegates to and which pushes state back here. When the native backend is
 * absent (browser harness), the session falls back to a local simulation so the UI
 * still works. See docs/listen-together-design.md.
 */

export type ListenStatus =
  | 'idle'
  | 'discovering'
  | 'pairing'
  | 'connecting'
  | 'connected'
  | 'error'

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
  /** 6-digit code the other Mac must enter to pair with us. */
  pin: string
  /** This Mac's LAN IPv4 address(es) — shown so a peer can connect by IP. */
  localAddresses: string[]
  /** Devices found on the LAN. */
  peers: ListenPeer[]
  /** The peer we're pairing with / connected to. */
  peer: ListenPeer | null
  role: ListenRole
  error: string | null
  /** What the connected peer has queued (titles only; via queue-notice frames). */
  peerQueue: QueueItem[]

  openPanel: () => void
  closePanel: () => void
  startDiscovery: () => void
  stopDiscovery: () => void
  selectPeer: (peer: ListenPeer) => void
  /** Pair with a peer entered by IP address (multicast fallback). */
  connectByIp: (host: string) => void
  confirmPairing: (enteredPin: string) => void
  cancelPairing: () => void
  disconnect: () => void
}

function makePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export const useListen = create<ListenState>((set, get) => ({
  panelOpen: false,
  status: 'idle',
  deviceName: 'This Mac',
  pin: makePin(),
  localAddresses: [],
  peers: [],
  peer: null,
  role: null,
  error: null,
  peerQueue: [],

  openPanel: () => {
    set({ panelOpen: true })
    // Begin advertising + discovery + signaling; adopt our real name, PIN, and LAN IPs.
    void session.start().then((info) => {
      if (info) set({ deviceName: info.name, pin: info.pin, localAddresses: info.addresses })
    })
  },

  closePanel: () => {
    if (get().status === 'connected') {
      set({ panelOpen: false }) // keep the live session; just hide the UI
    } else {
      session.stop()
      set({ panelOpen: false, status: 'idle', peers: [], peer: null, error: null })
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

  selectPeer: (peer) => set({ status: 'pairing', peer, error: null }),

  connectByIp: (host) => {
    const h = host.trim()
    if (!h) return
    set({ status: 'pairing', peer: { id: `manual:${h}`, name: h }, error: null })
  },

  confirmPairing: (enteredPin) => {
    const code = enteredPin.trim()
    if (code.length < 6) {
      set({ error: 'Enter the 6-digit code shown on the other Mac.' })
      return
    }
    const peer = get().peer
    if (!peer) return
    set({ status: 'connecting', error: null })
    if (peer.id.startsWith('manual:')) session.connectManual(peer.id.slice('manual:'.length), code)
    else session.connect(peer, code)
  },

  cancelPairing: () => {
    session.cancel()
    set({ status: 'idle', peer: null, error: null })
  },

  disconnect: () => {
    session.disconnect() // teardown() resets status / peer / role
  }
}))
