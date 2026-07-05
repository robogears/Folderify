import { useEffect, useState, type JSX } from 'react'
import { useListen } from '../state/listen-store'
import { CloseIcon } from './Icons'

/**
 * The Connect / "Listen together" modal. Sibling of SettingsPanel — same self-gating,
 * Escape/backdrop-to-close contract. Driven entirely by the listen-store state machine;
 * the networking backend is stubbed there (see docs/listen-together-design.md).
 */
export function ListenPanel(): JSX.Element | null {
  const open = useListen((s) => s.panelOpen)
  const close = useListen((s) => s.closePanel)
  const status = useListen((s) => s.status)
  const deviceName = useListen((s) => s.deviceName)
  const pin = useListen((s) => s.pin)
  const peers = useListen((s) => s.peers)
  const peer = useListen((s) => s.peer)
  const role = useListen((s) => s.role)
  const error = useListen((s) => s.error)
  const startDiscovery = useListen((s) => s.startDiscovery)
  const stopDiscovery = useListen((s) => s.stopDiscovery)
  const selectPeer = useListen((s) => s.selectPeer)
  const confirmPairing = useListen((s) => s.confirmPairing)
  const cancelPairing = useListen((s) => s.cancelPairing)
  const disconnect = useListen((s) => s.disconnect)

  const [entered, setEntered] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // Clear the typed code whenever we leave the pairing step.
  useEffect(() => {
    if (status !== 'pairing') setEntered('')
  }, [status])

  if (!open) return null

  return (
    <div className="listen-overlay" onClick={close}>
      <div className="listen-modal" onClick={(e) => e.stopPropagation()}>
        <header className="listen-header">
          <h2 className="listen-title">Listen together</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="listen-body">
          {status === 'idle' && (
            <>
              <p className="listen-lead">
                Play in sync with someone on your Wi-Fi. Pick a song on either Mac and
                you&rsquo;ll both hear it — they don&rsquo;t need any of the files.
              </p>
              <div className="settings-info">
                <div className="settings-info-row">
                  <span className="settings-info-k">Your device</span>
                  <span className="settings-info-v">{deviceName}</span>
                </div>
                <div className="settings-info-row">
                  <span className="settings-info-k">Pairing code</span>
                  <span className="settings-info-v listen-pin">{pin}</span>
                </div>
              </div>
              <p className="listen-hint">Share this code so the other Mac can connect to you.</p>
              <button className="listen-cta" onClick={startDiscovery}>
                Find nearby devices
              </button>
            </>
          )}

          {status === 'discovering' && (
            <>
              <div className="listen-row-head">
                <span className="listen-section-title">Nearby devices</span>
                <span className="listen-spinner" aria-hidden="true" />
              </div>
              {peers.length === 0 ? (
                <p className="listen-hint">Looking for Folderify on your network…</p>
              ) : (
                <div className="listen-peers">
                  {peers.map((pr) => (
                    <button
                      key={pr.id}
                      className="listen-peer"
                      onClick={() => selectPeer(pr)}
                    >
                      <span className="listen-peer-name">{pr.name}</span>
                      <span className="listen-peer-go">Connect</span>
                    </button>
                  ))}
                </div>
              )}
              <button className="btn-ghost" onClick={stopDiscovery}>
                Stop
              </button>
            </>
          )}

          {status === 'pairing' && peer && (
            <>
              <p className="listen-lead">
                Connect to <strong>{peer.name}</strong>
              </p>
              <input
                className="listen-pin-input"
                inputMode="numeric"
                placeholder="000000"
                maxLength={6}
                value={entered}
                autoFocus
                onChange={(e) => setEntered(e.target.value.replace(/\D/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmPairing(entered)
                }}
              />
              <p className="listen-hint">Enter the 6-digit code shown on {peer.name}.</p>
              {error && <p className="listen-error">{error}</p>}
              <div className="listen-actions">
                <button className="btn-ghost" onClick={cancelPairing}>
                  Back
                </button>
                <button className="listen-cta" onClick={() => confirmPairing(entered)}>
                  Connect
                </button>
              </div>
            </>
          )}

          {status === 'connecting' && (
            <div className="listen-center">
              <span className="listen-spinner listen-spinner-lg" aria-hidden="true" />
              <p className="listen-hint">Connecting{peer ? ` to ${peer.name}` : ''}…</p>
            </div>
          )}

          {status === 'connected' && (
            <>
              <div className="listen-connected">
                <span className="listen-dot" aria-hidden="true" />
                <div className="listen-connected-text">
                  <span className="listen-connected-name">
                    Connected to {peer?.name ?? 'device'}
                  </span>
                  <span className="listen-hint">
                    {role === 'source'
                      ? 'You’re in control — pick a song and it plays on both.'
                      : role === 'receiver'
                        ? `${peer?.name ?? 'They'} is playing — controls are shared.`
                        : 'Pick a song on either Mac to start listening together.'}
                  </span>
                </div>
              </div>
              <button className="btn-ghost listen-disconnect" onClick={disconnect}>
                Disconnect
              </button>
            </>
          )}
        </div>

        <footer className="listen-footer">
          <span className="listen-note">Preview — device networking isn&rsquo;t wired up yet.</span>
        </footer>
      </div>
    </div>
  )
}
