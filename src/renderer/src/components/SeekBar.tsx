import { useRef, useState, type JSX, type PointerEvent } from 'react'
import { usePlayer } from '../state/player-store'
import { formatTime } from '../lib/format'

export function SeekBar(): JSX.Element {
  const currentTime = usePlayer((s) => s.currentTime)
  const duration = usePlayer((s) => s.duration)
  const seek = usePlayer((s) => s.seek)
  const hasTrack = usePlayer((s) => s.currentTrackId !== null)

  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [dragValue, setDragValue] = useState(0)

  const value = dragging ? dragValue : currentTime
  const pct = duration > 0 ? Math.min(1, Math.max(0, value / duration)) : 0

  const posToTime = (clientX: number): number => {
    const el = trackRef.current
    if (!el || duration <= 0) return 0
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration
  }

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (!hasTrack || duration <= 0) return
    trackRef.current?.setPointerCapture(e.pointerId)
    setDragging(true)
    setDragValue(posToTime(e.clientX))
  }
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging) setDragValue(posToTime(e.clientX))
  }
  const onUp = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    seek(posToTime(e.clientX))
    setDragging(false)
  }

  return (
    <div className="seek">
      <span className="seek-time tnum">{formatTime(value)}</span>
      <div
        className={`seek-track ${dragging ? 'is-dragging' : ''} ${hasTrack ? '' : 'is-disabled'}`}
        ref={trackRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="seek-fill" style={{ width: `${pct * 100}%` }} />
        <div className="seek-thumb" style={{ left: `${pct * 100}%` }} />
      </div>
      <span className="seek-time tnum">{formatTime(duration)}</span>
    </div>
  )
}
