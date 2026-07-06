import { useEffect, useState, type JSX } from 'react'
import { useListen } from '../state/listen-store'
import { CloseIcon } from './Icons'

/**
 * The Connect / "Listen together" modal. Pairing is approval-based (no PIN): click a
 * discovered device → the other Mac gets an Allow/Deny prompt and can trust you forever.
 * Sibling of SettingsPanel — same Escape/backdrop-to-close contract.
 */
export function ListenPanel(): JSX.Element | null {
  const open = useListen((s) => s.panelOpen)
  const close = useListen((s) => s.closePanel)
  const status = useListen((s) => s.status)
  const deviceName = useListen((s) => s.deviceName)
  const localAddresses = useListen((s) => s.localAddresses)
  const peers = useListen((s) => s.peers)
  const peer = useListen((s) => s.peer)
  const incoming = useListen((s) => s.incoming)
  const role = useListen((s) => s.role)
  const error = useListen((s) => s.error)
  const startDiscovery = useListen((s) => s.startDiscovery)
  const stopDiscovery = useListen((s) => s.stopDiscovery)
  const connectToPeer = useListen((s) => s.connectToPeer)
  const connectByIp = useListen((s) => s.connectByIp)
  const respondIncoming = useListen((s) => s.respondIncoming)
  const disconnect = useListen((s) => s.disconnect)

  const [manualIp, setManualIp] = useState('')
  const [trust, setTrust] = useState(true)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

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
          {/* Incoming request takes over the panel until answered. */}
          {incoming ? (
            <>
              <p className="listen-lead">
                <strong>{incoming.name}</strong> wants to listen together.
              </p>
              <p className="listen-hint">
                They&rsquo;ll be able to hear music you play, and play songs from their own
                library to you.
              </p>
              <button
                className="setting-row listen-trust-row"
                onClick={() => setTrust((t) => !t)}
                role="switch"
                aria-checked={trust}
              >
                <span className="setting-text">
                  <span className="setting-label">Trust this device</span>
                  <span className="setting-hint">Let it connect again without asking.</span>
                </span>
                <span className={`switch ${trust ? 'is-on' : ''}`}>
                  <span className="switch-knob" />
                </span>
              </button>
              <div className="listen-actions">
                <button className="btn-ghost" onClick={() => respondIncoming(false, false)}>
                  Deny
                </button>
                <button className="listen-cta" onClick={() => respondIncoming(true, trust)}>
                  Allow
                </button>
              </div>
            </>
          ) : status === 'idle' ? (
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
                {localAddresses[0] && (
                  <div className="settings-info-row">
                    <span className="settings-info-k">Your IP</span>
                    <span className="settings-info-v">{localAddresses[0]}</span>
                  </div>
                )}
              </div>
              <p className="listen-hint">
                Find the other Mac below, or share your IP so they can connect to you.
              </p>
              {error && <p className="listen-error">{error}</p>}
              <button className="listen-cta" onClick={startDiscovery}>
                Find nearby devices
              </button>
            </>
          ) : status === 'discovering' ? (
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
                    <button key={pr.id} className="listen-peer" onClick={() => connectToPeer(pr)}>
                      <span className="listen-peer-name">{pr.name}</span>
                      <span className="listen-peer-go">Connect</span>
                    </button>
                  ))}
                </div>
              )}
              {error && <p className="listen-error">{error}</p>}

              <div className="listen-manual">
                <span className="listen-hint">Don’t see it? Enter the other Mac’s IP address:</span>
                <div className="listen-actions">
                  <input
                    className="listen-ip-input"
                    inputMode="decimal"
                    placeholder="192.168.1.42"
                    value={manualIp}
                    onChange={(e) => setManualIp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && manualIp.trim()) connectByIp(manualIp)
                    }}
                  />
                  <button
                    className="listen-cta"
                    disabled={!manualIp.trim()}
                    onClick={() => connectByIp(manualIp)}
                  >
                    Connect
                  </button>
                </div>
              </div>

              <button className="btn-ghost" onClick={stopDiscovery}>
                Stop
              </button>
            </>
          ) : status === 'connecting' ? (
            <div className="listen-center">
              <span className="listen-spinner listen-spinner-lg" aria-hidden="true" />
              <p className="listen-hint">
                Waiting for {peer?.name ?? 'the other Mac'} to accept…
              </p>
              <button className="btn-ghost" onClick={disconnect}>
                Cancel
              </button>
            </div>
          ) : status === 'connected' ? (
            <>
              <div className="listen-connected">
                <span className="listen-dot" aria-hidden="true" />
                <div className="listen-connected-text">
                  <span className="listen-connected-name">Connected to {peer?.name ?? 'device'}</span>
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
          ) : null}
        </div>

        <footer className="listen-footer">
          <span className="listen-note">
            Both Macs need Folderify on the same Wi-Fi. Audio is sent peer-to-peer and encrypted.
          </span>
        </footer>
      </div>
    </div>
  )
}
