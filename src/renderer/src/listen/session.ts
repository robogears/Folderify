// The Listen Together session controller — the protocol brain that sits between the
// native transport (window.api.listen + WebRTC peer) and the app's stores/engine.
//
// Model: whoever last picks a track is the "source". The source plays locally as
// normal AND streams the encoded file bytes to the peer; the receiver reassembles them
// into a Blob, plays its own copy, and stays in lockstep via a clock-synced control
// protocol. Either side can grab control by picking a track. See
// docs/listen-together-design.md.
//
// When the native backend is absent (plain-browser harness / non-Electron), everything
// falls back to a local SIMULATION so the Connect UI still works for development.

import { engine } from '../audio/engine'
import { usePlayer } from '../state/player-store'
import { useLibrary } from '../state/library-store'
import { useListen } from '../state/listen-store'
import { useNotice } from '../state/notice-store'
import { mediaUrl } from '@shared/ipc'
import type { Track } from '@shared/models'
import { LISTEN_MAX_TRANSFER } from '@shared/listen'
import type {
  ControlMsg,
  ListenPeer,
  QueueItem,
  RemoteTrackMeta,
  SignalPayload
} from '@shared/listen'
import { ListenPeerConn } from './peer'

const hasNative = typeof window !== 'undefined' && !!window.api?.listen

type PlayerSnapshot = ReturnType<typeof usePlayer.getState>

// --- Session state ---
let peer: ListenPeerConn | null = null
let role: 'idle' | 'source' | 'receiver' = 'idle'
let connectedPeer: ListenPeer | null = null
let applyingRemote = false
let transferSeq = 0
let currentTransferId = 0
let currentBlobUrl: string | null = null
let clockOffset = 0 // estimated (sourceClock - myClock) in ms
let pingTimer: number | undefined
let stateTimer: number | undefined
let connectTimer: number | undefined
let rxStallTimer: number | undefined
let prevTrackId: string | null = null
let prevPlaying = false
// Whether the peer has tracks in ITS up-next queue (kept fresh via queue-notice).
let peerHasNext = false
let prevUpNext: string[] = []

// Abandon an in-progress receive if no bytes arrive for this long (source died /
// unreadable file). Reset on every chunk, so it fires on a STALL, not on total size.
const RX_STALL_MS = 20000

interface RxState {
  transferId: number
  size: number
  meta: RemoteTrackMeta
  position: number
  playing: boolean
  chunks: Uint8Array[]
  received: number
  done: boolean
}
let rx: RxState | null = null

// Relay the receiver's transport intents to the source (which is authoritative).
const relay = (c: { type: 'play' | 'pause' | 'seek'; value?: number }): void => {
  peer?.send({ t: 'command', cmd: c.type, value: c.value })
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i + 1).toLowerCase() : ''
}

function mimeFor(ext: string): string {
  switch (ext) {
    case 'm4a':
    case 'aac':
    case 'mp4':
      return 'audio/mp4'
    case 'flac':
      return 'audio/flac'
    case 'wav':
      return 'audio/wav'
    case 'ogg':
    case 'oga':
    case 'opus':
      return 'audio/ogg'
    case 'aif':
    case 'aiff':
    case 'aifc':
      return 'audio/aiff'
    default:
      return 'audio/mpeg'
  }
}

function synthTrack(transferId: number, meta: RemoteTrackMeta, size: number): Track {
  return {
    id: `remote:${transferId}`,
    path: '',
    mtimeMs: 0,
    size,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    albumArtist: meta.artist,
    year: null,
    trackNo: null,
    trackOf: null,
    discNo: null,
    genre: '',
    durationSec: meta.durationSec,
    hasArt: false,
    codec: meta.codec,
    unsupported: false,
    playlistId: '__remote__'
  }
}

function pinErrorText(reason: string): string {
  switch (reason) {
    case 'pin':
      return "That code didn't match. Check the code on the other Mac and try again."
    case 'timeout':
      return "The other Mac didn't respond. Make sure Listen Together is open there."
    case 'busy':
      return 'That Mac is already in a listening session.'
    case 'locked':
      return 'Too many wrong codes — pairing is locked. Close and reopen Listen Together to try again.'
    case 'peer-gone':
      return 'That device is no longer nearby.'
    default:
      return "Couldn't connect. Make sure both Macs are on the same Wi-Fi."
  }
}

