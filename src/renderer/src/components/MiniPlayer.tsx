import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { coverUrl } from '@shared/ipc'
import type { PlayerSnapshot, PlayerCommand } from '@shared/models'
import {
  PlayIcon,
  PauseIcon,
  PrevIcon,
  NextIcon,
  ShuffleIcon,
  RepeatIcon,
  RepeatOneIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeMuteIcon
} from './Icons'
import { formatTime } from '../lib/format'

const send = (cmd: PlayerCommand): void => window.api.sendPlayerCommand(cmd)

function Bar({
  fraction,
  variant,
  onScrub,
  onCommit
}: {
  fraction: number
  variant: 'seek' | 'vol'
  onScrub: (f: number) => void
  onCommit: (f: number) => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const fracAt = (clientX: number): number => {
    const el = ref.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  }
  const pct = Math.min(1, Math.max(0, fraction)) * 100
  const trackCls = variant === 'seek' ? 'seek-track' : 'vol-track'
  const fillCls = variant === 'seek' ? 'seek-fill' : 'vol-fill'
  const thumbCls = variant === 'seek' ? 'seek-thumb' : 'vol-thumb'
  return (
    <div
      ref={ref}
      className={`${trackCls} ${drag ? 'is-dragging' : ''}`}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        ref.current?.setPointerCapture(e.pointerId)
        setDrag(true)
        onScrub(fracAt(e.clientX))
      }}
      onPointerMove={(e: PointerEvent<HTMLDivElement>) => {
        if (drag) onScrub(fracAt(e.clientX))
      }}
      onPointerUp={(e: PointerEvent<HTMLDivElement>) => {
        if (!drag) return
        onCommit(fracAt(e.clientX))
        setDrag(false)
      }}
      onPointerCancel={() => setDrag(false)}
    >
      <div className={fillCls} style={{ width: `${pct}%` }} />
      <div className={thumbCls} style={{ left: `${pct}%` }} />
    </div>
  )
}

export function MiniPlayer(): JSX.Element {
  const [snap, setSnap] = useState<PlayerSnapshot | null>(null)
  const [seekOverride, setSeekOverride] = useState<number | null>(null)
  const [volOverride, setVolOverride] = useState<number | null>(null)
  const seekingRef = useRef(false)
  const volRef = useRef(false)

  useEffect(() => {
    const off = window.api.onPlayerState((s) => {
      setSnap(s)
      if (!seekingRef.current) setSeekOverride(null)
      if (!volRef.current) setVolOverride(null)
    })
    return off
  }, [])

  if (!snap) {
    return <div className="mini mini-empty">Connecting…</div>
  }

  const hasTrack = snap.hasTrack
  const time = seekOverride ?? snap.currentTime
  const duration = snap.duration
  const vol = volOverride ?? (snap.muted ? 0 : snap.volume)

  const VolIcon = snap.muted || vol === 0 ? VolumeMuteIcon : vol < 0.5 ? VolumeLowIcon : VolumeHighIcon

  return (
    <div className="mini">
      <div className="mini-top">
        <button
          className="mini-art"
          onClick={() => send({ type: 'showApp' })}
          title="Open Folderify"
          aria-label="Open Folderify"
        >
          {hasTrack && snap.trackId ? (
            <img className="cover" src={coverUrl(snap.trackId, 'lg')} alt="" draggable={false} />
          ) : (
            <span className="mini-art-empty" />
          )}
        </button>
        <div className="mini-meta">
          <span className="mini-title" title={snap.title}>
            {hasTrack ? snap.title : 'Nothing playing'}
          </span>
          <span className="mini-artist" title={snap.artist}>
            {hasTrack ? snap.artist : 'Open Folderify to pick a track'}
          </span>
        </div>
      </div>

      <div className="mini-seek">
        <span className="seek-time tnum">{formatTime(time)}</span>
        <Bar
          variant="seek"
          fraction={duration > 0 ? time / duration : 0}
          onScrub={(f) => {
            seekingRef.current = true
            setSeekOverride(f * duration)
          }}
          onCommit={(f) => {
            seekingRef.current = false
            if (duration > 0) {
              setSeekOverride(f * duration)
              send({ type: 'seek', value: f * duration })
            }
          }}
        />
        <span className="seek-time tnum">{formatTime(duration)}</span>
      </div>

      <div className="mini-transport">
        <button
          className={`t-btn ${snap.shuffle ? 'is-on' : ''}`}
          onClick={() => send({ type: 'toggleShuffle' })}
          title="Shuffle"
        >
          <ShuffleIcon size={16} />
        </button>
        <button className="t-btn" onClick={() => send({ type: 'prev' })} disabled={!hasTrack} title="Previous">
          <PrevIcon size={19} />
        </button>
        <button
          className="play-fab"
          onClick={() => send({ type: 'toggle' })}
          disabled={!hasTrack}
          aria-label={snap.isPlaying ? 'Pause' : 'Play'}
        >
          {snap.isPlaying ? <PauseIcon size={19} /> : <PlayIcon size={19} />}
        </button>
        <button className="t-btn" onClick={() => send({ type: 'next' })} disabled={!hasTrack} title="Next">
          <NextIcon size={19} />
        </button>
        <button
          className={`t-btn ${snap.repeat !== 'off' ? 'is-on' : ''}`}
          onClick={() => send({ type: 'cycleRepeat' })}
          title="Repeat"
        >
          {snap.repeat === 'one' ? <RepeatOneIcon size={16} /> : <RepeatIcon size={16} />}
        </button>
      </div>

      <div className="mini-volume">
        <button className="icon-btn" onClick={() => send({ type: 'toggleMute' })} aria-label="Mute">
          <VolIcon size={17} />
        </button>
        <Bar
          variant="vol"
          fraction={vol}
          onScrub={(f) => {
            volRef.current = true
            setVolOverride(f)
            send({ type: 'setVolume', value: f })
          }}
          onCommit={(f) => {
            volRef.current = false
            setVolOverride(f)
            send({ type: 'setVolume', value: f })
          }}
        />
      </div>
    </div>
  )
}
