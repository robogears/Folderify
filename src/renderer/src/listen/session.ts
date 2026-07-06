// The Listen Together session controller — the protocol brain that sits between the
// native transport (window.api.listen + WebRTC peer) and the app's stores/engine.
//
// Model: whoever last picks a track is the "source". The source plays locally as normal
// AND streams the track's encoded bytes to the peer; the receiver plays its own copy in
// lockstep via a clock-synced control protocol. Either side can grab control by picking
// a track. See docs/listen-together-design.md.
//
// Speed features (all optional / degrade gracefully):
//  - TRANSCODE: lossless (flac/wav) tracks are re-encoded to Opus/WebM in memory on the
//    source (8-10× smaller on the wire, and MSE-streamable). Library files are never
//    touched. Behind the "compress transfers" setting; any failure sends the original.
//  - PROGRESSIVE PLAYBACK: mp3 + webm play via MediaSource as bytes arrive (~1s start);
//    other containers buffer to a Blob and play on completion.
//  - PREFETCH: the source broadcasts its next ~20 tracks (the "horizon"); the receiver
//    pre-downloads the next few into an LRU cache, so skipping to them is instant.
//    Transfers are TAGGED (peer.ts frames each chunk with its transferId) so a live
//    track and background prefetches share one channel; a live pick preempts prefetch.
//
// When the native backend is absent (browser harness), everything falls back to a local
// SIMULATION so the Connect UI still works for development.

import { engine } from '../audio/engine'
import { usePlayer } from '../state/player-store'
import { useLibrary } from '../state/library-store'
import { useListen } from '../state/listen-store'
import { useNotice } from '../state/notice-store'
import { useSettings } from '../state/settings-store'
import type { Track } from '@shared/models'
import {
  LISTEN_MAX_TRANSFER,
  LISTEN_HORIZON_COUNT,
  LISTEN_PREFETCH_COUNT,
  LISTEN_CACHE_MAX_ENTRIES,
  LISTEN_CACHE_MAX_BYTES,
  type ControlMsg,
  type HorizonItem,
  type ListenPeer,
  type QueueItem,
  type RemoteTrackMeta,
  type SignalPayload
} from '@shared/listen'
import { shouldTranscode, transcodeToOpusWebm } from './transcode'
import { ListenPeerConn } from './peer'

const hasNative = typeof window !== 'undefined' && !!window.api?.listen

type PlayerSnapshot = ReturnType<typeof usePlayer.getState>

// --- Session state ---
let peer: ListenPeerConn | null = null
let role: 'idle' | 'source' | 'receiver' = 'idle'
let connectedPeer: ListenPeer | null = null
let applyingRemote = false
let transferSeq = 0
let currentTransferId = 0 // the live playback transfer (source + receiver)
let clockOffset = 0 // estimated (sourceClock - myClock) in ms
const clockSamples: { rtt: number; offset: number }[] = [] // min-RTT filter window
let pingTimer: number | undefined
let stateTimer: number | undefined
let syncTimer: number | undefined // receiver: continuous clock-follow tick
let connectTimer: number | undefined
let rxStallTimer: number | undefined
let prevTrackId: string | null = null
let prevPlaying = false
let peerHasNext = false
let prevUpNext: string[] = []
// Receiver's last authoritative snapshot from the source — drives the sync follower.
let lastRemoteState: { position: number; atClock: number; playing: boolean } | null = null
let prevRemotePlaying = false
let syncNudging = false // hysteresis latch: are we currently applying a tempo nudge?
let activatedTransferId = 0 // the transfer the engine is ACTUALLY playing (guards syncTick)

// Sync follower (receiver tracks the source's clock). Instead of tolerating up to 0.4s
// of skew and then hard-seeking, we hold the offset near zero with tiny tempo nudges and
// reserve seeks for big jumps — so the two Macs play ~1:1.
const SYNC_TICK_MS = 250 // how often the receiver re-checks its offset
// Hysteresis (not a single deadband): only START nudging past ENGAGE, and keep nudging
// until back within RELEASE. HTMLMediaElement.currentTime is quantized to ~10-20ms, so a
// single 20ms deadband would chatter the rate at the threshold; ENGAGE sits safely above it.
const SYNC_ENGAGE = 0.045 // > 45 ms off → begin correcting
const SYNC_RELEASE = 0.02 // ≤ 20 ms off → stop correcting (play at exactly 1.0)
const SYNC_HARD_SEEK = 0.25 // > 250 ms: too far to slew, snap with a seek
const SYNC_MAX_SLEW = 0.05 // cap the tempo nudge at ±5% (inaudible, pitch-preserved)
const SYNC_GAIN = 0.5 // proportional gain: rate = 1 − GAIN·error

