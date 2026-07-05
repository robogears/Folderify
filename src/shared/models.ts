// Core data models shared between the main process (which builds them from the
// filesystem) and the renderer (which displays them). Pure types + the IPC map.

/** Reserved playlist id for audio files that sit directly in the library root. */
export const LOOSE_PLAYLIST_ID = '__root__'
export const LOOSE_PLAYLIST_NAME = 'Loose Tracks'

export interface Track {
  /** Stable id derived from the absolute path. */
  id: string
  /** Absolute on-disk path (the source of truth, exact case). */
  path: string
  /** Last-modified time in ms, used for cache invalidation. */
  mtimeMs: number
  /** File size in bytes, used (with mtime) for cache invalidation. */
  size: number

  title: string
  artist: string
  album: string
  albumArtist: string
  year: number | null
  trackNo: number | null
  trackOf: number | null
  discNo: number | null
  genre: string
  /** Duration in seconds (float). May be null if unreadable. */
  durationSec: number | null

  /** True if the file carries embedded (or sidecar) cover art. */
  hasArt: boolean
  /** The detected codec, e.g. "MPEG 1 Layer 3", "ALAC", "FLAC". */
  codec: string
  /** True if Chromium cannot decode this codec (e.g. ALAC, AIFF). */
  unsupported: boolean

  /** Id of the playlist (first path segment under root) this track belongs to. */
  playlistId: string
}

export interface Playlist {
  /** Folder name, or LOOSE_PLAYLIST_ID for root-level files. */
  id: string
  /** Display name. */
  name: string
  /** Absolute path to the folder (root path for the loose playlist). */
  path: string
  /** Track ids contained (recursively) within this folder. */
  trackIds: string[]
  /** A track id whose art represents the playlist (first one with art). */
  coverTrackId: string | null
}

export interface LibraryModel {
  root: string | null
  rootName: string | null
  playlists: Playlist[]
  tracks: Track[]
  /** True while an initial scan/parse is in progress (transient). */
  scanning?: boolean
}

export interface FsDelta {
  added: Track[]
  updated: Track[]
  removedIds: string[]
  /** The full, recomputed playlist list (cheap; avoids client-side diffing). */
  playlists: Playlist[]
}

export interface ScanProgress {
  scanned: number
  total: number
  done: boolean
  phase: 'walking' | 'parsing' | 'done' | 'error'
}

/** A compact snapshot of player state for the menu-bar mini player. */
export interface PlayerSnapshot {
  trackId: string | null
  title: string
  artist: string
  hasArt: boolean
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: 'off' | 'all' | 'one'
  hasTrack: boolean
}

/**
 * Result of an update check — the single source of truth for the updater UI.
 * `available` with NO `downloadUrl` (`reason: 'no-asset-for-arch'`) means the UI
 * must route to `releaseUrl` — never self-install a wrong-arch build.
 */
export type UpdateCheck =
  | {
      status: 'available'
      version: string
      /** Release body markdown — the "What's new" content, already fetched. */
      notes?: string
      /** ISO 8601 from the release JSON. */
      publishedAt?: string
      /** ABSENT when no arch-matched asset exists — route to releaseUrl. */
      downloadUrl?: string
      /** Companion sidecar; verified in main, opaque to the UI. */
      sha256Url?: string
      releaseUrl: string
      reason?: 'no-asset-for-arch'
    }
  | { status: 'up-to-date'; version: string }
  | { status: 'no-releases' }
  | { status: 'rate-limited'; retryAfterSeconds?: number }
  | { status: 'offline' }
  | { status: 'error'; message: string }

/** The `update:available` push payload is exactly the available variant. */
export type UpdateAvailable = Extract<UpdateCheck, { status: 'available' }>

export interface UpdateProgress {
  downloaded: number
  /** 0 => length unknown; render an INDETERMINATE bar, not a frozen "0%". */
  total: number
}

/** A control command sent from the menu-bar mini player to the main window. */
export type PlayerCommand =
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'seek'; value: number }
  | { type: 'setVolume'; value: number }
  | { type: 'toggleMute' }
  | { type: 'toggleShuffle' }
  | { type: 'cycleRepeat' }
  | { type: 'showApp' }
