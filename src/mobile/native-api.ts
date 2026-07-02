// PHASE 1 — real window.api backed by the native Swift `FolderifyLibrary` plugin.
// Mirrors the desktop IPC surface (src/shared/api.ts) so the shared React stores
// and components work unchanged. Media/cover bytes are served natively through the
// media:// and cover:// WKURLSchemeHandlers registered on the Capacitor WebView, so
// mediaUrl()/coverUrl() from @shared/ipc resolve exactly as they do on desktop.
import { registerPlugin } from '@capacitor/core'
import type { FolderifyApi } from '@shared/api'
import type { LibraryModel, ScanProgress } from '@shared/models'

/** The native plugin surface (implemented in ios/App/App/FolderifyLibraryPlugin.swift). */
interface FolderifyLibraryPlugin {
  /** Present the folder picker; resolves the chosen root (or nulls if cancelled). */
  pickFolder(): Promise<{ root: string | null; rootName: string | null }>
  /** Resolve the saved folder and return the freshly-scanned library model. */
  getLibrary(): Promise<LibraryModel>
  /** Forget the saved folder and release its security-scoped access. */
  forget(): Promise<void>
  addListener(
    eventName: 'scanProgress',
    listener: (p: ScanProgress) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const Plugin = registerPlugin<FolderifyLibraryPlugin>('FolderifyLibrary')

const EMPTY: LibraryModel = {
  root: null,
  rootName: null,
  playlists: [],
  tracks: [],
  scanning: false
}

export function installNativeApi(): void {
  const loadedSubs = new Set<(m: LibraryModel) => void>()
  const progressSubs = new Set<(p: ScanProgress) => void>()

  // Forward native scan-progress events (emitted by the plugin during a walk).
  void Plugin.addListener('scanProgress', (p) => {
    for (const cb of progressSubs) cb(p)
  })

  const emitLoaded = (m: LibraryModel): void => {
    for (const cb of loadedSubs) cb(m)
  }
  const emitProgress = (p: ScanProgress): void => {
    for (const cb of progressSubs) cb(p)
  }

  const api: FolderifyApi = {
    chooseFolder: async () => {
      const { root } = await Plugin.pickFolder()
      if (root) {
        emitProgress({ scanned: 0, total: 0, done: false, phase: 'walking' })
        const model = await Plugin.getLibrary()
        emitLoaded(model)
      }
      return { root }
    },
    getLibrary: async () => {
      try {
        return await Plugin.getLibrary()
      } catch {
        // No saved folder yet (or resolution failed) — start empty.
        return EMPTY
      }
    },
    rescan: async () => {
      const model = await Plugin.getLibrary()
      emitLoaded(model)
      return { ok: true }
    },
    forget: async () => {
      await Plugin.forget()
      emitLoaded(EMPTY)
      return { ok: true }
    },
    // Reveal-in-Finder has no iOS analogue.
    revealTrack: async () => {},

    onLoaded: (cb) => {
      loadedSubs.add(cb)
      return () => {
        loadedSubs.delete(cb)
      }
    },
    // No live filesystem watcher on iOS yet — refresh is pull-based (rescan).
    onChanged: () => () => {},
    onScanProgress: (cb) => {
      progressSubs.add(cb)
      return () => {
        progressSubs.delete(cb)
      }
    },

    // Menu-bar mini-player bridge is desktop-only.
    publishPlayerState: () => {},
    onPlayerCommand: () => () => {},
    sendPlayerCommand: () => {},
    onPlayerState: () => () => {},

    // Updates are handled by the App Store on iOS — no in-app updater.
    getAppVersion: async () => '0.1.5-ios',
    checkForUpdates: async () => ({ status: 'up-to-date', version: '0.1.5-ios' }),
    canSelfInstall: async () => false,
    downloadUpdate: async () => ({ ok: false }),
    applyUpdate: async () => {},
    openExternal: async (url) => {
      window.open(url, '_blank')
    },
    onUpdateAvailable: () => () => {},
    onUpdateProgress: () => () => {}
  }

  ;(window as unknown as { api: FolderifyApi }).api = api
}
