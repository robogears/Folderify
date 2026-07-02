import type { JSX } from 'react'
import { useNotice } from '../state/notice-store'
import { AlertIcon } from './Icons'

/** Renders the current transient notice (or nothing). Tap to dismiss early. */
export function Toast(): JSX.Element | null {
  const message = useNotice((s) => s.message)
  const clear = useNotice((s) => s.clear)
  if (!message) return null
  return (
    <button className="toast" onClick={clear} title="Dismiss">
      <AlertIcon size={16} />
      <span className="toast-text">{message}</span>
    </button>
  )
}
