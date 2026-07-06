import { useEffect, type JSX } from 'react'
import { create } from 'zustand'
import { usePlayer } from '../state/player-store'
import { useLibrary } from '../state/library-store'
import { useListen } from '../state/listen-store'
import { Cover } from './Cover'
import { CloseIcon, PlayIcon } from './Icons'

/** Transient open-state for the Up Next panel (a right-hand drawer). */
interface QueuePanelState {
  open: boolean
  toggle: () => void
  close: () => void
}
export const useQueuePanel = create<QueuePanelState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false })
}))

export function QueuePanel(): JSX.Element | null {
  const open = useQueuePanel((s) => s.open)
  const close = useQueuePanel((s) => s.close)

  const upNext = usePlayer((s) => s.upNext)
  const currentTrackId = usePlayer((s) => s.currentTrackId)
  const removeFromUpNext = usePlayer((s) => s.removeFromUpNext)
  const clearUpNext = usePlayer((s) => s.clearUpNext)
  const playUpNextNow = usePlayer((s) => s.playUpNextNow)
  const tracksById = useLibrary((s) => s.tracksById)

  const connected = useListen((s) => s.status === 'connected')
  const peerName = useListen((s) => s.peer?.name ?? 'them')
  const peerQueue = useListen((s) => s.peerQueue)
  const peerHorizon = useListen((s) => s.peerHorizon)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  const current = currentTrackId ? tracksById.get(currentTrackId) : undefined
  const items = upNext.map((id, i) => ({ id, i, track: tracksById.get(id) }))

  return (
    <div className="queue-overlay" onClick={close}>
      <aside className="queue-panel" onClick={(e) => e.stopPropagation()}>
        <header className="queue-header">
          <h2 className="queue-title">Up next</h2>
          <button className="icon-btn" onClick={close} aria-label="Close queue">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="queue-body">
          {current && (
            <section className="queue-section">
              <span className="queue-section-title">Now playing</span>
              <div className="queue-row is-current">
                <Cover trackId={current.id} hasArt={current.hasArt} className="queue-art" />
                <div className="queue-row-text">
                  <span className="queue-row-title">{current.title}</span>
                  <span className="queue-row-artist">{current.artist}</span>
                </div>
              </div>
            </section>
          )}

          <section className="queue-section">
            <div className="queue-section-head">
              <span className="queue-section-title">Next in queue</span>
              {items.length > 0 && (
                <button className="queue-clear" onClick={clearUpNext}>
                  Clear
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="queue-empty">
                Nothing queued. Right-click a track → <strong>Add to queue</strong>.
              </p>
            ) : (
              <div className="queue-list">
                {items.map(({ id, i, track }) => (
                  <div className="queue-row" key={`${id}-${i}`}>
                    {track ? (
                      <>
                        <Cover trackId={track.id} hasArt={track.hasArt} className="queue-art" />
                        <div className="queue-row-text">
                          <span className="queue-row-title">{track.title}</span>
                          <span className="queue-row-artist">{track.artist}</span>
                        </div>
                      </>
                    ) : (
                      <div className="queue-row-text">
                        <span className="queue-row-title queue-muted">(unavailable)</span>
                      </div>
                    )}
                    <div className="queue-row-actions">
                      {track && !track.unsupported && (
                        <button
                          className="icon-btn queue-mini"
                          title="Play now"
                          onClick={playUpNextNow}
                        >
                          <PlayIcon size={14} />
                        </button>
                      )}
                      <button
                        className="queue-remove"
                        title="Remove"
                        onClick={() => removeFromUpNext(i)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {connected && peerQueue.length > 0 && (
            <section className="queue-section">
              <span className="queue-section-title">Queued by {peerName}</span>
              <div className="queue-list">
                {peerQueue.map((it, i) => (
                  <div className="queue-row is-peer" key={i}>
                    <div className="queue-art queue-art-peer" aria-hidden="true" />
                    <div className="queue-row-text">
                      <span className="queue-row-title">{it.title}</span>
                      <span className="queue-row-artist">{it.artist}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {connected && peerHorizon.length > 1 && (
            <section className="queue-section">
              <span className="queue-section-title">Coming up from {peerName}</span>
              <div className="queue-list">
                {peerHorizon.slice(1).map((it, i) => (
                  <div className="queue-row is-peer" key={`${it.srcId}-${i}`}>
                    <div className="queue-art queue-art-peer" aria-hidden="true" />
                    <div className="queue-row-text">
                      <span className="queue-row-title">{it.title}</span>
                      <span className="queue-row-artist">{it.artist}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
