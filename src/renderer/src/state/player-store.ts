import { create } from 'zustand'
import { engine } from '../audio/engine'
import { useLibrary } from './library-store'
import { useNotice } from './notice-store'
import { mediaUrl } from '@shared/ipc'
import type { Track } from '@shared/models'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  queue: string[]
  originalQueue: string[]
  index: number
  currentTrackId: string | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  contextLabel: string | null

  playContext: (trackIds: string[], startId: string, label?: string) => void
  /** Load a previously-played track (paused) into its playlist context. */
  restore: (trackId: string, time: number) => void
  togglePlay: () => void
  next: (auto?: boolean) => void
  prev: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  _onEnded: () => void
}

function trackOf(id: string): Track | undefined {
  return useLibrary.getState().tracksById.get(id)
}
function isPlayable(id: string): boolean {
  const t = trackOf(id)
  return !!t && !t.unsupported
}

function shuffled(ids: string[], firstId: string): string[] {
  const rest = ids.filter((id) => id !== firstId)
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return ids.includes(firstId) ? [firstId, ...rest] : rest
}

const VOL_KEY = 'folderify.volume'
const LAST_KEY = 'folderify.lastplayed'
const SHUFFLE_KEY = 'folderify.shuffle'
const REPEAT_KEY = 'folderify.repeat'
const initialVolume = ((): number => {
  const v = Number(localStorage.getItem(VOL_KEY))
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8
})()
// Shuffle + repeat persist across launches (userData localStorage, like volume).
const initialShuffle = localStorage.getItem(SHUFFLE_KEY) === '1'
const initialRepeat = ((): RepeatMode => {
  const r = localStorage.getItem(REPEAT_KEY)
  return r === 'all' || r === 'one' ? r : 'off'
})()

function saveLast(trackId: string | null, time: number): void {
  try {
    if (trackId) localStorage.setItem(LAST_KEY, JSON.stringify({ trackId, time }))
  } catch {
    /* ignore */
  }
}

export function readLastPlayed(): { trackId: string; time: number } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { trackId?: string; time?: number }
    if (typeof parsed.trackId === 'string') {
      return { trackId: parsed.trackId, time: typeof parsed.time === 'number' ? parsed.time : 0 }
    }
  } catch {
    /* ignore */
  }
  return null
}

