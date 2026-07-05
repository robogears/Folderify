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
import { mediaUrl } from '@shared/ipc'
import type { Track } from '@shared/models'
import type { ControlMsg, ListenPeer, RemoteTrackMeta, SignalPayload } from '@shared/listen'
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
let prevTrackId: string | null = null
let prevPlaying = false

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
  connectedPeer = p
  role = 'idle'
  useListen.setState({ status: 'connecting', peer: p, role: null, error: null, panelOpen: true })
  peer = new ListenPeerConn(peerRole, (sp) => window.api.listen.sendSignal(sp), {
    onControl: (m) => handleControl(m as ControlMsg),
    onBytes: handleBytes,
    onOpen: onChannelOpen,
    onClose: teardown
  })
  void peer.start()
}

function onSignalError(e: { reason: string; message: string }): void {
  const st = useListen.getState()
  useListen.setState({
    status: st.peer ? 'pairing' : 'discovering',
    error: pinErrorText(e.reason)
  })
}

function onChannelOpen(): void {
  useListen.setState({ status: 'connected', error: null })
  startTimers()
  // If we're already playing a local track, immediately source it to the new peer.
  const s = usePlayer.getState()
  prevTrackId = s.currentTrackId
  prevPlaying = s.isPlaying
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
  peer.send({ t: 'load', transferId, size: track.size, meta, position, playing })
  try {
    const res = await fetch(mediaUrl(track.path))
    if (!res.ok || !res.body) return
    const reader = res.body.getReader()
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
// the source; a play/pause change re-broadcasts state.
function onPlayerChange(s: PlayerSnapshot): void {
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
    case 'state':
      applyRemoteState(m)
      break
    case 'command':
      applyCommandAsSource(m)
      break
    case 'bye':
      teardown()
      break
  }
}

function beginReceive(m: Extract<ControlMsg, { t: 'load' }>): void {
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
}

function handleBytes(buf: ArrayBuffer): void {
  if (!rx || rx.done) return
  rx.chunks.push(new Uint8Array(buf))
  rx.received += buf.byteLength
  if (rx.received >= rx.size) finalizeReceive(rx.transferId)
}

function finalizeReceive(transferId: number): void {
  if (!rx || rx.transferId !== transferId || rx.done) return
  rx.done = true
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
  pingTimer = undefined
  stateTimer = undefined
}

function teardown(): void {
  stopTimers()
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

  useListen.setState({ status: 'idle', peer: null, role: null })
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
export async function start(): Promise<{ name: string; pin: string } | null> {
  if (!hasNative) {
    return { name: 'This Mac', pin: String(Math.floor(100000 + Math.random() * 900000)) }
  }
  initNative()
  try {
    const info = await window.api.listen.start()
    return { name: info.name, pin: info.pin }
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
