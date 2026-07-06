// WebRTC signaling relay over a plain TCP socket (node:net, no dependency). Both
// ends are Folderify main processes, so newline-delimited JSON is enough — no WS
// handshake needed. This carries the PIN pairing handshake and then relays the
// renderers' SDP/ICE opaquely. Exactly one active connection at a time.

import net from 'node:net'
import { LISTEN_SIG_PORT, type ListenPeer } from '../../shared/listen'

interface SignalingOpts {
  /** The 6-digit code an incoming caller must present to be accepted. */
  getPin: () => string
  getIdentity: () => { id: string; name: string }
  onConnected: (c: { role: 'caller' | 'callee'; peer: ListenPeer }) => void
  onSignal: (payload: unknown) => void
  onError: (reason: string) => void
  onClosed: () => void
}

function attachLineReader(sock: net.Socket, onLine: (obj: Record<string, unknown>) => void): void {
  let buf = ''
  sock.setEncoding('utf8')
  sock.on('data', (d: string) => {
    buf += d
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (!line.trim()) continue
      let obj: Record<string, unknown>
      try {
        obj = JSON.parse(line)
      } catch {
        continue
      }
      onLine(obj)
    }
  })
}

function writeLine(sock: net.Socket, obj: unknown): void {
  try {
    sock.write(JSON.stringify(obj) + '\n')
  } catch {
    /* ignore */
  }
}

/** Wrong-PIN attempts allowed per session before pairing locks. A 6-digit PIN has no
 *  brute-force resistance on its own; capping attempts is what makes it safe on a LAN. */
const MAX_PIN_FAILURES = 5

export class Signaling {
  private server?: net.Server
  private active?: net.Socket
  private pinFailures = 0
  private locked = false
  port = 0

  constructor(private opts: SignalingOpts) {}

  start(cb: (port: number) => void): void {
    const server = net.createServer((sock) => this.handleIncoming(sock))
    const onListening = (): void => {
      const addr = server.address()
      this.port = addr && typeof addr === 'object' ? addr.port : 0
      cb(this.port)
    }
    let triedEphemeral = false
    server.on('error', (err: NodeJS.ErrnoException) => {
      // Preferred fixed port is taken (another instance on this Mac) — fall back to an
      // ephemeral one. Manual "connect by IP" then only works for the fixed-port peer.
      if (err.code === 'EADDRINUSE' && !triedEphemeral) {
        triedEphemeral = true
        server.listen(0, '0.0.0.0')
        return
      }
      console.error('[listen] signaling server error:', err)
    })
    server.on('listening', onListening)
    server.listen(LISTEN_SIG_PORT, '0.0.0.0')
    this.server = server
  }

  // --- Callee side: a peer connected to us and must present the right PIN. ---
  private handleIncoming(sock: net.Socket): void {
    sock.on('error', () => {})
    // Too many wrong PINs this session → refuse all further attempts. The attacker
    // can't keep guessing; the user re-opens the panel to get a fresh PIN.
    if (this.locked) {
      writeLine(sock, { t: 'reject', reason: 'locked' })
      sock.end()
      return
    }
    if (this.active) {
      writeLine(sock, { t: 'reject', reason: 'busy' })
      sock.end()
      return
    }
    let helloSeen = false
    attachLineReader(sock, (m) => {
      if (!helloSeen) {
        if (m.t !== 'hello') return
        helloSeen = true
        if (String(m.pin) !== this.opts.getPin()) {
          this.pinFailures++
          if (this.pinFailures >= MAX_PIN_FAILURES) {
            this.locked = true
            this.opts.onError('locked')
          }
          writeLine(sock, { t: 'reject', reason: this.locked ? 'locked' : 'pin' })
          sock.end()
          return
        }
        this.active = sock
        const me = this.opts.getIdentity()
        writeLine(sock, { t: 'accept', id: me.id, name: me.name })
        sock.on('close', () => this.onSocketClosed(sock))
        this.opts.onConnected({
          role: 'callee',
          peer: { id: String(m.id ?? ''), name: String(m.name ?? 'Mac') }
        })
        return
      }
      this.route(m)
    })
  }

  // --- Caller side: we reach out to a discovered peer with their PIN. ---
  connect(
    host: string,
    port: number,
    pin: string,
    me: { id: string; name: string },
    peer: ListenPeer
  ): void {
    if (this.active) {
      this.opts.onError('busy')
      return
    }
    const sock = net.createConnection({ host, port }, () => {
      writeLine(sock, { t: 'hello', pin, id: me.id, name: me.name })
    })
    const timeout = setTimeout(() => {
      this.opts.onError('timeout')
      sock.destroy()
    }, 8000)
    let accepted = false
    sock.on('error', () => {
      clearTimeout(timeout)
      if (!accepted) this.opts.onError('network')
    })
    attachLineReader(sock, (m) => {
      if (!accepted) {
        if (m.t === 'accept') {
          accepted = true
          clearTimeout(timeout)
          this.active = sock
          sock.on('close', () => this.onSocketClosed(sock))
          this.opts.onConnected({
            role: 'caller',
            peer: { id: String(m.id ?? peer.id), name: String(m.name ?? peer.name) }
          })
        } else if (m.t === 'reject') {
          clearTimeout(timeout)
          this.opts.onError(String(m.reason ?? 'refused'))
          sock.end()
        }
        return
      }
      this.route(m)
    })
  }

  private route(m: Record<string, unknown>): void {
    if (m.t === 'signal') this.opts.onSignal(m.payload)
    else if (m.t === 'bye') this.disconnect()
  }

  sendSignal(payload: unknown): void {
    if (this.active) writeLine(this.active, { t: 'signal', payload })
  }

  private onSocketClosed(sock: net.Socket): void {
    if (this.active === sock) {
      this.active = undefined
      this.opts.onClosed()
    }
  }

  disconnect(): void {
    const s = this.active
    if (!s) return
    this.active = undefined
    writeLine(s, { t: 'bye' })
    try {
      s.end()
    } catch {
      /* ignore */
    }
    this.opts.onClosed()
  }

  stop(): void {
    this.disconnect()
    try {
      this.server?.close()
    } catch {
      /* ignore */
    }
    this.server = undefined
    this.port = 0
  }
}
