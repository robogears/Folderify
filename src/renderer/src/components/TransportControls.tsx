import type { JSX } from 'react'
import { usePlayer } from '../state/player-store'
import { ShuffleIcon, PrevIcon, NextIcon, PlayIcon, PauseIcon, RepeatIcon, RepeatOneIcon } from './Icons'

export function TransportControls(): JSX.Element {
  const isPlaying = usePlayer((s) => s.isPlaying)
  const hasTrack = usePlayer((s) => s.currentTrackId !== null)
  const shuffle = usePlayer((s) => s.shuffle)
  const repeat = usePlayer((s) => s.repeat)
  const togglePlay = usePlayer((s) => s.togglePlay)
  const next = usePlayer((s) => s.next)
  const prev = usePlayer((s) => s.prev)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)
  const cycleRepeat = usePlayer((s) => s.cycleRepeat)

  return (
    <div className="transport">
      <button
        className={`t-btn ${shuffle ? 'is-on' : ''}`}
        onClick={toggleShuffle}
        title="Shuffle"
        aria-pressed={shuffle}
      >
        <ShuffleIcon size={17} />
      </button>
      <button className="t-btn" onClick={prev} disabled={!hasTrack} title="Previous">
        <PrevIcon size={20} />
      </button>
      <button className="play-fab" onClick={togglePlay} disabled={!hasTrack} aria-label={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
      </button>
      <button className="t-btn" onClick={() => next(false)} disabled={!hasTrack} title="Next">
        <NextIcon size={20} />
      </button>
      <button
        className={`t-btn ${repeat !== 'off' ? 'is-on' : ''}`}
        onClick={cycleRepeat}
        title={repeat === 'one' ? 'Repeat one' : 'Repeat'}
      >
        {repeat === 'one' ? <RepeatOneIcon size={17} /> : <RepeatIcon size={17} />}
      </button>
    </div>
  )
}
