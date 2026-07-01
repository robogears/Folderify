import { useEffect } from 'react'
import { usePlayer } from './state/player-store'
import { useLibrary } from './state/library-store'
import type { PlayerSnapshot, PlayerCommand } from '@shared/models'

/**
 * Runs in the MAIN window only. Publishes a compact player snapshot to the
 * menu-bar popover (immediately on discrete changes, plus ~2×/s for the clock),
 * and applies commands the popover sends back.
 */
export function useTrayBridge(): void {
  useEffect(() => {
    const buildSnapshot = (): PlayerSnapshot => {
      const p = usePlayer.getState()
      const track = p.currentTrackId ? useLibrary.getState().tracksById.get(p.currentTrackId) : undefined
      return {
        trackId: p.currentTrackId,
        title: track?.title ?? '',
        artist: track?.artist ?? '',
        hasArt: track?.hasArt ?? false,
        isPlaying: p.isPlaying,
        currentTime: p.currentTime,
        duration: p.duration,
        volume: p.volume,
        muted: p.muted,
        shuffle: p.shuffle,
        repeat: p.repeat,
        hasTrack: p.currentTrackId !== null
      }
    }
    const publish = (): void => window.api.publishPlayerState(buildSnapshot())

    publish()
    const unsubPlayer = usePlayer.subscribe((state, prev) => {
      if (
        state.currentTrackId !== prev.currentTrackId ||
        state.isPlaying !== prev.isPlaying ||
        state.volume !== prev.volume ||
        state.muted !== prev.muted ||
        state.shuffle !== prev.shuffle ||
        state.repeat !== prev.repeat
      ) {
        publish()
      }
    })
    const unsubLibrary = useLibrary.subscribe(() => publish())
    const interval = setInterval(publish, 500)

    const offCommand = window.api.onPlayerCommand((cmd: PlayerCommand) => {
      const p = usePlayer.getState()
      switch (cmd.type) {
        case 'toggle':
          p.togglePlay()
          break
        case 'next':
          p.next(false)
          break
        case 'prev':
          p.prev()
          break
        case 'seek':
          p.seek(cmd.value)
          break
        case 'setVolume':
          p.setVolume(cmd.value)
          break
        case 'toggleMute':
          p.toggleMute()
          break
        case 'toggleShuffle':
          p.toggleShuffle()
          break
        case 'cycleRepeat':
          p.cycleRepeat()
          break
        case 'showApp':
          break
      }
    })

    return () => {
      unsubPlayer()
      unsubLibrary()
      clearInterval(interval)
      offCommand()
    }
  }, [])
}