export const usePlayer = create<PlayerState>((set, get) => {
  function loadAndPlay(i: number): void {
    const { queue } = get()
    const id = queue[i]
    const track = id ? trackOf(id) : undefined
    if (!track) return
    set({ index: i, currentTrackId: id, currentTime: 0, duration: track.durationSec ?? 0 })
    saveLast(id, 0)
    engine.load(mediaUrl(track.path))
    void engine.play()
  }

  function findPlayable(from: number, dir: 1 | -1, wrap: boolean): number {
    const { queue } = get()
    const n = queue.length
    if (n === 0) return -1
    let i = from
    for (let step = 0; step < n; step++) {
      i += dir
      if (i >= n) {
        if (wrap) i = 0
        else return -1
      } else if (i < 0) {
        if (wrap) i = n - 1
        else return -1
      }
      if (i >= 0 && i < n && isPlayable(queue[i])) return i
    }
    return -1
  }

  return {
    queue: [],
    originalQueue: [],
    index: -1,
    currentTrackId: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: initialVolume,
    muted: false,
    shuffle: initialShuffle,
    repeat: initialRepeat,
    contextLabel: null,

    playContext: (trackIds, startId, label) => {
      if (trackIds.length === 0) return
      const { shuffle } = get()
      const queue = shuffle ? shuffled(trackIds, startId) : trackIds.slice()
      set({ originalQueue: trackIds.slice(), queue, contextLabel: label ?? null })
      let index = queue.indexOf(startId)
      if (index < 0) index = 0
      if (!isPlayable(queue[index])) {
        // Prefer the next playable track after the tapped one; otherwise the first
        // playable anywhere in the context.
        const fwd = findPlayable(index, 1, false)
        index = fwd >= 0 ? fwd : queue.findIndex(isPlayable)
      }
      if (index < 0 || !isPlayable(queue[index])) {
        // Every track here is an unsupported codec — don't flutter through them
        // silently; tell the user why nothing played.
        useNotice
          .getState()
          .show(`Nothing in ${label ? `“${label}”` : 'this folder'} can be played on this device.`)
        return
      }
      loadAndPlay(index)
    },

    restore: (trackId, time) => {
      const lib = useLibrary.getState()
      const track = lib.tracksById.get(trackId)
      if (!track) return
      const playlist = lib.playlists.find((p) => p.id === track.playlistId)
      const ids = playlist ? playlist.trackIds.filter((id) => lib.tracksById.has(id)) : [trackId]
      const queue = ids.length > 0 ? ids.slice() : [trackId]
      const index = Math.max(0, queue.indexOf(trackId))
      set({
        originalQueue: queue.slice(),
        queue,
        index,
        currentTrackId: trackId,
        contextLabel: playlist?.name ?? null,
        duration: track.durationSec ?? 0,
        currentTime: time,
        isPlaying: false
      })
      engine.prepare(mediaUrl(track.path), time)
    },

    togglePlay: () => {
      const { currentTrackId, isPlaying } = get()
      if (!currentTrackId) return
      if (isPlaying) engine.pause()
      else void engine.play()
    },

    next: (auto = false) => {
      const { repeat, index } = get()
      if (auto && repeat === 'one') {
        engine.seek(0)
        void engine.play()
        return
      }
      const target = findPlayable(index, 1, repeat === 'all')
      if (target >= 0) loadAndPlay(target)
      else {
        engine.pause()
        set({ isPlaying: false })
      }
    },

    prev: () => {
      if (engine.currentTime > 3) {
        engine.seek(0)
        return
      }
      const { index, repeat } = get()
      const target = findPlayable(index, -1, repeat === 'all')
      if (target >= 0) loadAndPlay(target)
      else engine.seek(0)
    },

    seek: (seconds) => {
      engine.seek(seconds)
      set({ currentTime: seconds })
    },

    setVolume: (v) => {
      const vol = Math.max(0, Math.min(1, v))
      localStorage.setItem(VOL_KEY, String(vol))
      const muted = vol === 0 ? get().muted : false
      engine.setVolume(muted ? 0 : vol)
      set({ volume: vol, muted })
    },

    toggleMute: () => {
      const { muted, volume } = get()
      const nextMuted = !muted
      engine.setVolume(nextMuted ? 0 : volume)
      set({ muted: nextMuted })
    },

    toggleShuffle: () => {
      const { shuffle, originalQueue, currentTrackId, index } = get()
      const nextShuffle = !shuffle
      try {
        localStorage.setItem(SHUFFLE_KEY, nextShuffle ? '1' : '0')
      } catch {
        /* ignore */
      }
      if (originalQueue.length === 0) {
        set({ shuffle: nextShuffle })
        return
      }
      const queue = nextShuffle
        ? shuffled(originalQueue, currentTrackId ?? originalQueue[0])
        : originalQueue.slice()
      const nextIndex = currentTrackId ? queue.indexOf(currentTrackId) : index
      set({ shuffle: nextShuffle, queue, index: nextIndex })
    },

    cycleRepeat: () => {
      const order: RepeatMode[] = ['off', 'all', 'one']
      const next = order[(order.indexOf(get().repeat) + 1) % order.length]
      try {
        localStorage.setItem(REPEAT_KEY, next)
      } catch {
        /* ignore */
      }
      set({ repeat: next })
    },

    _onEnded: () => {
      get().next(true)
    }
  }
})

// Bridge engine events into the store, and apply the persisted volume.
engine.setHandlers({
  onTime: (t) => usePlayer.setState({ currentTime: t }),
  onDuration: (d) => usePlayer.setState({ duration: d }),
  onPlay: () => usePlayer.setState({ isPlaying: true }),
  onPause: () => {
    usePlayer.setState({ isPlaying: false })
    saveLast(usePlayer.getState().currentTrackId, engine.currentTime)
  },
  onEnded: () => usePlayer.getState()._onEnded(),
  onError: () => usePlayer.getState().next(true)
})
engine.setVolume(initialVolume)

// Persist the exact resume position when the window is closing.
window.addEventListener('pagehide', () => {
  saveLast(usePlayer.getState().currentTrackId, engine.currentTime)
})