const RX_STALL_MS = 20000

// ── Source-side transfer prep cache: srcId → prepared {bytes, container} ──────
interface Prepared {
  bytes: Uint8Array
  container: string
}
const srcCache = new Map<string, Prepared>()
const pendingLoads = new Map<number, string>() // live transferId → srcId (awaiting need/have)
let prefetchAbort = false // set true to preempt an in-flight prefetch stream

// ── Receiver-side prefetch cache (LRU) + active-transfer registry ────────────
const prefetchCache = new Map<string, Prepared>() // srcId → cached bytes (insertion-ordered)
let prefetchCacheBytes = 0
const requestedPrefetch = new Set<string>() // srcId currently being prefetched (one at a time)
let peerHorizonItems: HorizonItem[] = [] // last horizon received (drives prefetch)

interface MseSink {
  ms: MediaSource
  url: string
  sb: SourceBuffer | null
  queue: Uint8Array[]
  wantEnd: boolean
}
interface PlaySink {
  kind: 'play'
  transferId: number
  srcId: string
  container: string
  size: number
  meta: RemoteTrackMeta
  position: number
  playing: boolean
  received: number
  chunks: Uint8Array[] // always accumulated (blob fallback + cache)
  mse: MseSink | null
  done: boolean
}
interface PrefetchSink {
  kind: 'prefetch'
  transferId: number
  srcId: string
  container: string
  size: number
  chunks: Uint8Array[]
  received: number
}
type RxSink = PlaySink | PrefetchSink
const rxByTransfer = new Map<number, RxSink>()
let currentBlobUrl: string | null = null // the live <audio> object URL (blob or MSE)

const relay = (c: { type: 'play' | 'pause' | 'seek'; value?: number }): void => {
  peer?.send({ t: 'command', cmd: c.type, value: c.value })
}

function extOf(p: string): string {
  const i = p.lastIndexOf('.')
  return i >= 0 ? p.slice(i + 1).toLowerCase() : ''
}

/** Playback MIME for a transfer container. */
function mimeForContainer(container: string): string {
  switch (container) {
    case 'webm':
      return 'audio/webm; codecs="opus"'
    case 'm4a':
    case 'aac':
    case 'mp4':
      return 'audio/mp4'
    case 'flac':
      return 'audio/flac'
    case 'wav':
    case 'wave':
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
      return 'audio/mpeg' // mp3 + fallback
  }
}

/** Containers we play progressively via MediaSource (start before full download). */
function mseCapable(container: string): boolean {
  if (container !== 'mp3' && container !== 'webm') return false
  try {
    return typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mimeForContainer(container))
  } catch {
    return false
  }
}

