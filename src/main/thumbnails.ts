import { app, nativeImage } from 'electron'
import { join } from 'node:path'
import { promises as fs } from 'node:fs'

export type ThumbSize = 'sm' | 'lg'
const DIMS: Record<ThumbSize, number> = { sm: 256, lg: 512 }

function thumbsDir(): string {
  return join(app.getPath('userData'), 'thumbs')
}

export function thumbPath(trackId: string, size: ThumbSize): string {
  return join(thumbsDir(), `${trackId}_${size}.jpg`)
}

export async function ensureThumbsDir(): Promise<void> {
  await fs.mkdir(thumbsDir(), { recursive: true })
}

/**
 * Resize raw cover-art bytes to a square-ish JPEG thumbnail on disk, using
 * Electron's built-in nativeImage (no native module / rebuild required).
 * Resizes by width to preserve aspect ratio; the UI crops to a square with
 * object-fit: cover. Returns true if a thumbnail was written.
 */
export async function writeThumbnail(trackId: string, data: Uint8Array, size: ThumbSize): Promise<boolean> {
  try {
    const img = nativeImage.createFromBuffer(Buffer.from(data))
    if (img.isEmpty()) return false
    const resized = img.resize({ width: DIMS[size], quality: 'good' })
    const jpeg = resized.toJPEG(82)
    if (!jpeg || jpeg.length === 0) return false
    await fs.writeFile(thumbPath(trackId, size), jpeg)
    return true
  } catch {
    return false
  }
}

export async function writeBothThumbnails(trackId: string, data: Uint8Array): Promise<boolean> {
  const sm = await writeThumbnail(trackId, data, 'sm')
  // Large is best-effort; the small thumb is what most of the UI uses.
  await writeThumbnail(trackId, data, 'lg')
  return sm
}

export async function thumbExists(trackId: string, size: ThumbSize): Promise<boolean> {
  try {
    await fs.access(thumbPath(trackId, size))
    return true
  } catch {
    return false
  }
}

export async function deleteThumbnails(trackId: string): Promise<void> {
  await Promise.allSettled([
    fs.rm(thumbPath(trackId, 'sm'), { force: true }),
    fs.rm(thumbPath(trackId, 'lg'), { force: true })
  ])
}
