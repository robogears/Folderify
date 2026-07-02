import { useEffect } from 'react'
import { usePlayer } from './state/player-store'
import { useLibrary } from './state/library-store'
import { coverUrl } from '@shared/ipc'

// Wires our player into the OS "Now Playing" surface (macOS Control Center widget +
// hardware media keys; on iOS the lock screen / Control Center) via the Web
// MediaSession API. Chromium/WebKit already creates a session when the <audio>
// element plays — this populates it with real metadata, album art, a seekable
// position, and remote-command handlers so play/pause/next/prev/seek all work from
// the OS. Pure renderer-side; no native code needed.
//
// Artwork is delivered as a data: URL (fetched from cover:// then base64'd) because
// that's the most reliable form for the OS widget and satisfies the strict CSP
// (img-src includes data:), avoiding custom-scheme/blob edge cases.

// Intentionally NOT registering seekbackward/seekforward: when those are set, iOS
// renders the ±10s skip buttons instead of the ⏮/⏭ track buttons we want for a
// playlist player. The scrubber (seekto) still handles fine seeking.
const ACTIONS: MediaSessionAction[] = ['play', 'pause', 'stop', 'previoustrack', 'nexttrack', 'seekto']

/** Call once from a top-level component that lives for the app's lifetime. */
export function useMediaSession(): void {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    const player = usePlayer

    const setAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null): void => {
      try {
        ms.setActionHandler(action, handler)
      } catch {
        /* action unsupported on this platform — ignore */
      }
    }

    setAction('play', () => {
      if (!player.getState().isPlaying) player.getState().togglePlay()
    })
    setAction('pause', () => {
      if (player.getState().isPlaying) player.getState().togglePlay()
    })
    setAction('stop', () => {
      if (player.getState().isPlaying) player.getState().togglePlay()
    })
    setAction('previoustrack', () => player.getState().prev())
    setAction('nexttrack', () => player.getState().next(false))
    setAction('seekto', (d) => {
      if (typeof d.seekTime === 'number') player.getState().seek(d.seekTime)
    })

    // ---- metadata + artwork ----
    let artDataUrl: string | null = null
    let artForTrack: string | null = null

    const applyMetadata = (trackId: string | null): void => {
      const track = trackId ? useLibrary.getState().tracksById.get(trackId) : undefined
      if (!track) {
        ms.metadata = null
        return
      }
      ms.metadata = new MediaMetadata({
        title: track.title || 'Unknown title',
        artist: track.artist || '',
        album: track.album || '',
        artwork:
          artForTrack === trackId && artDataUrl
            ? [{ src: artDataUrl, sizes: '512x512', type: 'image/jpeg' }]
            : []
      })
    }

    const loadArtwork = async (trackId: string | null): Promise<void> => {
      const track = trackId ? useLibrary.getState().tracksById.get(trackId) : undefined
      if (!track || !track.hasArt) return
      if (artForTrack === trackId && artDataUrl) return // already have it
      try {
        const res = await fetch(coverUrl(trackId as string, 'lg'))
        if (!res.ok) return
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onload = () => resolve(fr.result as string)
          fr.onerror = () => reject(fr.error)
          fr.readAsDataURL(blob)
        })
        // The track may have changed while we were fetching — bail if so.
        if (player.getState().currentTrackId !== trackId) return
        artDataUrl = dataUrl
        artForTrack = trackId
        applyMetadata(trackId)
      } catch {
        /* no artwork — the text metadata already stands */
      }
    }

    const updatePosition = (): void => {
      const s = player.getState()
      const dur = s.duration
      if (!Number.isFinite(dur) || dur <= 0) {
        try {
          ms.setPositionState()
        } catch {
          /* ignore */
        }
        return
      }
      const position = Math.min(Math.max(0, s.currentTime), dur)
      try {
        ms.setPositionState({ duration: dur, position, playbackRate: s.isPlaying ? 1 : 0 })
      } catch {
        /* ignore invalid states */
      }
    }

    // ---- initial state ----
    let lastTrack = player.getState().currentTrackId
    ms.playbackState = player.getState().isPlaying ? 'playing' : 'paused'
    applyMetadata(lastTrack)
    void loadArtwork(lastTrack)
    updatePosition()

    const unsub = player.subscribe((s, prev) => {
      if (s.currentTrackId !== lastTrack) {
        lastTrack = s.currentTrackId
        artDataUrl = null
        artForTrack = null
        applyMetadata(s.currentTrackId) // text right away
        void loadArtwork(s.currentTrackId) // art follows
        updatePosition()
      }
      if (s.isPlaying !== prev.isPlaying) {
        ms.playbackState = s.isPlaying ? 'playing' : 'paused'
        updatePosition()
      }
      if (s.duration !== prev.duration) updatePosition()
    })

    // Correct the scrubber for seeks/drift (the OS extrapolates between updates).
    const interval = window.setInterval(updatePosition, 1000)

    return () => {
      window.clearInterval(interval)
      unsub()
      for (const a of ACTIONS) setAction(a, null)
      ms.metadata = null
      ms.playbackState = 'none'
    }
  }, [])
}
