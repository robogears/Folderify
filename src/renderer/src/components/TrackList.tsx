import { useCallback, useMemo, type JSX } from 'react'
import { TrackRow } from './TrackRow'
import { usePlayer } from '../state/player-store'
import type { Track } from '@shared/models'

interface TrackListProps {
  tracks: Track[]
  contextLabel: string
}

export function TrackList({ tracks, contextLabel }: TrackListProps): JSX.Element {
  const playContext = usePlayer((s) => s.playContext)
  const ids = useMemo(() => tracks.map((t) => t.id), [tracks])
  const onPlay = useCallback(
    (trackId: string) => playContext(ids, trackId, contextLabel),
    [ids, contextLabel, playContext]
  )

  return (
    <div className="track-list">
      <div className="track-head">
        <div className="th-index">#</div>
        <div className="th-title">Title</div>
        <div className="th-album">Album</div>
        <div className="th-duration">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div className="track-rows">
        {tracks.map((t, i) => (
          <TrackRow key={t.id} track={t} position={i + 1} onPlay={onPlay} />
        ))}
      </div>
    </div>
  )
}
