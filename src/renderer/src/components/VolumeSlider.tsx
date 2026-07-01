import { useRef, useState, type JSX, type PointerEvent } from 'react'
import { usePlayer } from '../state/player-store'
import { VolumeHighIcon, VolumeLowIcon, VolumeMuteIcon } from './Icons'

export function VolumeSlider(): JSX.Element {
  const volume = usePlayer((s) => s.volume)
  const muted = usePlayer((s) => s.muted)
  const setVolume = usePlayer((s) => s.setVolume)
  const toggleMute = usePlayer((s) => s.toggleMute)

  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  const effective = muted ? 0 : volume
  const Icon = muted || volume === 0 ? VolumeMuteIcon : volume < 0.5 ? VolumeLowIcon : VolumeHighIcon

  const posToVol = (clientX: number): number => {
    const el = trackRef.current
    if (!el) return volume
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }

  const onDown = (e: PointerEvent<HTMLDivElement>): void => {
    trackRef.current?.setPointerCapture(e.pointerId)
    setDragging(true)
    setVolume(posToVol(e.clientX))
  }
  const onMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging) setVolume(posToVol(e.clientX))
  }
  const onUp = (): void => setDragging(false)

  return (
    <div className="volume">
      <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>
        <Icon size={18} />
      </button>
      <div
        className={`vol-track ${dragging ? 'is-dragging' : ''}`}
        ref={trackRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div className="vol-fill" style={{ width: `${effective * 100}%` }} />
        <div className="vol-thumb" style={{ left: `${effective * 100}%` }} />
      </div>
    </div>
  )
}