// ============================================================ native transport wiring
let nativeInited = false
function initNative(): void {
  if (nativeInited || !hasNative) return
  nativeInited = true
  const api = window.api.listen
  api.onPeers((peers) => useListen.setState({ peers }))
  api.onConnected((c) => onConnected(c.role, c.peer))
  api.onSignal((payload) => void peer?.handleSignal(payload as SignalPayload))
  api.onError((e) => onSignalError(e))
  api.onDisconnected(() => teardown())
}

function onConnected(peerRole: 'caller' | 'callee', p: ListenPeer): void {
  console.info('[listen] signaling connected as', peerRole, '→ peer', p.name)
  connectedPeer = p
  role = 'idle'
  useListen.setState({ status: 'connecting', peer: p, role: null, error: null, panelOpen: true })
  peer = new ListenPeerConn(peerRole, (sp) => window.api.listen.sendSignal(sp), {
    onControl: (m) => handleControl(m as ControlMsg),
    onBytes: handleBytes,
    onOpen: onChannelOpen,
    onClose: onPeerClosed
  })
  void peer.start()
  // No WebRTC connection-attempt timeout exists natively — if ICE never completes
  // (permission blocked, different subnets) the UI would hang on "Connecting…" forever.
  if (connectTimer) window.clearTimeout(connectTimer)
  connectTimer = window.setTimeout(() => {
    if (useListen.getState().status !== 'connected') onPeerClosed('timeout')
  }, 15000)
}

// The WebRTC connection dropped or never established. If we never reached a working
// session, that almost always means a blocked LAN path (permission / different Wi-Fi) —
// say so instead of silently returning to idle. A drop after a working session just
// returns to idle quietly (the disconnect is self-explanatory).
function onPeerClosed(_reason?: string): void {
  const neverConnected = useListen.getState().status === 'connecting'
  teardown()
  if (neverConnected) {
    useListen.setState({
      status: 'idle',
      error:
        "Couldn't establish a direct connection. Check that both Macs are on the same " +
        'Wi-Fi and that you allowed the “find devices on your local network” prompt, then try again.'
    })
  }
}

function onSignalError(e: { reason: string; message: string }): void {
  const st = useListen.getState()
  useListen.setState({
    status: st.peer ? 'pairing' : 'discovering',
    error: pinErrorText(e.reason)
  })
}

function onChannelOpen(): void {
  console.info('[listen] session ready — data channel open')
  if (connectTimer) {
    window.clearTimeout(connectTimer)
    connectTimer = undefined
  }
  useListen.setState({ status: 'connected', error: null })
  startTimers()
  // If we're already playing a local track, immediately source it to the new peer.
  const s = usePlayer.getState()
  prevTrackId = s.currentTrackId
  prevPlaying = s.isPlaying
  // Tell the peer what we already have queued (and prime the change detector).
  prevUpNext = s.upNext
  if (s.upNext.length > 0) sendQueueNotice(s.upNext)
  const local = localTrack(s.currentTrackId)
  if (local) void becomeSourceFor(local, s.currentTime, s.isPlaying)
}

// ============================================================ source side
function localTrack(id: string | null): Track | undefined {
  if (!id || id.startsWith('remote:')) return undefined
  return useLibrary.getState().tracksById.get(id)
}

async function becomeSourceFor(track: Track, position: number, playing: boolean): Promise<void> {
  if (!peer) return
  role = 'source'
  useListen.setState({ role: 'source' })
  const transferId = ++transferSeq
  currentTransferId = transferId
  const meta: RemoteTrackMeta = {
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSec: track.durationSec,
    codec: track.codec,
    ext: extOf(track.path)
  }
  console.info('[listen] sourcing track to peer:', track.title, `(${track.size} bytes)`)
  peer.send({ t: 'load', transferId, size: track.size, meta, position, playing })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const res = await fetch(mediaUrl(track.path))
    if (!res.ok || !res.body) {
      // Unreadable file (e.g. an online-only cloud file on this Mac). Tell the peer
      // so it can clear its "loading" state instead of hanging on the track title.
      if (currentTransferId === transferId) peer.send({ t: 'load-failed', transferId })
      return
    }
    reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (currentTransferId !== transferId) return // superseded by a newer track
      if (value) await peer.sendBytes(value)
    }
    if (currentTransferId === transferId) {
      peer.send({ t: 'loaded', transferId })
      sendState()
    }
  } catch (err) {
    console.error('[listen] stream error:', err)
    if (currentTransferId === transferId) peer.send({ t: 'load-failed', transferId })
  } finally {
    // Cancel the reader on EVERY exit (done, supersession, teardown, error) so the
    // underlying media:// fs.createReadStream in main is released promptly, not at GC.
    try {
      await reader?.cancel()
    } catch {
      /* ignore */
    }
  }
}

