import { memo, useState, type JSX } from 'react'
import { Cover } from './Cover'
import { PlayingIndicator } from './PlayingIndicator'
import { PlayIcon, PauseIcon, AlertIcon } from './Icons'
import { formatTime } from '../lib/format'
import { usePlayer } from '../state/player-store'
import type { Track } from '@shared/models'

interface TrackRowProps {
  track: Track
  position: number
  onPlay: (trackId: string) => void
}

function TrackRowImpl({ track, position, onPlay }: TrackRowProps): JSX.Element {
  // Self-subscribe so only the (old/new) current row re-renders on track change.
  const isCurrent = usePlayer((s) => s.currentTrackId === track.id)
  const isPlaying = usePlayer((s) => s.isPlaying && s.currentTrackId === track.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const play = (): void => {
    if (!track.unsupported) onPlay(track.id)
  }

  return (
    <>
      <div
        className={`track-row ${isCurrent ? 'is-current' : ''} ${track.unsupported ? 'is-unsupported' : ''}`}
        onDoubleClick={play}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        <div className="track-index">
          {isCurrent ? (
            <>
              <PlayingIndicator playing={isPlaying} />
              <button
                className="track-play-btn"
                onClick={() => usePlayer.getState().togglePlay()}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <PauseIcon size={15} /> : <PlayIcon size={15} />}
              </button>
            </>
          ) : (
            <>
              <span className="track-num tnum">{position}</span>
              <button className="track-play-btn" onClick={play} aria-label={`Play ${track.title}`}>
                {track.unsupported ? <AlertIcon size={15} /> : <PlayIcon size={15} />}
              </button>
            </>
          )}
        </div>

        <div className="track-main">
          <Cover trackId={track.id} hasArt={track.hasArt} className="track-art" />
          <div className="track-text">
            <span className="track-title">{track.title}</span>
            <span className="track-artist">
              {track.artist}
              {track.unsupported && <span className="badge">Can’t play</span>}
            </span>
          </div>
        </div>

        <div className="track-album" title={track.album}>
          {track.album}
        </div>
        <div className="track-duration tnum">{formatTime(track.durationSec)}</div>
      </div>

      {menu && (
        <>
          <div
            className="menu-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
            {!track.unsupported && (
              <>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenu(null)
                    onPlay(track.id)
                  }}
                >
                  Play
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenu(null)
                    usePlayer.getState().playNextInQueue(track.id)
                  }}
                >
                  Play next
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setMenu(null)
                    usePlayer.getState().addToQueue(track.id)
                  }}
                >
                  Add to queue
                </button>
              </>
            )}
            <button
              className="menu-item"
              onClick={() => {
                setMenu(null)
                void window.api.revealTrack(track.path)
              }}
            >
              Reveal in Finder
            </button>
          </div>
        </>
      )}
    </>
  )
}

export const TrackRow = memo(TrackRowImpl)
