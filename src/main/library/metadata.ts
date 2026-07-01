import { promises as fs } from 'node:fs'
import { basename, extname, dirname, join } from 'node:path'
import type { Track } from '../../shared/models'
import { MetaCache, TrackMeta, trackIdForPath } from '../cache'
import { writeBothThumbnails } from '../thumbnails'
import { isUnsupportedCodec, codecLabel } from '../codecs'

/** A fully-parsed track minus the playlist assignment (added by the model). */
export type RawTrack = Omit<Track, 'playlistId'>

// music-metadata is pure-ESM; load it lazily via dynamic import from our CJS main.
let mmPromise: Promise<typeof import('music-metadata')> | null = null
const mm = (): Promise<typeof import('music-metadata')> => (mmPromise ??= import('music-metadata'))

const SIDECAR_STEMS = new Set(['cover', 'folder', 'front', 'album', 'albumart', 'albumartsmall'])
const SIDECAR_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const sidecarMemo = new Map<string, string | null>()

async function findSidecarArt(fileDir: string): Promise<string | null> {
  const memo = sidecarMemo.get(fileDir)
  if (memo !== undefined) return memo
  let found: string | null = null
  try {
    const entries = await fs.readdir(fileDir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isFile()) continue
      const lower = e.name.toLowerCase()
      const ext = extname(lower)
      const stem = lower.slice(0, lower.length - ext.length)
      if (SIDECAR_EXTS.has(ext) && SIDECAR_STEMS.has(stem)) {
        found = join(fileDir, e.name)
        break
      }
    }
  } catch {
    /* unreadable dir */
  }
  sidecarMemo.set(fileDir, found)
  return found
}

function titleFromPath(p: string): string {
  const b = basename(p)
  return b.slice(0, b.length - extname(b).length)
}

function fallbackMeta(absPath: string): TrackMeta {
  return {
    title: titleFromPath(absPath),
    artist: 'Unknown Artist',
    album: 'Unknown Album',
    albumArtist: '',
    year: null,
    trackNo: null,
    trackOf: null,
    discNo: null,
    genre: '',
    durationSec: null,
    hasArt: false,
    codec: '',
    unsupported: isUnsupportedCodec(absPath)
  }
}

/** Parse one file (or return a cache hit). Returns null if the file vanished. */
export async function parseTrack(absPath: string, cache: MetaCache): Promise<RawTrack | null> {
  let stat
  try {
    stat = await fs.stat(absPath)
  } catch {
    return null
  }
  const mtimeMs = stat.mtimeMs
  const size = stat.size
  const id = trackIdForPath(absPath)

  const cached = cache.get(absPath, mtimeMs, size)
  if (cached) {
    return { id, path: absPath, mtimeMs, size, ...cached }
  }

  let meta: TrackMeta
  try {
    const { parseFile, selectCover } = await mm()
    const { common, format } = await parseFile(absPath, { duration: true })

    const codec = codecLabel(format.codec, format.container)
    const unsupported = isUnsupportedCodec(absPath, format.codec, format.container)

    let hasArt = false
    const pic = selectCover(common.picture)
    if (pic?.data && pic.data.length > 0) {
      hasArt = await writeBothThumbnails(id, pic.data)
    }
    if (!hasArt) {
      const sidecar = await findSidecarArt(dirname(absPath))
      if (sidecar) {
        try {
          hasArt = await writeBothThumbnails(id, await fs.readFile(sidecar))
        } catch {
          /* sidecar unreadable */
        }
      }
    }

    const genre = Array.isArray(common.genre) ? common.genre.filter(Boolean).join(', ') : ''
    meta = {
      title: common.title?.trim() || titleFromPath(absPath),
      artist: common.artist?.trim() || 'Unknown Artist',
      album: common.album?.trim() || 'Unknown Album',
      albumArtist: common.albumartist?.trim() || '',
      year: common.year ?? null,
      trackNo: common.track?.no ?? null,
      trackOf: common.track?.of ?? null,
      discNo: common.disk?.no ?? null,
      genre,
      durationSec: typeof format.duration === 'number' ? format.duration : null,
      hasArt,
      codec,
      unsupported
    }
  } catch {
    meta = fallbackMeta(absPath)
  }

  cache.set(absPath, mtimeMs, size, meta)
  return { id, path: absPath, mtimeMs, size, ...meta }
}

/** Run an async mapper over items with a bounded number of concurrent workers. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runner = async (): Promise<void> => {
    while (cursor < items.length) {
      const idx = cursor++
      results[idx] = await fn(items[idx], idx)
    }
  }
  const n = Math.max(1, Math.min(limit, items.length || 1))
  await Promise.all(Array.from({ length: n }, () => runner()))
  return results
}

/** Drop the in-memory sidecar lookup memo (used on a forced rescan). */
export function resetSidecarMemo(): void {
  sidecarMemo.clear()
}
