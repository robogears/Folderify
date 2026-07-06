// WebRTC signaling relay over a plain TCP socket (node:net, no dependency). Both ends
// are Folderify main processes, so newline-delimited JSON is enough. This carries the
// pairing handshake — an APPROVAL model (no PIN): the caller sends its stable id + name,
// and the callee either auto-accepts a TRUSTED id or prompts its user (Allow / Deny,
// with an option to trust the device forever). Then it relays the renderers' SDP/ICE
// opaquely. Exactly one active connection at a time.

import net from 'node:net'
import { LISTEN_SIG_PORT, type ListenPeer } from '../../shared/listen'

interface SignalingOpts {
  getIdentity: () => { id: string; name: string }
  /** Has this peer id been trusted before? (→ auto-accept, no prompt) */
  isTrusted: (id: string) => boolean
  /** A not-yet-trusted peer is asking to connect — prompt the user (→ respond()). */
  onIncoming: (peer: ListenPeer) => void
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

/** How long the callee's approval prompt (and the caller's wait) stay open. */
const APPROVE_TIMEOUT_MS = 30_000

export class Signaling {
  private server?: net.Server
  private active?: net.Socket
  private pending?: { sock: net.Socket; peer: ListenPeer; timer: ReturnType<typeof setTimeout> }
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

  // --- Callee side: a peer wants to connect. Auto-accept if trusted, else prompt. ---
  private handleIncoming(sock: net.Socket): void {
    sock.on('error', () => {})
    if (this.active || this.pending) {
      writeLine(sock, { t: 'reject', reason: 'busy' })
      sock.end()
      return
    }
    let helloSeen = false
    attachLineReader(sock, (m) => {
      if (!helloSeen) {
        if (m.t !== 'hello') return
        helloSeen = true
        const peer: ListenPeer = { id: String(m.id ?? ''), name: String(m.name ?? 'Mac') }
        if (peer.id && this.opts.isTrusted(peer.id)) {
          this.acceptSock(sock, peer)
          return
        }
        // Hold the socket and ask the user.
        const timer = setTimeout(() => {
          if (this.pending?.sock === sock) {
            writeLine(sock, { t: 'reject', reason: 'timeout' })
            try {
              sock.end()
            } catch {
              /* ignore */
            }
            this.pending = undefined
            // We clear `pending` before sock.end()'s async 'close' fires, so that handler's
            // guard is already false — notify here or the callee's Allow/Deny prompt hangs
            // on screen forever (and a late Allow silently no-ops).
            this.opts.onClosed()
          }
        }, APPROVE_TIMEOUT_MS)
        this.pending = { sock, peer, timer }
        this.opts.onIncoming(peer)
        return
      }
      this.route(m)
    })
    sock.on('close', () => {
      if (this.pending?.sock === sock) {
        clearTimeout(this.pending.timer)
        this.pending = undefined
        // Caller gave up before we answered — tell the UI to drop the Allow/Deny prompt.
        this.opts.onClosed()
      }
    })
  }

  private acceptSock(sock: net.Socket, peer: ListenPeer): void {
    this.active = sock
    const me = this.opts.getIdentity()
    writeLine(sock, { t: 'accept', id: me.id, name: me.name })
    sock.on('close', () => this.onSocketClosed(sock))
    this.opts.onConnected({ role: 'callee', peer })
  }

  /** The callee user's decision on the pending incoming request. Returns the peer so
   *  the caller of respond() (main) can persist trust when asked. */
  respond(accept: boolean): ListenPeer | null {
    const p = this.pending
    if (!p) return null
    clearTimeout(p.timer)
    this.pending = undefined
    if (accept) {
      this.acceptSock(p.sock, p.peer)
    } else {
      writeLine(p.sock, { t: 'reject', reason: 'declined' })
      try {
        p.sock.end()
      } catch {
        /* ignore */
      }
    }
    return p.peer
  }

  // --- Caller side: reach out to a discovered peer (no PIN; the callee approves). ---
  connect(host: string, port: number, me: { id: string; name: string }, peer: ListenPeer): void {
    if (this.active || this.pending) {
      this.opts.onError('busy')
      return
    }
    const sock = net.createConnection({ host, port }, () => {
      writeLine(sock, { t: 'hello', id: me.id, name: me.name })
    })
    // Longer than the callee's prompt window so their reject arrives first.
    const timeout = setTimeout(() => {
      this.opts.onError('timeout')
      sock.destroy()
    }, APPROVE_TIMEOUT_MS + 5_000)
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

  private clearPending(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      try {
        this.pending.sock.end()
      } catch {
        /* ignore */
      }
      this.pending = undefined
    }
  }

  disconnect(): void {
    this.clearPending()
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
    this.clearPending()
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
