// Wires LAN discovery + the signaling relay together and exposes them to the renderer
// over IPC. WebRTC itself lives in the renderer (Chromium); main only discovers peers,
// runs the APPROVAL pairing handshake (no PIN — trusted ids auto-accept, unknown ones
// prompt the user), and relays SDP/ICE. See docs/listen-together-design.md.

import { app, ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Discovery } from './discovery'
import { Signaling } from './signaling'
import { safeResolveUnder } from '../path-safety'
import {
  LISTEN_COVER_MAX_BYTES,
  LISTEN_MAX_TRANSFER,
  LISTEN_SIG_PORT,
  type ListenPeer
} from '../../shared/listen'

interface Identity {
  id: string
  name: string
}

function friendlyHostName(): string {
  const h = os.hostname().replace(/\.local$/i, '').trim()
  return h || 'Mac'
}

/** This Mac's non-internal IPv4 addresses (for "connect by IP" when discovery fails). */
function localAddresses(): string[] {
  const out: string[] = []
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const a of iface ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address)
    }
  }
  return out
}

export function registerListen(
  getWindow: () => BrowserWindow | null,
  getRoot: () => string | null
): () => void {
  function send(channel: string, payload: unknown): void {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  // ── Persistent identity (stable id so peers can trust this Mac across sessions) ──
  const identityFile = (): string => path.join(app.getPath('userData'), 'listen-identity.json')
  function loadOrCreateId(): string {
    try {
      const j = JSON.parse(readFileSync(identityFile(), 'utf8')) as { id?: string }
      if (typeof j.id === 'string' && j.id) return j.id
    } catch {
      /* first run */
    }
    const id = randomUUID()
    try {
      writeFileSync(identityFile(), JSON.stringify({ id }))
    } catch {
      /* ignore */
    }
    return id
  }

  // ── Trusted peers (id → name). A trusted id auto-accepts; others prompt. ──
  const trustFile = (): string => path.join(app.getPath('userData'), 'listen-trusted.json')
  const trusted = new Map<string, string>()
  function loadTrusted(): void {
    try {
      const j = JSON.parse(readFileSync(trustFile(), 'utf8')) as { peers?: { id?: string; name?: string }[] }
      if (Array.isArray(j.peers)) for (const p of j.peers) if (p?.id) trusted.set(String(p.id), String(p.name ?? ''))
    } catch {
      /* none yet */
    }
  }
  function saveTrusted(): void {
    try {
      writeFileSync(
        trustFile(),
        JSON.stringify({ peers: [...trusted].map(([id, name]) => ({ id, name })) })
      )
    } catch {
      /* ignore */
    }
  }

  // Read a track's album-art thumbnail for the source to stream (JPEG from the app's own
  // thumbs dir — id is hex-validated so the path can't traverse). lg preferred; falls back
  // to sm when lg is missing or too big to fit one data-channel frame.
  ipcMain.handle('listen:read-cover', async (_e, id: unknown) => {
    if (typeof id !== 'string' || !/^[0-9a-f]{8,64}$/i.test(id)) return null
    const dir = path.join(app.getPath('userData'), 'thumbs')
    for (const size of ['lg', 'sm'] as const) {
      try {
        const buf = await readFile(path.join(dir, `${id}_${size}.jpg`))
        if (buf.byteLength === 0 || buf.byteLength > LISTEN_COVER_MAX_BYTES) continue
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      } catch {
        /* try the next size */
      }
    }
    return null
  })

  // Read a track's bytes for the source to stream (main owns disk; confined to root).
  ipcMain.handle('listen:read-track', async (_e, p: unknown) => {
    const root = getRoot()
    if (!root || typeof p !== 'string' || !p) return null
    const safe = safeResolveUnder(root, p)
    if (!safe) return null
    try {
      const buf = await readFile(safe)
      if (buf.byteLength > LISTEN_MAX_TRANSFER) return null
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } catch {
      return null
    }
  })

  let discovery: Discovery | undefined
  let signaling: Signaling | undefined
  let sigPort = 0
  let identity: Identity = { id: '', name: friendlyHostName() }
  let netStarted: Promise<void> | null = null

  function teardownNet(): void {
    signaling?.stop()
    signaling = undefined
    discovery?.stop()
    discovery = undefined
    sigPort = 0
    netStarted = null
  }

  // Advertise + browse + run signaling for the app's lifetime — so a TRUSTED peer can
  // connect whenever this Mac is running (no need to open the panel first), and an
  // untrusted request pops the Allow/Deny prompt. Idempotent.
  function startNet(): Promise<void> {
    if (netStarted) return netStarted
    identity = { id: loadOrCreateId(), name: friendlyHostName() }
    loadTrusted()
    signaling = new Signaling({
      getIdentity: () => ({ id: identity.id, name: identity.name }),
      isTrusted: (id) => trusted.has(id),
      onIncoming: (peer) => send('listen:incoming', peer),
      onConnected: (c) => send('listen:connected', c),
      onSignal: (payload) => send('listen:signal', payload),
      onError: (reason) => send('listen:error', { reason, message: reason }),
      onClosed: () => send('listen:disconnected', {})
    })
    netStarted = new Promise<void>((resolve) => {
      signaling!.start((port) => {
        sigPort = port
        discovery = new Discovery(
          { id: identity.id, name: identity.name, sigPort: port },
          (peers) => send('listen:peers', peers)
        )
        discovery.start()
        resolve()
      })
    })
    return netStarted
  }

  // Opening the panel just ensures net is up (usually already is) and returns identity.
  ipcMain.handle('listen:start', async () => {
    await startNet()
    return { id: identity.id, name: identity.name, addresses: localAddresses(), sigPort }
  })

  ipcMain.handle('listen:connect', async (_e, arg: unknown) => {
    const { peerId } = (arg ?? {}) as { peerId?: string }
    const peer = peerId ? discovery?.lookup(String(peerId)) : undefined
    if (!peer) return { ok: false, error: 'peer-gone' }
    signaling?.connect(
      peer.host,
      peer.sigPort,
      { id: identity.id, name: identity.name },
      { id: peer.id, name: peer.name }
    )
    return { ok: true }
  })

  // Connect by typed IP when multicast discovery doesn't surface the peer.
  ipcMain.handle('listen:connect-manual', async (_e, arg: unknown) => {
    const { host } = (arg ?? {}) as { host?: string }
    const cleanHost = String(host ?? '').trim()
    if (!cleanHost || !signaling || !/^[a-zA-Z0-9._:-]+$/.test(cleanHost)) {
      return { ok: false, error: 'network' }
    }
    signaling.connect(
      cleanHost,
      LISTEN_SIG_PORT,
      { id: identity.id, name: identity.name },
      { id: `manual:${cleanHost}`, name: cleanHost }
    )
    return { ok: true }
  })

  // The callee user's Allow/Deny (+ trust) decision on an incoming request.
  ipcMain.handle('listen:respond', async (_e, arg: unknown) => {
    const { accept, trust } = (arg ?? {}) as { accept?: boolean; trust?: boolean }
    const peer: ListenPeer | null = signaling?.respond(accept === true) ?? null
    if (accept === true && trust === true && peer?.id) {
      trusted.set(peer.id, peer.name)
      saveTrusted()
    }
    return { ok: true }
  })

  // Forget all trusted devices (Settings → they'll be re-prompted next time).
  ipcMain.handle('listen:forget-trusted', async () => {
    trusted.clear()
    saveTrusted()
    return { ok: true }
  })

  ipcMain.on('listen:signal', (_e, payload) => signaling?.sendSignal(payload))

  ipcMain.handle('listen:disconnect', async () => {
    signaling?.disconnect()
    return { ok: true }
  })

  // Panel close no longer tears down net (we stay discoverable/connectable while the app
  // runs); it only drops any live connection.
  ipcMain.handle('listen:stop', async () => {
    signaling?.disconnect()
    return { ok: true }
  })

  // Start advertising immediately at app launch so trusted peers can connect anytime.
  void startNet()

  return teardownNet
}
