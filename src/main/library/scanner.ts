import { promises as fs } from 'node:fs'
import { join, extname } from 'node:path'
import { AUDIO_EXT } from '../../shared/audio-extensions'

/**
 * Recursively walk `root` and return absolute paths of all audio files.
 * Uses readdir with Dirents (no per-file stat), skips dotfiles/dotdirs, and bounds
 * directory-descent concurrency to avoid EMFILE on huge trees.
 */
export function scanAudioFiles(root: string, onProgress?: (found: number) => void): Promise<string[]> {
  const files: string[] = []
  const CONCURRENCY = 12
  const dirQueue: string[] = [root]
  let activeDirs = 0

  return new Promise<string[]>((resolve) => {
    let settled = false

    const isAudio = (name: string): boolean => AUDIO_EXT.has(extname(name).toLowerCase())

    const readDir = async (dir: string): Promise<void> => {
      try {
        const dirents = await fs.readdir(dir, { withFileTypes: true })
        for (const d of dirents) {
          if (d.name.startsWith('.')) continue // .DS_Store, ._*, .Spotlight-V100, etc.
          const full = join(dir, d.name)
          if (d.isDirectory()) {
            dirQueue.push(full)
          } else if (d.isFile()) {
            if (isAudio(d.name)) {
              files.push(full)
              if (onProgress && files.length % 25 === 0) onProgress(files.length)
            }
          } else if (d.isSymbolicLink()) {
            try {
              const st = await fs.stat(full)
              if (st.isDirectory()) dirQueue.push(full)
              else if (st.isFile() && isAudio(d.name)) files.push(full)
            } catch {
              /* broken link — skip */
            }
          }
        }
      } catch {
        // Unreadable directory (permissions) — skip.
      } finally {
        activeDirs--
        pump()
      }
    }

    const pump = (): void => {
      if (settled) return
      while (activeDirs < CONCURRENCY && dirQueue.length > 0) {
        const dir = dirQueue.shift() as string
        activeDirs++
        void readDir(dir)
      }
      if (activeDirs === 0 && dirQueue.length === 0) {
        settled = true
        onProgress?.(files.length)
        resolve(files)
      }
    }

    pump()
  })
}
