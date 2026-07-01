import type { JSX } from 'react'
import { Cover } from './Cover'
import { PlayIcon, PauseIcon } from './Icons'

interface FolderHeroProps {
  eyebrow: string
  title: string
  meta: string
  coverTrackId: string | null
  hasArt: boolean
  playing: boolean
  onPlayToggle: () => void
}

export function FolderHero({
  eyebrow,
  title,
  meta,
  coverTrackId,
  hasArt,
  playing,
  onPlayToggle
}: FolderHeroProps): JSX.Element {
  return (
    <div className="hero">
      <div className="hero-art">
        <Cover trackId={coverTrackId} hasArt={hasArt} size="lg" className="hero-cover" />
      </div>
      <div className="hero-info">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="hero-title">{title}</h1>
        <span className="hero-meta">{meta}</span>
      </div>
      <button className="hero-play" onClick={onPlayToggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
      </button>
    </div>
  )
}
