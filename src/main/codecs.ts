import { extname } from 'node:path'
import { UNSUPPORTED_EXT } from '../shared/audio-extensions'

/**
 * Decide whether Chromium (and therefore Electron's <audio>) can decode this file.
 * The container/codec from music-metadata is authoritative — notably a `.m4a` may
 * be AAC (playable) or ALAC (not), indistinguishable by extension alone.
 */
export function isUnsupportedCodec(absPath: string, codec?: string, container?: string): boolean {
  const c = (codec ?? '').toLowerCase()
  const k = (container ?? '').toLowerCase()

  if (c) {
    if (c.includes('alac')) return true // Apple Lossless
    if (c.includes('aiff')) return true
    if (c.includes('monkey') || c === 'ape') return true // Monkey's Audio
    if (c.includes('wavpack')) return true
    if (c.includes('musepack')) return true
    if (c.includes('dsd') || c.includes('dsf') || c.includes('dff')) return true
    if (c.includes('windows media') || c.includes('wma')) return true
  }
  if (k) {
    if (k.includes('aiff')) return true
    if (k.includes('dsf') || k.includes('dsdiff')) return true
  }

  // If the container couldn't be parsed, fall back to the extension allowlist.
  if (!codec && !container) {
    return UNSUPPORTED_EXT.has(extname(absPath).toLowerCase())
  }
  return false
}

/** A short, human-friendly codec label for the UI. */
export function codecLabel(codec?: string, container?: string): string {
  return (codec || container || '').toString()
}