function sendState(): void {
  if (role !== 'source' || !peer) return
  const s = usePlayer.getState()
  peer.send({
    t: 'state',
    playing: s.isPlaying,
    position: engine.currentTime,
    atClock: performance.now(),
    transferId: currentTransferId
  })
}

function applyCommandAsSource(m: Extract<ControlMsg, { t: 'command' }>): void {
  if (role !== 'source') return
  if (m.cmd === 'play') void engine.play()
  else if (m.cmd === 'pause') engine.pause()
  else if (m.cmd === 'seek' && typeof m.value === 'number') {
    engine.seek(m.value)
    sendState()
  }
}

// React to local playback changes: picking a local track (while connected) makes us
// the source; a play/pause change re-broadcasts state; an up-next change tells the
// peer what we have queued (so the shared "Up next" view and the gate stay fresh).
function onPlayerChange(s: PlayerSnapshot): void {
  if (connectedPeer && s.upNext !== prevUpNext) {
    prevUpNext = s.upNext
    sendQueueNotice(s.upNext)
  }
  if (!connectedPeer || applyingRemote) {
    prevTrackId = s.currentTrackId
    prevPlaying = s.isPlaying
    return
  }
  const local = localTrack(s.currentTrackId)
  if (local) {
    if (s.currentTrackId !== prevTrackId) void becomeSourceFor(local, s.currentTime, s.isPlaying)
    else if (s.isPlaying !== prevPlaying && role === 'source') sendState()
  }
  prevTrackId = s.currentTrackId
  prevPlaying = s.isPlaying
}

// ============================================================ shared queue
function sendQueueNotice(upNext: string[]): void {
  const lib = useLibrary.getState()
  const items: QueueItem[] = upNext.slice(0, 50).flatMap((id) => {
    const t = lib.tracksById.get(id)
    return t ? [{ title: t.title, artist: t.artist }] : []
  })
  peer?.send({ t: 'queue-notice', items } satisfies ControlMsg)
}

function applyQueueNotice(m: Extract<ControlMsg, { t: 'queue-notice' }>): void {
  // Peer data — validate shape and cap sizes before it touches state/UI.
  const items = Array.isArray(m.items)
    ? m.items.slice(0, 50).map((it) => ({
        title: String(it?.title ?? '').slice(0, 200),
        artist: String(it?.artist ?? '').slice(0, 200)
      }))
    : []
  peerHasNext = items.length > 0
  useListen.setState({ peerQueue: items })
}

/**
 * Consulted by player-store's next(auto) while connected — decides whose queued
 * track takes the next slot. Precedence: the SOURCE's own queue wins; the receiver's
 * queue takes the slot only when the source has nothing queued. Both engines end at
 * ~the same moment (both play local copies in lockstep), so each side deciding from
 * the same shared state keeps them from grabbing the slot simultaneously.
 * Returns true when the session consumed the advance.
 */
function queueGate(): boolean {
  if (!connectedPeer) return false
  const st = usePlayer.getState()
  if (st.remote) {
    // Receiver: take the slot with our queued track only if the source has none —
    // returning false lets the store's upNext logic play it (→ handoff streams it).
    return !(st.upNext.length > 0 && !peerHasNext)
  }
  // Source side: a takeover stream already incoming → never start a competing one.
  if (rx && !rx.done) return true
  if (st.upNext.length > 0) return false // our own queue wins — store plays it
  if (peerHasNext) {
    // Peer's queued track takes the slot: hold here; their engine ends in lockstep
    // and they stream it to us via the normal handoff.
    console.info('[listen] holding auto-advance — peer has the next track queued')
    return true
  }
  return false
}

