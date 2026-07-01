// PHASE 0 STUB — a fake window.api so the existing React UI renders inside the
// iOS WebView before the native Swift plugin exists. Replaced in Phase 1 by a
// real bridge to the Capacitor plugin. Covers/audio won't resolve yet (no
// custom scheme handlers) — this is purely to prove the UI runs on iPhone.
import type { FolderifyApi } from '@shared/api'
import type { LibraryModel, Track, Playlist } from '@shared/models'

function mk(
  id: string,
  playlistId: string,
  title: string,
  artist: string,
  album: string,
  durationSec: number
): Track {
  return {
    id,
    path: `/stub/${playlistId}/${id}.mp3`,
    mtimeMs: 0,
    size: 0,
    title,
    artist,
    album,
    albumArtist: artist,
    year: 2024,
    trackNo: 1,
    trackOf: null,
    discNo: null,
    genre: '',
    durationSec,
    hasArt: false,
    codec: 'MP3',
    unsupported: false,
    playlistId
  }
}

const tracks: Track[] = [
  mk('t1', 'Chill Vibes', 'Ocean Drive', 'Sunset Collective', 'Waves', 201),
  mk('t2', 'Chill Vibes', 'Slow Morning', 'Sunset Collective', 'Waves', 175),
  mk('t3', 'Focus', 'Deep Work', 'Lo-Fi Lab', 'Concentrate', 244),
  mk('t4', 'Focus', 'Flow State', 'Lo-Fi Lab', 'Concentrate', 198),
  mk('t5', 'Focus', 'Quiet Hours', 'Lo-Fi Lab', 'Concentrate', 212),
  mk('r1', '__root__', 'Welcome Tone', 'Folderify', 'Loose Tracks', 12)
]

const playlists: Playlist[] = [
  { id: 'Chill Vibes', name: 'Chill Vibes', path: '/stub/Chill Vibes', trackIds: ['t1', 't2'], coverTrackId: 't1' },
  { id: 'Focus', name: 'Focus', path: '/stub/Focus', trackIds: ['t3', 't4', 't5'], coverTrackId: 't3' },
  { id: '__root__', name: 'Loose Tracks', path: '/stub', trackIds: ['r1'], coverTrackId: 'r1' }
]

const model: LibraryModel = {
  root: '/stub',
  rootName: 'Stub Library',
  playlists,
  tracks,
  scanning: false
}

const subscribe = (): (() => void) => () => {}

const api: FolderifyApi = {
  chooseFolder: async () => ({ root: '/stub' }),
  getLibrary: async () => model,
  rescan: async () => ({ ok: true }),
  forget: async () => ({ ok: true }),
  revealTrack: async () => {},
  onLoaded: subscribe,
  onChanged: subscribe,
  onScanProgress: subscribe,
  publishPlayerState: () => {},
  onPlayerCommand: subscribe,
  sendPlayerCommand: () => {},
  onPlayerState: subscribe,
  getAppVersion: async () => '0.1.3-ios',
  checkForUpdates: async () => ({ status: 'up-to-date', version: '0.1.3-ios' }),
  canSelfInstall: async () => false,
  downloadUpdate: async () => ({ ok: false }),
  applyUpdate: async () => {},
  openExternal: async () => {},
  onUpdateAvailable: subscribe,
  onUpdateProgress: subscribe
}

;(window as unknown as { api: FolderifyApi }).api = api
