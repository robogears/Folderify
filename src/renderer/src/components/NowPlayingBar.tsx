import type { JSX } from 'react'
import { usePlayer } from '../state/player-store'
import { useLibrary } from '../state/library-store'
import { Cover } from './Cover'
import { TransportControls } from './TransportControls'
import { SeekBar } from './SeekBar'
import { VolumeSlider } from './VolumeSlider'
import { RevealIcon, QueueIcon } from './Icons'
import { useQueuePanel } from './QueuePanel'

export function NowPlayingBar(): JSX.Element {
  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const track = useLibrary((s) => (currentTrackId ? s.tracksById.get(currentTrackId) : undefined))
  const upNextCount = usePlayer((s) => s.upNext.length)
  const toggleQueue = useQueuePanel((s) => s.toggle)
  const queueOpen = useQueuePanel((s) => s.open)

  return (
    <footer className="nowplaying">
      <div className="np-left">
        {track ? (
          <>
            <Cover trackId={track.id} hasArt={track.hasArt} size="lg" className="np-cover" />
            <div className="np-text">
              <span className="np-title" title={track.title}>
                {track.title}
              </span>
              <span className="np-artist" title={track.artist}>
                {track.artist}
              </span>
            </div>
            <button
              className="icon-btn np-reveal"
              title="Reveal in Finder"
              onClick={() => void window.api.revealTrack(track.path)}
            >
              <RevealIcon size={16} />
            </button>
          </>
        ) : (
          <div className="np-empty">
            <div className="np-cover np-cover-empty" />
            <div className="np-text">
              <span className="np-title np-muted">Nothing playing</span>
              <span className="np-artist">Pick a track to start</span>
            </div>
          </div>
        )}
      </div>

      <div className="np-center">
        <TransportControls />
        <SeekBar />
      </div>

      <div className="np-right">
        <button
          className={`icon-btn np-queue ${queueOpen ? 'is-active' : ''}`}
          title="Up next"
          aria-label="Up next"
          onClick={toggleQueue}
        >
          <QueueIcon size={18} />
          {upNextCount > 0 && <span className="np-queue-count">{upNextCount}</span>}
        </button>
        <VolumeSlider />
      </div>
    </footer>
  )
}
