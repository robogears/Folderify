// The typed IPC contract. `invoke` channels are request/response (renderer -> main).
// `event` channels are push (main -> renderer). The preload exposes a `window.api`
// surface that mirrors this; the renderer never touches ipcRenderer directly.

import type { LibraryModel, FsDelta, ScanProgress } from './models'

export interface ChooseFolderResult {
  root: string | null
}

/** Request/response channels (ipcMain.handle / ipcRenderer.invoke). */
export interface IpcInvokeMap {
  'library:choose-folder': { req: void; res: ChooseFolderResult }
  'library:get': { req: void; res: LibraryModel }
  'library:rescan': { req: void; res: { ok: boolean } }
  'library:forget': { req: void; res: { ok: boolean } }
  'track:reveal': { req: string; res: void }
}

export type IpcInvokeChannel = keyof IpcInvokeMap

/** Push channels (webContents.send / ipcRenderer.on). */
export interface IpcEventMap {
  /** Full model pushed after a (re)build completes. */
  'library:loaded': LibraryModel
  /** Incremental delta after a watch batch settles. */
  'library:changed': FsDelta
  'library:scan-progress': ScanProgress
}

export type IpcEventChannel = keyof IpcEventMap

export const PROTOCOL = {
  /** Streams seekable audio bytes for a track path. */
  MEDIA: 'media',
  /** Serves a cover-art thumbnail for a track id (or "placeholder"). */
  COVER: 'cover',
  /** Serves the built renderer in production. */
  APP: 'app'
} as const

/** Build a media:// URL for an absolute audio path. */
export function mediaUrl(absPath: string): string {
  return `${PROTOCOL.MEDIA}://localhost/${encodeURIComponent(absPath)}`
}

/** Build a cover:// URL for a track id (use "placeholder" for the fallback). */
export function coverUrl(trackId: string | 'placeholder', size: 'sm' | 'lg' = 'sm'): string {
  return `${PROTOCOL.COVER}://localhost/${encodeURIComponent(trackId)}?s=${size}`
}
