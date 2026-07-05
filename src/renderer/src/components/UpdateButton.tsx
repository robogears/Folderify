import type { JSX } from 'react'
import { useUpdates } from '../state/updates-store'

/** The update state-machine button, shared by the top-bar pill and Settings. Renders
 *  null unless there's an update to act on (offline / rate-limited feedback lives in
 *  the Settings "Check for updates" row instead, so the top bar stays clean). */
export function UpdateButton({ className = '' }: { className?: string }): JSX.Element | null {
  const available = useUpdates((s) => s.available)
  const canSelfInstall = useUpdates((s) => s.canSelfInstall)
  const state = useUpdates((s) => s.downloadState)
  const pct = useUpdates((s) => s.progressPct)
  const indeterminate = useUpdates((s) => s.indeterminate)
  const startDownload = useUpdates((s) => s.startDownload)
  const apply = useUpdates((s) => s.apply)

  if (!available) return null

  // No self-install path: this build can't self-install, or the release has no
  // arch-matched asset (downloadUrl undefined). Both → open the release page
  // (startDownload() already routes there). Never install the wrong arch.
  const cannotSelfInstall = !canSelfInstall || !available.downloadUrl

  let label: string
  let onClick: () => void
  let disabled = false
  let ready = false

  if (cannotSelfInstall) {
    label = `Get v${available.version}`
    onClick = () => void startDownload()
  } else if (state === 'downloading') {
    label = indeterminate ? 'Downloading…' : `Downloading ${pct}%`
    onClick = () => {}
    disabled = true
  } else if (state === 'ready') {
    label = 'Restart to apply'
    onClick = () => void apply()
    ready = true
  } else if (state === 'restarting') {
    label = 'Updating…'
    onClick = () => {}
    disabled = true
  } else if (state === 'failed') {
    label = 'Download failed — retry'
    onClick = () => void startDownload()
  } else {
    label = `Update to v${available.version}`
    onClick = () => void startDownload()
  }

  return (
    <button
      className={`update-btn ${ready ? 'is-ready' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  )
}
