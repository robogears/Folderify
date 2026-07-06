import { useEffect, type JSX } from 'react'
import { useSettings, LAYOUTS, type LayoutPreset } from '../state/settings-store'
import { useLibrary } from '../state/library-store'
import { useUpdates } from '../state/updates-store'
import { UpdateButton } from './UpdateButton'
import { CloseIcon, CheckIcon } from './Icons'
import { pluralize } from '../lib/format'

function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}): JSX.Element {
  return (
    <button className="setting-row" onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <span className={`switch ${checked ? 'is-on' : ''}`}>
        <span className="switch-knob" />
      </span>
    </button>
  )
}

function LayoutPreview({ id }: { id: LayoutPreset }): JSX.Element {
  return (
    <span className={`lp lp-${id}`}>
      <span className="lp-side" />
      <span className="lp-main">
        {id === 'compact' ? (
          <span className="lp-rows">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className={`lp-grid ${id === 'cover' ? 'lp-grid-lg' : ''}`}>
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
      </span>
      <span className="lp-bar" />
    </span>
  )
}

export function SettingsPanel(): JSX.Element | null {
  const open = useSettings((s) => s.settingsOpen)
  const close = useSettings((s) => s.closeSettings)
  const layout = useSettings((s) => s.layout)
  const setLayout = useSettings((s) => s.setLayout)
  const sidebarCollapsed = useSettings((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useSettings((s) => s.setSidebarCollapsed)
  const resumeLastTrack = useSettings((s) => s.resumeLastTrack)
  const setResumeLastTrack = useSettings((s) => s.setResumeLastTrack)
  const exclusiveMediaKeys = useSettings((s) => s.exclusiveMediaKeys)
  const setExclusiveMediaKeys = useSettings((s) => s.setExclusiveMediaKeys)

  const rootName = useLibrary((s) => s.rootName)
  const trackCount = useLibrary((s) => s.tracksById.size)
  const playlistCount = useLibrary((s) => s.playlists.length)

  const appVersion = useUpdates((s) => s.appVersion)
  const available = useUpdates((s) => s.available)
  const checkState = useUpdates((s) => s.checkState)
  const retryAfterSeconds = useUpdates((s) => s.retryAfterSeconds)
  const check = useUpdates((s) => s.check)

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
    <div className="settings-overlay" onClick={close}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <header className="settings-header">
          <h2 className="settings-title">Settings</h2>
          <button className="icon-btn" onClick={close} aria-label="Close settings">
            <CloseIcon size={18} />
          </button>
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Layout</h3>
            <p className="settings-section-sub">Choose how your library looks. “Default” is the original design.</p>
            <div className="layout-grid">
              {LAYOUTS.map((p) => (
                <button
                  key={p.id}
                  className={`layout-card ${layout === p.id ? 'is-active' : ''}`}
                  onClick={() => setLayout(p.id)}
                >
                  <LayoutPreview id={p.id} />
                  <span className="layout-card-name">
                    {p.name}
                    {layout === p.id && <CheckIcon size={14} />}
                  </span>
                  <span className="layout-card-desc">{p.description}</span>
                </button>
              ))}
            </div>
            <Toggle
              checked={sidebarCollapsed}
              onChange={setSidebarCollapsed}
              label="Collapse sidebar to icons"
              hint="Shrink the sidebar to a narrow rail for more room."
            />
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Playback</h3>
            <Toggle
              checked={resumeLastTrack}
              onChange={setResumeLastTrack}
              label="Resume last track on launch"
              hint="Reopen to your last track, cued up where you left off."
            />
            <Toggle
              checked={exclusiveMediaKeys}
              onChange={setExclusiveMediaKeys}
              label="Exclusive media keys"
              hint="Route ⏮ ⏯ ⏭ (F7/F8/F9) only to Folderify — other apps can't take them while this is on. macOS may ask for Accessibility access."
            />
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Updates</h3>
            <div className="settings-info">
              <div className="settings-info-row">
                <span className="settings-info-k">Version</span>
                <span className="settings-info-v">v{appVersion || '—'}</span>
              </div>
            </div>
            {available ? (
              <div className="update-row">
                <span className="update-row-text">Version {available.version} is available.</span>
                <UpdateButton />
              </div>
            ) : (
              <button
                className="btn-ghost"
                onClick={() => void check()}
                disabled={checkState === 'checking' || checkState === 'rate-limited'}
              >
                {checkState === 'checking'
                  ? 'Checking…'
                  : checkState === 'up-to-date'
                    ? 'Up to date ✓'
                    : checkState === 'no-releases'
                      ? 'No releases yet'
                      : checkState === 'offline'
                        ? 'You’re offline'
                        : checkState === 'rate-limited'
                          ? `Rate limited — retry in ${retryAfterSeconds}s`
                          : checkState === 'error'
                            ? 'Check failed — retry'
                            : 'Check for updates'}
              </button>
            )}
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Library</h3>
            <div className="settings-info">
              <div className="settings-info-row">
                <span className="settings-info-k">Folder</span>
                <span className="settings-info-v">{rootName ?? '—'}</span>
              </div>
              <div className="settings-info-row">
                <span className="settings-info-k">Contents</span>
                <span className="settings-info-v">
                  {pluralize(playlistCount, 'folder')} · {pluralize(trackCount, 'track')}
                </span>
              </div>
            </div>
          </section>
        </div>

        <footer className="settings-footer">
          <span className="settings-version">Folderify v1</span>
        </footer>
      </div>
    </div>
  )
}