// ============================================================ receiver side
function handleControl(m: ControlMsg): void {
  switch (m.t) {
    case 'ping':
      peer?.send({ t: 'pong', t0: m.t0, t1: performance.now() })
      break
    case 'pong': {
      const rtt = performance.now() - m.t0
      clockOffset = m.t1 + rtt / 2 - performance.now()
      break
    }
    case 'load':
      beginReceive(m)
      break
    case 'loaded':
      finalizeReceive(m.transferId)
      break
    case 'load-failed':
      if (rx && rx.transferId === m.transferId) {
        clearRxStall()
        rx = null
        useNotice.getState().show('The other Mac couldn’t send that track.')
      }
      break
    case 'state':
      applyRemoteState(m)
      break
    case 'command':
      applyCommandAsSource(m)
      break
    case 'queue-notice':
      applyQueueNotice(m)
      break
    case 'bye':
      teardown()
      break
  }
}

function beginReceive(m: Extract<ControlMsg, { t: 'load' }>): void {
  clearRxStall()
  // Validate the peer-declared size — a malicious/buggy peer could send a huge or
  // nonsensical size to exhaust renderer memory (the whole file buffers before play).
  if (!Number.isFinite(m.size) || m.size < 0 || m.size > LISTEN_MAX_TRANSFER) {
    rx = null
    useNotice.getState().show('Skipped a track that was too large to stream.')
    return
  }
  rx = {
    transferId: m.transferId,
    size: m.size,
    meta: m.meta,
    position: m.position,
    playing: m.playing,
    chunks: [],
    received: 0,
    done: false
  }
  armRxStall()
}

function handleBytes(buf: ArrayBuffer): void {
  if (!rx || rx.done) return
  rx.chunks.push(new Uint8Array(buf))
  rx.received += buf.byteLength
  // A peer must never exceed the size it declared — abort if it overruns.
  if (rx.received > rx.size) {
    clearRxStall()
    rx = null
    return
  }
  if (rx.received === rx.size) {
    finalizeReceive(rx.transferId)
    return
  }
  armRxStall() // more to come — keep the stall watchdog alive
}

function finalizeReceive(transferId: number): void {
  if (!rx || rx.transferId !== transferId || rx.done) return
  clearRxStall()
  rx.done = true
  console.info('[listen] received track:', rx.meta.title, `(${rx.received} bytes) → playing`)
  const blob = new Blob(rx.chunks as BlobPart[], { type: mimeFor(rx.meta.ext) })
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
  currentBlobUrl = URL.createObjectURL(blob)

  role = 'receiver'
  const track = synthTrack(transferId, rx.meta, rx.size)
  applyingRemote = true
  useLibrary.getState().setRemoteTrack(track)
  usePlayer.setState({
    currentTrackId: track.id,
    duration: rx.meta.durationSec ?? 0,
    currentTime: rx.position,
    isPlaying: rx.playing,
    remote: true,
    _relay: relay
  })
  applyingRemote = false
  useListen.setState({ role: 'receiver' })
  engine.loadRemote(currentBlobUrl, rx.position, rx.playing)
}

function applyRemoteState(m: Extract<ControlMsg, { t: 'state' }>): void {
  if (role !== 'receiver') return
  applyingRemote = true
  usePlayer.setState({ isPlaying: m.playing })
  applyingRemote = false
  if (m.playing) void engine.play()
  else engine.pause()
  // Extrapolate the source's current position using the estimated clock offset.
  const sourceNow = performance.now() + clockOffset
  const elapsed = m.playing ? (sourceNow - m.atClock) / 1000 : 0
  const target = m.position + elapsed
  if (Number.isFinite(target) && Math.abs(engine.currentTime - target) > 0.4) {
    engine.seek(Math.max(0, target))
  }
}

// ============================================================ timers + teardown
function startTimers(): void {
  stopTimers()
  pingTimer = window.setInterval(() => peer?.send({ t: 'ping', t0: performance.now() }), 2000)
  stateTimer = window.setInterval(() => {
    if (role === 'source') sendState()
  }, 1000)
}
function stopTimers(): void {
  if (pingTimer) window.clearInterval(pingTimer)
  if (stateTimer) window.clearInterval(stateTimer)
  if (connectTimer) window.clearTimeout(connectTimer)
  pingTimer = undefined
  stateTimer = undefined
  connectTimer = undefined
}

