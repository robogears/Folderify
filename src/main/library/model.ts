import { relative, sep, basename, join } from 'node:path'
import {
  Track,
  Playlist,
  LibraryModel,
  LOOSE_PLAYLIST_ID,
  LOOSE_PLAYLIST_NAME
} from '../../shared/models'
import { MetaCache } from '../cache'
import { scanAudioFiles } from './scanner'
import { parseTrack, mapWithConcurrency, resetSidecarMemo } from './metadata'
import { deleteThumbnails } from '../thumbnails'

export type ProgressFn = (scanned: number, total: number, phase: 'walking' | 'parsing' | 'done') => void

function compareTracks(a: Track, b: Track): number {
  const al = a.album.localeCompare(b.album)
  if (al !== 0) return al
  const disc = (a.discNo ?? 0) - (b.discNo ?? 0)
  if (disc !== 0) return disc
  const tn = (a.trackNo ?? 9999) - (b.trackNo ?? 9999)
  if (tn !== 0) return tn
  return a.title.localeCompare(b.title)
}

/**
 * The in-memory library. Maps the filesystem tree to the library + playlists
 * model and supports incremental add/update/remove from the watcher.
 *
 * Playlist rule: a track's playlist is the FIRST path segment under the root.
 * Files directly in the root belong to the reserved "Loose Tracks" playlist.
 * A playlist contains every audio file found recursively within its subfolder.
 */
export class Library {
  private root: string | null = null
  private tracks = new Map<string, Track>() // id -> Track
  private pathToId = new Map<string, string>() // absPath -> id

  constructor(private cache: MetaCache) {}

  getRoot(): string | null {
    return this.root
  }

  hasRoot(): boolean {
    return this.root !== null
  }

  trackById(id: string): Track | undefined {
    return this.tracks.get(id)
  }

  trackByPath(path: string): Track | undefined {
    const id = this.pathToId.get(path)
    return id ? this.tracks.get(id) : undefined
  }

  playlistIdForPath(filePath: string): string {
    if (!this.root) return LOOSE_PLAYLIST_ID
    const rel = relative(this.root, filePath)
    if (!rel || rel.startsWith('..')) return LOOSE_PLAYLIST_ID
    const segs = rel.split(sep)
    return segs.length <= 1 ? LOOSE_PLAYLIST_ID : segs[0]
  }

  /** Full scan + parse of a root folder, replacing any existing state. */
  async build(root: string, onProgress?: ProgressFn): Promise<LibraryModel> {
    this.root = root
    this.tracks.clear()
    this.pathToId.clear()
    resetSidecarMemo()

    const paths = await scanAudioFiles(root, (found) => onProgress?.(found, found, 'walking'))
    const total = paths.length
    let done = 0

    const raws = await mapWithConcurrency(paths, 8, async (p) => {
      const r = await parseTrack(p, this.cache)
      done++
      if (done % 8 === 0 || done === total) onProgress?.(done, total, 'parsing')
      return r
    })

    for (const raw of raws) {
      if (!raw) continue
      const track: Track = { ...raw, playlistId: this.playlistIdForPath(raw.path) }
      this.tracks.set(track.id, track)
      this.pathToId.set(track.path, track.id)
    }

    await this.cache.flush()
    onProgress?.(total, total, 'done')
    return this.toModel()
  }

  /** Reset to an empty, no-root state (e.g. user disconnected their folder). */
  reset(): void {
    this.root = null
    this.tracks.clear()
    this.pathToId.clear()
  }

  /** Parse and insert/replace a single path. Returns the track + whether it's new. */
  async upsert(path: string): Promise<{ track: Track; wasNew: boolean } | null> {
    const existingId = this.pathToId.get(path)
    const raw = await parseTrack(path, this.cache)
    if (!raw) return null
    const track: Track = { ...raw, playlistId: this.playlistIdForPath(raw.path) }
    const wasNew = !existingId
    this.tracks.set(track.id, track)
    this.pathToId.set(track.path, track.id)
    return { track, wasNew }
  }

  /** Remove a single path. Returns the removed track id, or null if unknown. */
  remove(path: string): string | null {
    const id = this.pathToId.get(path)
    if (!id) return null
    this.tracks.delete(id)
    this.pathToId.delete(path)
    void deleteThumbnails(id)
    this.cache.delete(path)
    return id
  }

  computePlaylists(): Playlist[] {
    const byPlaylist = new Map<string, Track[]>()
    for (const t of this.tracks.values()) {
      const arr = byPlaylist.get(t.playlistId)
      if (arr) arr.push(t)
      else byPlaylist.set(t.playlistId, [t])
    }

    const playlists: Playlist[] = []
    for (const [id, list] of byPlaylist) {
      list.sort(compareTracks)
      const withArt = list.find((t) => t.hasArt)
      playlists.push({
        id,
        name: id === LOOSE_PLAYLIST_ID ? LOOSE_PLAYLIST_NAME : id,
        path: id === LOOSE_PLAYLIST_ID ? this.root ?? '' : this.root ? join(this.root, id) : id,
        trackIds: list.map((t) => t.id),
        coverTrackId: (withArt ?? list[0])?.id ?? null
      })
    }

    // Alphabetical, with "Loose Tracks" pinned to the end.
    playlists.sort((a, b) => {
      if (a.id === LOOSE_PLAYLIST_ID) return 1
      if (b.id === LOOSE_PLAYLIST_ID) return -1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return playlists
  }

  allTracks(): Track[] {
    return [...this.tracks.values()]
  }

  toModel(): LibraryModel {
    return {
      root: this.root,
      rootName: this.root ? basename(this.root) : null,
      playlists: this.computePlaylists(),
      tracks: this.allTracks()
    }
  }
}
