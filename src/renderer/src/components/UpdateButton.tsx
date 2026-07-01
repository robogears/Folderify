import type { JSX } from 'react'
import { useUpdates } from '../state/updates-store'

/** The update state-machine button, shared by the top-bar pill and Settings. */
export function UpdateButton({ className = '' }: { className?: string }): JSX.Element | null {
  const available = useUpdates((s) => s.available)
  const canSelfInstall = useUpdates((s) => s.canSelfInstall)
  const state = useUpdates((s) => s.downloadState)
  const pct = useUpdates((s) => s.progressPct)
  const startDownload = useUpdates((s) => s.startDownload)
  const apply = useUpdates((s) => s.apply)
  const openRelease = useUpdates((s) => s.openRelease)

  if (!available) return null

  let label: string
  let onClick: () => void
  let disabled = false
  let ready = false

  if (!canSelfInstall) {
    label = `Get v${available.version}`
    onClick = openRelease
  } else if (state === 'downloading') {
    label = `Downloading ${pct}%`
    onClick = () => {}
    disabled = true
  } else if (state === 'ready') {
    label = 'Restart to apply'
    onClick = apply
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
    <button className={`update-btn ${ready ? 'is-ready' : ''} ${className}`} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  )
}