// Receiver-side stall watchdog: abandon an in-progress transfer if bytes stop arriving.
function armRxStall(): void {
  clearRxStall()
  rxStallTimer = window.setTimeout(() => {
    if (rx && !rx.done) {
      rx = null
      useNotice.getState().show('The other Mac stopped sending the track.')
    }
  }, RX_STALL_MS)
}
function clearRxStall(): void {
  if (rxStallTimer) window.clearTimeout(rxStallTimer)
  rxStallTimer = undefined
}

function teardown(): void {
  stopTimers()
  clearRxStall()
  clearSim()
  try {
    peer?.close()
  } catch {
    /* ignore */
  }
  peer = null
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = null
  }
  const wasReceiver = role === 'receiver'
  role = 'idle'
  connectedPeer = null
  rx = null
  clockOffset = 0
  currentTransferId = 0
  peerHasNext = false

  applyingRemote = true
  if (wasReceiver) {
    engine.pause()
    useLibrary.getState().setRemoteTrack(null)
    usePlayer.setState({
      remote: false,
      _relay: null,
      isPlaying: false,
      currentTrackId: null,
      currentTime: 0,
      duration: 0
    })
  } else {
    usePlayer.setState({ remote: false, _relay: null })
  }
  applyingRemote = false

  useListen.setState({ status: 'idle', peer: null, role: null, peerQueue: [] })
}

// ============================================================ simulation fallback
let simDiscover: number | undefined
let simConnect: number | undefined
function clearSim(): void {
  if (simDiscover) window.clearTimeout(simDiscover)
  if (simConnect) window.clearTimeout(simConnect)
  simDiscover = undefined
  simConnect = undefined
}

// ============================================================ public API (store → session)
export async function start(): Promise<{
  name: string
  pin: string
  addresses: string[]
} | null> {
  if (!hasNative) {
    return {
      name: 'This Mac',
      pin: String(Math.floor(100000 + Math.random() * 900000)),
      addresses: ['192.168.1.42']
    }
  }
  initNative()
  try {
    const info = await window.api.listen.start()
    return { name: info.name, pin: info.pin, addresses: info.addresses }
  } catch {
    return null
  }
}

export function stop(): void {
  if (hasNative) void window.api.listen.stop()
  teardown()
}

export function discover(): void {
  if (!hasNative) {
    clearSim()
    simDiscover = window.setTimeout(() => {
      if (useListen.getState().status === 'discovering') {
        useListen.setState({ peers: [{ id: 'sim-1', name: 'Kitchen Mac' }] })
      }
    }, 1400)
  }
  // Native: peers already stream in via onPeers.
}

export function stopDiscovery(): void {
  clearSim()
}

export function connect(p: ListenPeer, pin: string): void {
  if (!hasNative) {
    clearSim()
    simConnect = window.setTimeout(() => {
      connectedPeer = p
      role = 'source'
      useListen.setState({ status: 'connected', peer: p, role: 'source', error: null })
    }, 900)
    return
  }
  void window.api.listen.connect(p.id, pin).then((r) => {
    if (!r.ok) onSignalError({ reason: r.error ?? 'peer-gone', message: r.error ?? '' })
  })
}

export function connectManual(host: string, pin: string): void {
  if (!hasNative) {
    connect({ id: `manual:${host}`, name: host }, pin)
    return
  }
  void window.api.listen.connectManual(host, pin).then((r) => {
    if (!r.ok) onSignalError({ reason: r.error ?? 'network', message: r.error ?? '' })
  })
}

export function cancel(): void {
  if (hasNative && useListen.getState().status === 'connecting') void window.api.listen.disconnect()
  clearSim()
}

export function disconnect(): void {
  if (hasNative) void window.api.listen.disconnect()
  teardown()
}

// Detect local playback to drive the source side. Registered once at module load;
// no-ops until a session is connected.
usePlayer.subscribe(onPlayerChange)
// Queue coordination hook — the gate no-ops until a session is connected.
usePlayer.setState({ _queueGate: queueGate })
