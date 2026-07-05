import type {
  LibraryModel,
  FsDelta,
  ScanProgress,
  PlayerSnapshot,
  PlayerCommand,
  UpdateAvailable,
  UpdateCheck,
  UpdateProgress
} from './models'
import type { ListenPeer, ListenConnected, ListenErrorPayload, SignalPayload } from './listen'

export type Unsubscribe = () => void

/** Listen Together — LAN discovery + WebRTC signaling relay (see shared/listen.ts). */
export interface FolderifyListenApi {
  /** Start advertising + discovery + signaling; resolves with our identity, LAN IPs, sig port. */
  start(): Promise<{ id: string; name: string; pin: string; addresses: string[]; sigPort: number }>
  /** Stop advertising/discovery and tear down any connection. */
  stop(): Promise<{ ok: boolean }>
  /** Reach out to a discovered peer, presenting their PIN. */
  connect(peerId: string, pin: string): Promise<{ ok: boolean; error?: string }>
  /** Reach out to a peer by typed IP (fixed sig port) when discovery didn't surface it. */
  connectManual(host: string, pin: string): Promise<{ ok: boolean; error?: string }>
  /** Drop the current connection (keeps advertising). */
  disconnect(): Promise<{ ok: boolean }>
  /** Send a WebRTC SDP/ICE payload to the connected peer (relayed by main). */
  sendSignal(payload: SignalPayload): void
  onPeers(cb: (peers: ListenPeer[]) => void): Unsubscribe
  onConnected(cb: (c: ListenConnected) => void): Unsubscribe
  onSignal(cb: (payload: SignalPayload) => void): Unsubscribe
  onError(cb: (e: ListenErrorPayload) => void): Unsubscribe
  onDisconnected(cb: () => void): Unsubscribe
}

/** The minimal, typed surface exposed to the renderer as `window.api`. */
export interface FolderifyApi {
  /** Open the native folder picker; resolves with the chosen root (or null). */
  chooseFolder(): Promise<{ root: string | null }>
  /** Fetch the current library model (may be mid-scan). */
  getLibrary(): Promise<LibraryModel>
  /** Force a fresh rescan of the current root. */
  rescan(): Promise<{ ok: boolean }>
  /** Disconnect the current folder and clear the library. */
  forget(): Promise<{ ok: boolean }>
  /** Reveal a track in Finder. */
  revealTrack(path: string): Promise<void>

  /** Full model pushed after a (re)build completes. Returns an unsubscribe fn. */
  onLoaded(cb: (model: LibraryModel) => void): Unsubscribe
  /** Incremental filesystem deltas. Returns an unsubscribe fn. */
  onChanged(cb: (delta: FsDelta) => void): Unsubscribe
  /** Scan/parse progress. Returns an unsubscribe fn. */
  onScanProgress(cb: (progress: ScanProgress) => void): Unsubscribe

  // --- Menu-bar mini-player bridge (relayed window↔window via main) ---
  /** Main window → publish current player state to the menu-bar popover. */
  publishPlayerState(snapshot: PlayerSnapshot): void
  /** Main window → listen for control commands from the popover. */
  onPlayerCommand(cb: (cmd: PlayerCommand) => void): Unsubscribe
  /** Popover → send a control command to the main window. */
  sendPlayerCommand(cmd: PlayerCommand): void
  /** Popover → listen for player-state updates. */
  onPlayerState(cb: (snapshot: PlayerSnapshot) => void): Unsubscribe

  // --- Updates ---
  getAppVersion(): Promise<string>
  checkForUpdates(): Promise<UpdateCheck>
  /** Replay the last "available" result main discovered (launch-race safe). */
  getPendingUpdate(): Promise<UpdateCheck | null>
  canSelfInstall(): Promise<boolean>
  /** NO url — main downloads its own last-checked asset + sidecar pair. */
  downloadUpdate(): Promise<{ ok: boolean; error?: string }>
  applyUpdate(): Promise<{ ok: boolean; code?: 'stage-missing' | 'busy'; error?: string }>
  openExternal(url: string): Promise<void>
  onUpdateAvailable(cb: (u: UpdateAvailable) => void): Unsubscribe
  onUpdateProgress(cb: (p: UpdateProgress) => void): Unsubscribe

  // --- Listen Together (LAN peer-to-peer playback) ---
  listen: FolderifyListenApi
}
