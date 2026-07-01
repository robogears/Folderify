import { app } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'

/** Stable, filesystem-safe id for a track derived from its absolute path. */
export function trackIdForPath(absPath: string): string {
  return createHash('sha1').update(absPath).digest('hex').slice(0, 16)
}

/** The parsed metadata we persist (everything except path/mtime/size/playlist). */
export interface TrackMeta {
  title: string
  artist: string
  album: string
  albumArtist: string
  year: number | null
  trackNo: number | null
  trackOf: number | null
  discNo: number | null
  genre: string
  durationSec: number | null
  hasArt: boolean
  codec: string
  unsupported: boolean
}

interface CacheEntry {
  mtimeMs: number
  size: number
  meta: TrackMeta
}

const CACHE_VERSION = 1

interface CacheFile {
  version: number
  entries: Record<string, CacheEntry>
}

/**
 * A simple persistent JSON cache keyed by absolute path, invalidated by
 * (mtimeMs + size). Avoids re-parsing unchanged files across launches.
 * (For very large libraries this is the spot to swap in better-sqlite3.)
 */
export class MetaCache {
  private map = new Map<string, CacheEntry>()
  private file: string
  private saveTimer: NodeJS.Timeout | null = null
  private loaded = false

  constructor() {
    this.file = join(app.getPath('userData'), 'folderify-cache.json')
  }

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as CacheFile
      if (parsed.version === CACHE_VERSION && parsed.entries) {
        for (const [k, v] of Object.entries(parsed.entries)) this.map.set(k, v)
      }
    } catch {
      // Missing or corrupt cache is fine — we just reparse.
    }
  }

  get(absPath: string, mtimeMs: number, size: number): TrackMeta | null {
    const e = this.map.get(absPath)
    if (e && e.mtimeMs === mtimeMs && e.size === size) return e.meta
    return null
  }

  set(absPath: string, mtimeMs: number, size: number, meta: TrackMeta): void {
    this.map.set(absPath, { mtimeMs, size, meta })
    this.scheduleSave()
  }

  delete(absPath: string): void {
    if (this.map.delete(absPath)) this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, 1500)
  }

  async flush(): Promise<void> {
    const data: CacheFile = { version: CACHE_VERSION, entries: Object.fromEntries(this.map) }
    try {
      await fs.writeFile(this.file, JSON.stringify(data), 'utf8')
    } catch {
      // Non-fatal: the cache is an optimization.
    }
  }
}
