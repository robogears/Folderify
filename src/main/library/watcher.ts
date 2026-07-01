import { basename, extname } from 'node:path'
import type { FSWatcher } from 'chokidar'
import { Library } from './model'
import type { FsDelta, Track } from '../../shared/models'
import { AUDIO_EXT } from '../../shared/audio-extensions'

type ChokidarMod = typeof import('chokidar')
let chokidarPromise: Promise<ChokidarMod> | null = null
const loadChokidar = (): Promise<ChokidarMod> => (chokidarPromise ??= import('chokidar'))

const isAudioPath = (p: string): boolean => AUDIO_EXT.has(extname(p).toLowerCase())

/**
 * Watches the library root and applies debounced, batched deltas to the model.
 * One settled batch of filesystem events => one model recompute => one delta.
 */
export class LibraryWatcher {
  private watcher: FSWatcher | null = null
  private pendingUpsert = new Set<string>()
  private pendingRemove = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private library: Library,
    private onDelta: (delta: FsDelta) => void
  ) {}

  async start(root: string): Promise<void> {
    await this.stop()
    const chokidar = await loadChokidar()
    const watch =
      (chokidar as { watch?: ChokidarMod['watch'] }).watch ??
      (chokidar as unknown as { default: ChokidarMod }).default.watch

    this.watcher = watch(root, {
      persistent: true,
      ignoreInitial: true, // we run our own faster initial scan
      followSymlinks: false,
      alwaysStat: false,
      awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 100 },
      ignored: (p: string, stats?: { isFile(): boolean }) => {
        if (basename(p).startsWith('.')) return true
        // `ignored` is called twice (with and without stats) — guard before using.
        if (stats && stats.isFile()) return !isAudioPath(p)
        return false // never prune a directory we want to descend into
      }
    })

    this.watcher
      .on('add', (p: string) => this.queueUpsert(p))
      .on('change', (p: string) => this.queueUpsert(p))
      .on('unlink', (p: string) => this.queueRemove(p))
      .on('addDir', () => this.schedule())
      .on('unlinkDir', () => this.schedule())
      .on('error', () => {
        /* transient watch errors are non-fatal */
      })
  }

  private queueUpsert(p: string): void {
    if (!isAudioPath(p)) return
    this.pendingRemove.delete(p)
    this.pendingUpsert.add(p)
    this.schedule()
  }

  private queueRemove(p: string): void {
    if (!isAudioPath(p)) return
    this.pendingUpsert.delete(p)
    this.pendingRemove.add(p)
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.flush(), 400)
  }

  private async flush(): Promise<void> {
    this.timer = null
    const upserts = [...this.pendingUpsert]
    const removes = [...this.pendingRemove]
    this.pendingUpsert.clear()
    this.pendingRemove.clear()
    if (upserts.length === 0 && removes.length === 0) return

    const added: Track[] = []
    const updated: Track[] = []
    const removedIds: string[] = []

    for (const p of removes) {
      const id = this.library.remove(p)
      if (id) removedIds.push(id)
    }
    for (const p of upserts) {
      const res = await this.library.upsert(p)
      if (res) (res.wasNew ? added : updated).push(res.track)
    }

    const playlists = this.library.computePlaylists()
    this.onDelta({ added, updated, removedIds, playlists })
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.pendingUpsert.clear()
    this.pendingRemove.clear()
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }
  }
}
