import { useEffect } from 'react'
import { registerPlugin } from '@capacitor/core'
import { usePlayer } from '../renderer/src/state/player-store'
import { useLibrary } from '../renderer/src/state/library-store'

// Bridge to the native FolderifyNowPlaying plugin (MPNowPlayingInfoCenter +
// MPRemoteCommandCenter). Unlike the Web MediaSession path, this survives the app
// being backgrounded/locked, so the lock screen keeps showing metadata + controls.
//
// We push Now Playing info EVENT-DRIVEN only (track change, play/pause, duration,
// seek) — iOS extrapolates the scrubber from elapsed + rate, and continuous writes
// get dropped in the background. A light foreground-only interval corrects UI seeks.

interface NowPlayingInfo {
  title: string
  artist: string
  album: string
  coverTrackId?: string
  duration: number
  position: number
  isPlaying: boolean
}

interface RemoteCommand {
  action: 'play' | 'pause' | 'toggle' | 'next' | 'prev' | 'seekTo'
  position?: number
}

interface NowPlayingPlugin {
  update(info: NowPlayingInfo): Promise<void>
  clear(): Promise<void>
  addListener(
    eventName: 'remoteCommand',
    listener: (cmd: RemoteCommand) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const Plugin = registerPlugin<NowPlayingPlugin>('FolderifyNowPlaying')

/** Call once from the mobile shell (lives for the app's lifetime). */
export function useNativeNowPlaying(): void {
  useEffect(() => {
    const player = usePlayer

    const push = (): void => {
      const s = player.getState()
      const track = s.currentTrackId ? useLibrary.getState().tracksById.get(s.currentTrackId) : undefined
      if (!track) {
        void Plugin.clear()
        return
      }
      void Plugin.update({
        title: track.title || 'Unknown title',
        artist: track.artist || '',
        album: track.album || '',
        coverTrackId: track.hasArt ? track.id : undefined,
        duration: Number.isFinite(s.duration) ? s.duration : 0,
        position: Number.isFinite(s.currentTime) ? s.currentTime : 0,
        isPlaying: s.isPlaying
      })
    }

    // Initial + event-driven pushes (NOT per time-tick).
    let lastTrack = player.getState().currentTrackId
    let lastPlaying = player.getState().isPlaying
    let lastDuration = player.getState().duration
    push()

    const unsub = player.subscribe((s) => {
      let changed = false
      if (s.currentTrackId !== lastTrack) {
        lastTrack = s.currentTrackId
        changed = true
      }
      if (s.isPlaying !== lastPlaying) {
        lastPlaying = s.isPlaying
        changed = true
      }
      if (s.duration !== lastDuration) {
        lastDuration = s.duration
        changed = true
      }
      if (changed) push()
    })

    // Correct the scrubber for in-app seeks/drift — foreground only, so the
    // background stays purely event-driven (per iOS's continuous-write caveat).
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible' && player.getState().isPlaying) push()
    }, 5000)

    // Lock-screen / Control Center / AirPods commands -> player store.
    const listenerP = Plugin.addListener('remoteCommand', (cmd) => {
      const p = player.getState()
      switch (cmd.action) {
        case 'play':
          if (!p.isPlaying) p.togglePlay()
          break
        case 'pause':
          if (p.isPlaying) p.togglePlay()
          break
        case 'toggle':
          p.togglePlay()
          break
        case 'next':
          p.next(false)
          break
        case 'prev':
          p.prev()
          break
        case 'seekTo':
          if (typeof cmd.position === 'number') {
            p.seek(cmd.position)
            push()
          }
          break
      }
    })

    return () => {
      window.clearInterval(interval)
      unsub()
      void listenerP.then((h) => h.remove())
      void Plugin.clear()
    }
  }, [])
}
