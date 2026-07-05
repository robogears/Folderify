// LAN peer discovery via a self-rolled UDP multicast beacon (no dependency, no
// native module). Each running instance periodically announces {id, name, sigPort}
// to a link-local multicast group and ages out peers it stops hearing from. This is
// deliberately simpler than full mDNS: both ends are Folderify, so a private group +
// tiny JSON payload is enough, and it sidesteps mDNS name-resolution flakiness.

import dgram from 'node:dgram'
import { LISTEN_MULTICAST_ADDR, LISTEN_MULTICAST_PORT } from '../../shared/listen'
import type { ListenPeer } from '../../shared/listen'

interface SelfInfo {
  id: string
  name: string
  sigPort: number
}

interface KnownPeer extends ListenPeer {
  host: string
  sigPort: number
  lastSeen: number
}

const ANNOUNCE_MS = 2000
const REAP_MS = 2000
const STALE_MS = 6500

export class Discovery {
  private socket?: dgram.Socket
  private announceTimer?: ReturnType<typeof setInterval>
  private reapTimer?: ReturnType<typeof setInterval>
  private peers = new Map<string, KnownPeer>()

  constructor(
    private self: SelfInfo,
    private onChange: (peers: ListenPeer[]) => void
  ) {}

  start(): void {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', (err) => console.error('[listen] discovery socket error:', err))
    socket.on('message', (buf, rinfo) => this.onMessage(buf, rinfo.address))
    socket.bind(LISTEN_MULTICAST_PORT, () => {
      try {
        socket.addMembership(LISTEN_MULTICAST_ADDR)
        socket.setMulticastTTL(1) // link-local only — never leaves the subnet
        socket.setMulticastLoopback(true)
      } catch (err) {
        console.error('[listen] discovery membership failed:', err)
      }
      this.announce()
    })
    this.socket = socket
    this.announceTimer = setInterval(() => this.announce(), ANNOUNCE_MS)
    this.reapTimer = setInterval(() => this.reap(), REAP_MS)
  }

  private announce(): void {
    const msg = JSON.stringify({
      t: 'announce',
      id: this.self.id,
      name: this.self.name,
      sigPort: this.self.sigPort
    })
    try {
      this.socket?.send(msg, LISTEN_MULTICAST_PORT, LISTEN_MULTICAST_ADDR)
    } catch {
      /* transient send failure — the next tick retries */
    }
  }

  private onMessage(buf: Buffer, host: string): void {
    let m: Record<string, unknown>
    try {
      m = JSON.parse(buf.toString('utf8'))
    } catch {
      return
    }
    if (!m || m.id === this.self.id) return // ignore our own beacon
    if (m.t === 'announce') {
      this.peers.set(String(m.id), {
        id: String(m.id),
        name: String(m.name || 'Mac'),
        host,
        sigPort: Number(m.sigPort) || 0,
        lastSeen: Date.now()
      })
      this.emit()
    } else if (m.t === 'bye') {
      if (this.peers.delete(String(m.id))) this.emit()
    }
  }

  private reap(): void {
    const now = Date.now()
    let changed = false
    for (const [id, p] of this.peers) {
      if (now - p.lastSeen > STALE_MS) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  private emit(): void {
    this.onChange([...this.peers.values()].map((p) => ({ id: p.id, name: p.name })))
  }

  lookup(id: string): KnownPeer | undefined {
    return this.peers.get(id)
  }

  stop(): void {
    if (this.announceTimer) clearInterval(this.announceTimer)
    if (this.reapTimer) clearInterval(this.reapTimer)
    this.announceTimer = undefined
    this.reapTimer = undefined
    try {
      const bye = JSON.stringify({ t: 'bye', id: this.self.id })
      this.socket?.send(bye, LISTEN_MULTICAST_PORT, LISTEN_MULTICAST_ADDR)
    } catch {
      /* ignore */
    }
    try {
      this.socket?.close()
    } catch {
      /* ignore */
    }
    this.socket = undefined
    this.peers.clear()
  }
}
