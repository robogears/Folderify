import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FolderifyApi, Unsubscribe } from '../shared/api'
import type { LibraryModel, FsDelta, ScanProgress, PlayerSnapshot, PlayerCommand } from '../shared/models'

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: FolderifyApi = {
  chooseFolder: () => ipcRenderer.invoke('library:choose-folder'),
  getLibrary: () => ipcRenderer.invoke('library:get'),
  rescan: () => ipcRenderer.invoke('library:rescan'),
  forget: () => ipcRenderer.invoke('library:forget'),
  revealTrack: (path: string) => ipcRenderer.invoke('track:reveal', path),

  onLoaded: (cb: (m: LibraryModel) => void) => subscribe('library:loaded', cb),
  onChanged: (cb: (d: FsDelta) => void) => subscribe('library:changed', cb),
  onScanProgress: (cb: (p: ScanProgress) => void) => subscribe('library:scan-progress', cb),

  publishPlayerState: (snapshot: PlayerSnapshot) => ipcRenderer.send('player:state', snapshot),
  onPlayerCommand: (cb: (cmd: PlayerCommand) => void) => subscribe('player:command', cb),
  sendPlayerCommand: (cmd: PlayerCommand) => ipcRenderer.send('player:command', cmd),
  onPlayerState: (cb: (s: PlayerSnapshot) => void) => subscribe('player:state', cb)
}

// Only the whitelisted `api` surface crosses the bridge — never raw ipcRenderer.
contextBridge.exposeInMainWorld('api', api)
