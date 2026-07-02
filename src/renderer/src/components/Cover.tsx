import type { JSX } from 'react'
import { coverUrl } from '@shared/ipc'

interface CoverProps {
  trackId: string | null | undefined
  hasArt?: boolean
  size?: 'sm' | 'lg'
  className?: string
}

/**
 * Album-art image served lazily through the cover:// protocol. Missing thumbnails
 * resolve to a generated placeholder by the protocol handler, so this never errors.
 */
export function Cover({ trackId, hasArt = true, size = 'sm', className }: CoverProps): JSX.Element {
  const src = trackId && hasArt ? coverUrl(trackId, size) : coverUrl('placeholder', size)
  return (
    <img
      src={src}
      className={`cover ${className ?? ''}`}
      loading="lazy"
      decoding="async"
      draggable={false}
      alt=""
      // On desktop the cover:// handler always resolves (placeholder fallback).
      // On iOS before the scheme handler exists, hide the broken-image glyph so
      // missing art shows as a clean dark tile instead. Reveal again on a
      // successful load so art that arrives later (e.g. after an iOS scan finishes,
      // reusing this same <img>) isn't stuck hidden.
      onError={(e) => {
        e.currentTarget.style.visibility = 'hidden'
      }}
      onLoad={(e) => {
        e.currentTarget.style.visibility = ''
      }}
    />
  )
}
