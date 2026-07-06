import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { FolderifyApi, Unsubscribe } from '../shared/api'
import type {
  LibraryModel,
  FsDelta,
  ScanProgress,
  PlayerSnapshot,
  PlayerCommand,
  UpdateAvailable,
  UpdateProgress
} from '../shared/models'
import type { ListenPeer, ListenConnected, ListenErrorPayload, SignalPayload } from '../shared/listen'

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
  onPlayerState: (cb: (s: PlayerSnapshot) => void) => subscribe('player:state', cb),

  getAppVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  getPendingUpdate: () => ipcRenderer.invoke('update:get-pending'),
  canSelfInstall: () => ipcRenderer.invoke('update:can-self-install'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  applyUpdate: () => ipcRenderer.invoke('update:apply'),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  onUpdateAvailable: (cb: (u: UpdateAvailable) => void) => subscribe('update:available', cb),
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => subscribe('update:download-progress', cb),

  setExclusiveMediaKeys: (on: boolean) => ipcRenderer.invoke('mediakeys:set-exclusive', on),

  listen: {
    start: () => ipcRenderer.invoke('listen:start'),
    stop: () => ipcRenderer.invoke('listen:stop'),
    connect: (peerId: string, pin: string) => ipcRenderer.invoke('listen:connect', { peerId, pin }),
    connectManual: (host: string, pin: string) =>
      ipcRenderer.invoke('listen:connect-manual', { host, pin }),
    disconnect: () => ipcRenderer.invoke('listen:disconnect'),
    sendSignal: (payload: SignalPayload) => ipcRenderer.send('listen:signal', payload),
    onPeers: (cb: (peers: ListenPeer[]) => void) => subscribe('listen:peers', cb),
    onConnected: (cb: (c: ListenConnected) => void) => subscribe('listen:connected', cb),
    onSignal: (cb: (p: SignalPayload) => void) => subscribe('listen:signal', cb),
    onError: (cb: (e: ListenErrorPayload) => void) => subscribe('listen:error', cb),
    onDisconnected: (cb: () => void) => subscribe('listen:disconnected', () => cb())
  }
}

// Only the whitelisted `api` surface crosses the bridge — never raw ipcRenderer.
contextBridge.exposeInMainWorld('api', api)