function synthTrack(id: string, meta: RemoteTrackMeta, size: number): Track {
  return {
    id,
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

function connectErrorText(reason: string): string {
  switch (reason) {
    case 'declined':
      return 'The other Mac declined the connection.'
    case 'timeout':
      return "The other Mac didn't accept in time. Make sure Folderify is running there."
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
  // An untrusted peer wants in — surface the Allow/Deny prompt even if the panel is
  // closed (net runs for the app's lifetime, so requests can arrive anytime).
  api.onIncoming((p) => useListen.setState({ incoming: p, panelOpen: true }))
  api.onConnected((c) => onConnected(c.role, c.peer))
  api.onSignal((payload) => void peer?.handleSignal(payload as SignalPayload))
  api.onError((e) => onSignalError(e))
  api.onDisconnected(() => teardown())
}

function onConnected(peerRole: 'caller' | 'callee', p: ListenPeer): void {
  console.info('[listen] signaling connected as', peerRole, '→ peer', p.name)
  connectedPeer = p
  role = 'idle'
  useListen.setState({ status: 'connecting', peer: p, role: null, error: null, incoming: null, panelOpen: true })
  peer = new ListenPeerConn(peerRole, (sp) => window.api.listen.sendSignal(sp), {
    onControl: (m) => handleControl(m as ControlMsg),
    onBytes: handleBytes,
    onOpen: onChannelOpen,
    onClose: onPeerClosed
  })
  void peer.start()
  if (connectTimer) window.clearTimeout(connectTimer)
  connectTimer = window.setTimeout(() => {
    if (useListen.getState().status !== 'connected') onPeerClosed('timeout')
  }, 15000)
}

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
  useListen.setState({ status: 'discovering', error: connectErrorText(e.reason), incoming: null })
}

function onChannelOpen(): void {
  console.info('[listen] session ready — data channel open')
  if (connectTimer) {
    window.clearTimeout(connectTimer)
    connectTimer = undefined
  }
  useListen.setState({ status: 'connected', error: null })
  startTimers()
  const s = usePlayer.getState()
  prevTrackId = s.currentTrackId
  prevPlaying = s.isPlaying
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

/** Read + (optionally) transcode a track once; cached by srcId (LRU cap). */
async function prepareTransfer(track: Track): Promise<Prepared | null> {
  const cached = srcCache.get(track.id)
  if (cached) return cached
  const raw = await window.api.listen.readTrack(track.path)
  if (!raw) return null
  const ext = extOf(track.path)
  let bytes: Uint8Array = new Uint8Array(raw)
  let container = ext
  if (useSettings.getState().compressTransfers && shouldTranscode(ext)) {
    const webm = await transcodeToOpusWebm(raw)
    if (webm) {
      bytes = webm
      container = 'webm'
      console.info(
        `[listen] transcoded ${track.title}: ${raw.byteLength} → ${webm.byteLength} bytes`
      )
    }
  }
  const entry: Prepared = { bytes, container }
  srcCache.set(track.id, entry)
  // LRU cap: drop oldest beyond 8 entries.
  while (srcCache.size > 8) {
    const oldest = srcCache.keys().next().value as string | undefined
    if (oldest === undefined) break
    srcCache.delete(oldest)
  }
  return entry
}

function metaOf(track: Track): RemoteTrackMeta {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationSec: track.durationSec,
    codec: track.codec,
    ext: extOf(track.path)
  }
}

async function becomeSourceFor(track: Track, position: number, playing: boolean): Promise<void> {
  if (!peer) return
  const wasReceiver = role === 'receiver'
  role = 'source'
  useListen.setState({ role: 'source' })
  if (wasReceiver) {
    // Handoff receiver→source: we're the reference clock now, so stop following + nudging.
    lastRemoteState = null
    prevRemotePlaying = false
    syncNudging = false
    activatedTransferId = 0
    engine.setPlaybackRate(1)
  }
  const transferId = ++transferSeq
  currentTransferId = transferId
  prefetchAbort = true // a live pick preempts any background prefetch
  broadcastHorizon()
  console.info('[listen] sourcing track to peer:', track.title)
  try {
    const prepared = await prepareTransfer(track)
    if (currentTransferId !== transferId) return // superseded while preparing
    if (!prepared) {
      peer.send({ t: 'load-failed', transferId })
      return
    }
    pendingLoads.set(transferId, track.id)
    peer.send({
      t: 'load',
      transferId,
      srcId: track.id,
      size: prepared.bytes.byteLength,
      container: prepared.container,
      meta: metaOf(track),
      position,
      playing
    })
    sendState()
    // Receiver replies 'need' (→ streamLive) or 'have' (cached; nothing to send).
  } catch (err) {
    console.error('[listen] prepare/source error:', err)
    if (currentTransferId === transferId) peer.send({ t: 'load-failed', transferId })
  }
}

async function streamLive(transferId: number): Promise<void> {
  const srcId = pendingLoads.get(transferId)
  pendingLoads.delete(transferId)
  if (!srcId || !peer) return
  const prepared = srcCache.get(srcId)
  if (!prepared) {
    peer.send({ t: 'load-failed', transferId })
    return
  }
  prefetchAbort = true // ensure prefetch yields the channel
  const res = await peer.sendBytes(transferId, prepared.bytes, () => currentTransferId !== transferId)
  if (res === 'sent' && currentTransferId === transferId) {
    peer.send({ t: 'loaded', transferId })
    sendState()
  }
}

async function handlePrefetchRequest(srcId: string): Promise<void> {
  if (!peer) return
  const track = useLibrary.getState().tracksById.get(srcId)
  if (!track) {
    peer.send({ t: 'fetch-failed', srcId })
    return
  }
  let prepared: Prepared | null
  try {
    prepared = await prepareTransfer(track)
  } catch {
    prepared = null
  }
  if (!prepared || !peer) {
    peer?.send({ t: 'fetch-failed', srcId })
    return
  }
  const transferId = ++transferSeq
  peer.send({ t: 'prefetch', transferId, srcId, size: prepared.bytes.byteLength, container: prepared.container })
  prefetchAbort = false
  const res = await peer.sendBytes(transferId, prepared.bytes, () => prefetchAbort)
  if (res === 'sent') peer.send({ t: 'prefetch-done', transferId })
  else peer.send({ t: 'xfer-abort', transferId })
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

// The source's next ~20 tracks in play order: the current, then the explicit up-next
// queue, then the playlist continuation (in the queue's shuffled order if shuffle is on).
function computeHorizon(): HorizonItem[] {
  const p = usePlayer.getState()
  const lib = useLibrary.getState()
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string): void => {
    if (!id || id.startsWith('remote:') || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  if (p.currentTrackId) push(p.currentTrackId)
  for (const id of p.upNext) push(id)
  // Playlist continuation after the current index.
  const from = p.index >= 0 ? p.index : 0
  for (let i = from + 1; i < p.queue.length && ids.length < LISTEN_HORIZON_COUNT + 1; i++) {
    push(p.queue[i])
  }
  return ids
    .slice(0, LISTEN_HORIZON_COUNT + 1)
    .flatMap((id) => {
      const t = lib.tracksById.get(id)
      if (!t) return []
      return [
        {
          srcId: id,
          title: t.title,
          artist: t.artist,
          durationSec: t.durationSec,
          size: t.size,
          ext: extOf(t.path)
        } satisfies HorizonItem
      ]
    })
}

let lastHorizonKey = ''
function broadcastHorizon(): void {
  if (role !== 'source' || !peer) return
  const items = computeHorizon()
  const key = items.map((i) => i.srcId).join(',')
  if (key === lastHorizonKey) return
  lastHorizonKey = key
  peer.send({ t: 'horizon', items })
}

// React to local playback changes.
function onPlayerChange(s: PlayerSnapshot): void {
  if (connectedPeer && s.upNext !== prevUpNext) {
    prevUpNext = s.upNext
    sendQueueNotice(s.upNext)
    if (role === 'source') broadcastHorizon()
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

// ============================================================ shared queue / horizon
function sendQueueNotice(upNext: string[]): void {
  const lib = useLibrary.getState()
  const items: QueueItem[] = upNext.slice(0, 50).flatMap((id) => {
    const t = lib.tracksById.get(id)
    return t ? [{ title: t.title, artist: t.artist }] : []
  })
  peer?.send({ t: 'queue-notice', items } satisfies ControlMsg)
}

function applyQueueNotice(m: Extract<ControlMsg, { t: 'queue-notice' }>): void {
  const items = Array.isArray(m.items)
    ? m.items.slice(0, 50).map((it) => ({
        title: String(it?.title ?? '').slice(0, 200),
        artist: String(it?.artist ?? '').slice(0, 200)
      }))
    : []
  peerHasNext = items.length > 0
  useListen.setState({ peerQueue: items })
}

function applyHorizon(m: Extract<ControlMsg, { t: 'horizon' }>): void {
  const items: HorizonItem[] = Array.isArray(m.items)
    ? m.items.slice(0, LISTEN_HORIZON_COUNT + 1).flatMap((it) => {
        const size = Number(it?.size)
        if (!it || typeof it.srcId !== 'string') return []
        return [
          {
            srcId: it.srcId.slice(0, 200),
            title: String(it.title ?? '').slice(0, 200),
            artist: String(it.artist ?? '').slice(0, 200),
            durationSec: Number.isFinite(Number(it.durationSec)) ? Number(it.durationSec) : null,
            size: Number.isFinite(size) && size >= 0 ? size : 0,
            ext: String(it.ext ?? '').slice(0, 12)
          }
        ]
      })
    : []
  peerHorizonItems = items
  useListen.setState({ peerHorizon: items })
  drivePrefetch()
}

function queueGate(): boolean {
  if (!connectedPeer) return false
  const st = usePlayer.getState()
  if (st.remote) return !(st.upNext.length > 0 && !peerHasNext)
  if (livePlaySinkActive()) return true
  if (st.upNext.length > 0) return false
  if (peerHasNext) {
    console.info('[listen] holding auto-advance — peer has the next track queued')
    return true
  }
  return false
}

function livePlaySinkActive(): boolean {
  const sink = rxByTransfer.get(currentTransferId)
  return !!sink && sink.kind === 'play' && !sink.done
}

// ============================================================ receiver: prefetch
function putCache(srcId: string, entry: Prepared): void {
  if (prefetchCache.has(srcId)) {
    prefetchCacheBytes -= prefetchCache.get(srcId)!.bytes.byteLength
    prefetchCache.delete(srcId)
  }
  prefetchCache.set(srcId, entry)
  prefetchCacheBytes += entry.bytes.byteLength
  // LRU evict (oldest first) past either cap.
  while (
    prefetchCache.size > LISTEN_CACHE_MAX_ENTRIES ||
    prefetchCacheBytes > LISTEN_CACHE_MAX_BYTES
  ) {
    const oldest = prefetchCache.keys().next().value as string | undefined
    if (oldest === undefined || oldest === srcId) break
    prefetchCacheBytes -= prefetchCache.get(oldest)!.bytes.byteLength
    prefetchCache.delete(oldest)
  }
}

/** Request the NEXT uncached horizon track — one at a time. Re-driven after each
 *  prefetch completes/fails, so we never run competing background streams. */
function drivePrefetch(): void {
  if (!peer || role === 'source') return
  if (requestedPrefetch.size > 0) return // one prefetch in flight at a time
  const wanted = peerHorizonItems.slice(1, 1 + LISTEN_PREFETCH_COUNT)
  for (const item of wanted) {
    if (prefetchCache.has(item.srcId)) continue
    if (item.size > LISTEN_MAX_TRANSFER) continue
    requestedPrefetch.add(item.srcId)
    peer.send({ t: 'fetch', srcId: item.srcId })
    return
  }
}

// ============================================================ receiver: play sinks
function playFromBytes(
  srcId: string,
  container: string,
  meta: RemoteTrackMeta,
  size: number,
  position: number,
  playing: boolean,
  bytes: Uint8Array
): void {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = null
  }
  const blob = new Blob([bytes as BlobPart], { type: mimeForContainer(container) })
  currentBlobUrl = URL.createObjectURL(blob)
  activateRemotePlayback(srcId, meta, size, position, playing)
  engine.loadRemote(currentBlobUrl, position, playing)
}

function activateRemotePlayback(
  srcId: string,
  meta: RemoteTrackMeta,
  size: number,
  position: number,
  playing: boolean
): void {
  role = 'receiver'
  // New remote track: drop the previous track's reference so the follower stays idle
  // (playing at 1.0 from the load's seek position) until this track's first `state`
  // arrives — otherwise a syncTick in that window could seek to a stale position. Mark THIS
  // transfer activated so syncTick will act on it (and not on an earlier still-loading one).
  lastRemoteState = null
  prevRemotePlaying = playing
  syncNudging = false
  activatedTransferId = currentTransferId
  const track = synthTrack(`remote:${srcId}:${currentTransferId}`, meta, size)
  applyingRemote = true
  useLibrary.getState().setRemoteTrack(track)
  usePlayer.setState({
    currentTrackId: track.id,
    duration: meta.durationSec ?? 0,
    currentTime: position,
    isPlaying: playing,
    remote: true,
    _relay: relay
  })
  applyingRemote = false
  useListen.setState({ role: 'receiver' })
}

/** Start progressive playback via MediaSource; returns the sink's mse handle. */
function startMse(sink: PlaySink): MseSink | null {
  try {
    const ms = new MediaSource()
    const url = URL.createObjectURL(ms)
    const mse: MseSink = { ms, url, sb: null, queue: [], wantEnd: false }
    ms.addEventListener('sourceopen', () => {
      try {
        mse.sb = ms.addSourceBuffer(mimeForContainer(sink.container))
        mse.sb.addEventListener('updateend', () => pumpMse(mse))
        pumpMse(mse)
      } catch (e) {
        console.warn('[listen] MSE addSourceBuffer failed → blob fallback', e)
        mse.sb = null
      }
    })
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
    currentBlobUrl = url
    activateRemotePlayback(sink.srcId, sink.meta, sink.size, sink.position, sink.playing)
    engine.loadRemote(url, sink.position, sink.playing)
    return mse
  } catch (e) {
    console.warn('[listen] MSE start failed → blob fallback', e)
    return null
  }
}

function pumpMse(mse: MseSink): void {
  if (!mse.sb || mse.sb.updating) return
  const next = mse.queue.shift()
  if (next) {
    try {
      mse.sb.appendBuffer(next as BufferSource)
    } catch (e) {
      console.warn('[listen] appendBuffer failed', e)
    }
    return
  }
  if (mse.wantEnd && mse.ms.readyState === 'open') {
    try {
      mse.ms.endOfStream()
    } catch {
      /* ignore */
    }
  }
}

// ============================================================ receiver: control
function handleControl(m: ControlMsg): void {
  switch (m.t) {
    case 'ping':
      peer?.send({ t: 'pong', t0: m.t0, t1: performance.now() })
      break
    case 'pong': {
      const now = performance.now()
      const rtt = now - m.t0
      clockSamples.push({ rtt, offset: m.t1 + rtt / 2 - now })
      if (clockSamples.length > 12) clockSamples.shift()
      // Trust the least-delayed sample: minimum RTT ⇒ least queuing skew in the estimate,
      // so one GC-delayed pong can't jerk the offset.
      let best = clockSamples[0]
      for (const s of clockSamples) if (s.rtt < best.rtt) best = s
      clockOffset = best.offset
      break
    }
    case 'load':
      onLoad(m)
      break
    case 'need':
      void streamLive(m.transferId)
      break
    case 'have':
      // Receiver already had it cached and is playing — nothing to send; keep syncing.
      pendingLoads.delete(m.transferId)
      sendState()
      break
    case 'loaded':
      finalizePlay(m.transferId)
      break
    case 'load-failed':
      onLoadFailed(m.transferId)
      break
    case 'fetch':
      void handlePrefetchRequest(m.srcId)
      break
    case 'fetch-failed':
      requestedPrefetch.delete(m.srcId)
      drivePrefetch()
      break
    case 'prefetch':
      onPrefetch(m)
      break
    case 'prefetch-done':
      finalizePrefetch(m.transferId)
      break
    case 'xfer-abort':
      dropSink(m.transferId)
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
    case 'horizon':
      applyHorizon(m)
      break
    case 'bye':
      teardown()
      break
  }
}

function onLoad(m: Extract<ControlMsg, { t: 'load' }>): void {
  clearRxStall()
  if (!Number.isFinite(m.size) || m.size < 0 || m.size > LISTEN_MAX_TRANSFER) {
    useNotice.getState().show('Skipped a track that was too large to stream.')
    peer?.send({ t: 'load-failed', transferId: m.transferId })
    return
  }
  // Retire any previous live sink.
  const prev = rxByTransfer.get(currentTransferId)
  if (prev && prev.kind === 'play') rxByTransfer.delete(currentTransferId)
  currentTransferId = m.transferId

  // Already prefetched? Play instantly, tell the source not to stream.
  const cached = prefetchCache.get(m.srcId)
  if (cached) {
    console.info('[listen] playing prefetched track (instant):', m.meta.title)
    peer?.send({ t: 'have', transferId: m.transferId })
    playFromBytes(m.srcId, cached.container, m.meta, m.size, m.position, m.playing, cached.bytes)
    return
  }

  peer?.send({ t: 'need', transferId: m.transferId })
  const sink: PlaySink = {
    kind: 'play',
    transferId: m.transferId,
    srcId: m.srcId,
    container: m.container,
    size: m.size,
    meta: m.meta,
    position: m.position,
    playing: m.playing,
    received: 0,
    chunks: [],
    mse: null,
    done: false
  }
  if (mseCapable(m.container)) sink.mse = startMse(sink)
  rxByTransfer.set(m.transferId, sink)
  armRxStall()
}

function onPrefetch(m: Extract<ControlMsg, { t: 'prefetch' }>): void {
  if (!Number.isFinite(m.size) || m.size < 0 || m.size > LISTEN_MAX_TRANSFER) return
  rxByTransfer.set(m.transferId, {
    kind: 'prefetch',
    transferId: m.transferId,
    srcId: m.srcId,
    container: m.container,
    size: m.size,
    chunks: [],
    received: 0
  })
}

function handleBytes(transferId: number, buf: ArrayBuffer): void {
  const sink = rxByTransfer.get(transferId)
  if (!sink) return
  const u8 = new Uint8Array(buf)
  sink.received += u8.byteLength
  if (sink.received > sink.size) {
    // Overrun — drop it.
    dropSink(transferId)
    return
  }
  sink.chunks.push(u8)
  if (sink.kind === 'play') {
    if (sink.mse) {
      sink.mse.queue.push(u8)
      pumpMse(sink.mse)
    }
    if (transferId === currentTransferId) armRxStall()
    if (sink.received === sink.size) finalizePlay(transferId)
  } else {
    if (sink.received === sink.size) finalizePrefetch(transferId)
  }
}

function finalizePlay(transferId: number): void {
  const sink = rxByTransfer.get(transferId)
  if (!sink || sink.kind !== 'play' || sink.done) return
  sink.done = true
  clearRxStall()
  const bytes = concatChunks(sink.chunks, sink.received)
  // Cache the completed bytes so a re-pick / prefetch dedup hits.
  putCache(sink.srcId, { bytes, container: sink.container })
  if (sink.mse) {
    sink.mse.wantEnd = true
    pumpMse(sink.mse)
  } else {
    // Blob path (no MSE): now that all bytes are here, play.
    playFromBytes(sink.srcId, sink.container, sink.meta, sink.size, sink.position, sink.playing, bytes)
  }
  console.info('[listen] received track:', sink.meta.title, `(${sink.received} bytes)`)
}

function finalizePrefetch(transferId: number): void {
  const sink = rxByTransfer.get(transferId)
  if (!sink || sink.kind !== 'prefetch') return
  rxByTransfer.delete(transferId)
  requestedPrefetch.delete(sink.srcId)
  const bytes = concatChunks(sink.chunks, sink.received)
  putCache(sink.srcId, { bytes, container: sink.container })
  console.info('[listen] prefetched:', sink.srcId, `(${sink.received} bytes)`)
  drivePrefetch() // fetch the next uncached horizon track
}

function onLoadFailed(transferId: number): void {
  const sink = rxByTransfer.get(transferId)
  if (sink && sink.kind === 'play') {
    dropSink(transferId)
    clearRxStall()
    useNotice.getState().show('The other Mac couldn’t send that track.')
  }
}

function dropSink(transferId: number): void {
  const sink = rxByTransfer.get(transferId)
  if (!sink) return
  rxByTransfer.delete(transferId)
  if (sink.kind === 'prefetch') requestedPrefetch.delete(sink.srcId)
  if (sink.kind === 'play' && sink.mse && sink.mse.url === currentBlobUrl) {
    // leave the URL; teardown/next load revokes it
  }
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

function applyRemoteState(m: Extract<ControlMsg, { t: 'state' }>): void {
  if (role !== 'receiver') return
  lastRemoteState = { position: m.position, atClock: m.atClock, playing: m.playing }
  // Only act on play/pause TRANSITIONS — poking the element every tick is wasteful and
  // fights the sync follower, which owns position/tempo.
  if (m.playing !== prevRemotePlaying) {
    prevRemotePlaying = m.playing
    applyingRemote = true
    usePlayer.setState({ isPlaying: m.playing })
    applyingRemote = false
    if (m.playing) void engine.play()
    else engine.pause()
  }
  syncTick() // react immediately to this snapshot (e.g. a source seek), not on the next tick
}

/**
 * Master-clock follower. Extrapolates where the source is *now* (its last position +
 * elapsed, corrected by clockOffset) and pulls the receiver toward it: a hard seek only
 * for big jumps, tiny pitch-preserved tempo nudges for small offsets, and nothing at all
 * once we're within SYNC_DEADBAND — keeping the two Macs within ~20 ms of each other.
 */
function syncTick(): void {
  if (role !== 'receiver' || !lastRemoteState) return
  // Only correct the track the engine is ACTUALLY playing. On a blob-path (non-MSE) track
  // change the new track isn't activated until its bytes fully arrive, while the source's
  // `state` already describes it — without this guard we'd seek the still-playing PREVIOUS
  // track to the new track's position. currentTransferId advances at onLoad; activatedTransferId
  // only when the engine actually starts the track (activateRemotePlayback).
  if (activatedTransferId !== currentTransferId) return
  const st = lastRemoteState
  if (!st.playing) {
    syncNudging = false
    engine.setPlaybackRate(1)
    return
  }
  const sourceNow = performance.now() + clockOffset
  const expected = st.position + (sourceNow - st.atClock) / 1000
  if (!Number.isFinite(expected)) return
  const err = engine.currentTime - expected // + = receiver is ahead of the source
  const abs = Math.abs(err)
  if (abs > SYNC_HARD_SEEK) {
    syncNudging = false
    engine.setPlaybackRate(1)
    engine.seek(Math.max(0, expected))
  } else if (abs > SYNC_ENGAGE || (syncNudging && abs > SYNC_RELEASE)) {
    // Ahead (err>0) → slow down (<1); behind → speed up (>1). Clamped to ±SYNC_MAX_SLEW.
    // The hysteresis (ENGAGE to start, RELEASE to stop) keeps currentTime quantization from
    // chattering the rate near the threshold.
    syncNudging = true
    const rate = Math.min(1 + SYNC_MAX_SLEW, Math.max(1 - SYNC_MAX_SLEW, 1 - SYNC_GAIN * err))
    engine.setPlaybackRate(rate)
  } else {
    syncNudging = false
    engine.setPlaybackRate(1)
  }
}

// ============================================================ timers + teardown
function startTimers(): void {
  stopTimers()
  // Ping 1 Hz (keeps the clock offset fresh; RTT is tiny on a LAN) and broadcast source
  // state 2 Hz (snappier re-alignment after a seek). The receiver's follower ticks 4 Hz.
  pingTimer = window.setInterval(() => peer?.send({ t: 'ping', t0: performance.now() }), 1000)
  stateTimer = window.setInterval(() => {
    if (role === 'source') sendState()
  }, 500)
  syncTimer = window.setInterval(syncTick, SYNC_TICK_MS)
  // Burst a handful of pings up front so the clock offset locks within ~1s, not ~12s.
  for (let i = 0; i < 6; i++) {
    window.setTimeout(() => peer?.send({ t: 'ping', t0: performance.now() }), i * 150)
  }
}
function stopTimers(): void {
  if (pingTimer) window.clearInterval(pingTimer)
  if (stateTimer) window.clearInterval(stateTimer)
  if (syncTimer) window.clearInterval(syncTimer)
  if (connectTimer) window.clearTimeout(connectTimer)
  pingTimer = undefined
  stateTimer = undefined
  syncTimer = undefined
  connectTimer = undefined
}

function armRxStall(): void {
  clearRxStall()
  rxStallTimer = window.setTimeout(() => {
    const sink = rxByTransfer.get(currentTransferId)
    if (sink && sink.kind === 'play' && !sink.done) {
      dropSink(currentTransferId)
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
  rxByTransfer.clear()
  requestedPrefetch.clear()
  prefetchCache.clear()
  prefetchCacheBytes = 0
  peerHorizonItems = []
  srcCache.clear()
  pendingLoads.clear()
  lastHorizonKey = ''
  prefetchAbort = true
  clockOffset = 0
  clockSamples.length = 0
  lastRemoteState = null
  prevRemotePlaying = false
  syncNudging = false
  activatedTransferId = 0
  engine.setPlaybackRate(1) // drop any sync tempo nudge
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

  useListen.setState({
    status: 'idle',
    peer: null,
    role: null,
    peerQueue: [],
    peerHorizon: [],
    incoming: null // a caller that bailed shouldn't leave a stale Allow/Deny prompt up
  })
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
export async function start(): Promise<{ name: string; addresses: string[] } | null> {
  if (!hasNative) {
    return { name: 'This Mac', addresses: ['192.168.1.42'] }
  }
  initNative()
  try {
    const info = await window.api.listen.start()
    return { name: info.name, addresses: info.addresses }
  } catch {
    return null
  }
}

/** Callee answers an incoming request. */
export function respondIncoming(accept: boolean, trust: boolean): void {
  if (hasNative) void window.api.listen.respondIncoming(accept, trust)
  useListen.setState({ incoming: null })
}

/** Forget all trusted devices. */
export function forgetTrusted(): void {
  if (hasNative) void window.api.listen.forgetTrusted()
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
}

export function stopDiscovery(): void {
  clearSim()
}

export function connect(p: ListenPeer): void {
  if (!hasNative) {
    clearSim()
    simConnect = window.setTimeout(() => {
      connectedPeer = p
      role = 'source'
      useListen.setState({ status: 'connected', peer: p, role: 'source', error: null })
    }, 900)
    return
  }
  void window.api.listen.connect(p.id).then((r) => {
    if (!r.ok) onSignalError({ reason: r.error ?? 'peer-gone', message: r.error ?? '' })
  })
}

export function connectManual(host: string): void {
  if (!hasNative) {
    connect({ id: `manual:${host}`, name: host })
    return
  }
  void window.api.listen.connectManual(host).then((r) => {
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

usePlayer.subscribe(onPlayerChange)
usePlayer.setState({ _queueGate: queueGate })
// Subscribe to native listen events at startup so incoming requests (incl. trusted
// auto-connects) are handled even before the user opens the Connect panel.
initNative()
