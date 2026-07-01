import type { JSX } from 'react'

/** Three animated bars shown on the currently-playing track. Freezes when paused. */
export function PlayingIndicator({ playing }: { playing: boolean }): JSX.Element {
  return (
    <span className={`eq ${playing ? 'eq-on' : 'eq-paused'}`} aria-hidden="true">
      <span className="eq-bar" />
      <span className="eq-bar" />
      <span className="eq-bar" />
    </span>
  )
}
