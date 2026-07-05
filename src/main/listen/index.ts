// Wires LAN discovery + the signaling relay together and exposes them to the
// renderer over IPC. WebRTC itself lives in the renderer (Chromium); main only
// discovers peers and relays the PIN handshake + SDP/ICE. See the Listen section
// of docs/listen-together-design.md.

import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { Discovery } from './discovery'
import { Signaling } from './signaling'

interface Identity {
  id: string
  name: string
  pin: string
}

function friendlyHostName(): string {
  const h = os.hostname().replace(/\.local$/i, '').trim()
  return h || 'Mac'
}

function genPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export function registerListen(getWindow: () => BrowserWindow | null): () => void {
  function send(channel: string, payload: unknown): void {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  let discovery: Discovery | undefined
  let signaling: Signaling | undefined
  let identity: Identity = { id: '', name: friendlyHostName(), pin: '' }

  function teardownNet(): void {
    signaling?.stop()
    signaling = undefined
    discovery?.stop()
    discovery = undefined
  }

  // Start advertising + browsing + the signaling server. Idempotent; returns our
  // identity (name + the PIN the other Mac must enter to connect to us).
  ipcMain.handle('listen:start', async () => {
    if (!signaling) {
      identity = { id: randomUUID(), name: friendlyHostName(), pin: genPin() }
      signaling = new Signaling({
        getPin: () => identity.pin,
        getIdentity: () => ({ id: identity.id, name: identity.name }),
        onConnected: (c) => send('listen:connected', c),
        onSignal: (payload) => send('listen:signal', payload),
        onError: (reason) => send('listen:error', { reason, message: reason }),
        onClosed: () => send('listen:disconnected', {})
      })
      await new Promise<void>((resolve) => {
        signaling!.start((port) => {
          discovery = new Discovery(
            { id: identity.id, name: identity.name, sigPort: port },
            (peers) => send('listen:peers', peers)
          )
          discovery.start()
          resolve()
        })
      })
    }
    return { id: identity.id, name: identity.name, pin: identity.pin }
  })

  ipcMain.handle('listen:connect', async (_e, arg: unknown) => {
    const { peerId, pin } = (arg ?? {}) as { peerId?: string; pin?: string }
    const peer = peerId ? discovery?.lookup(String(peerId)) : undefined
    if (!peer) return { ok: false, error: 'peer-gone' }
    signaling?.connect(
      peer.host,
      peer.sigPort,
      String(pin ?? ''),
      { id: identity.id, name: identity.name },
      { id: peer.id, name: peer.name }
    )
    return { ok: true }
  })

  ipcMain.on('listen:signal', (_e, payload) => signaling?.sendSignal(payload))

  ipcMain.handle('listen:disconnect', async () => {
    signaling?.disconnect()
    return { ok: true }
  })

  ipcMain.handle('listen:stop', async () => {
    teardownNet()
    return { ok: true }
  })

  return teardownNet
}
