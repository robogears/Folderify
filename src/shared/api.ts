import type { LibraryModel, FsDelta, ScanProgress, PlayerSnapshot, PlayerCommand } from './models'

export type Unsubscribe = () => void

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
}
