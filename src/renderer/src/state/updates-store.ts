import { create } from 'zustand'
import type { UpdateAvailable } from '@shared/models'

export type DownloadState = 'idle' | 'downloading' | 'ready' | 'restarting' | 'failed'
export type CheckState = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'

interface UpdatesState {
  appVersion: string
  canSelfInstall: boolean
  available: UpdateAvailable | null
  downloadState: DownloadState
  progressPct: number
  checkState: CheckState

  init: () => void
  check: () => Promise<void>
  startDownload: () => Promise<void>
  apply: () => void
  openRelease: () => void
}

let initialized = false

export const useUpdates = create<UpdatesState>((set, get) => ({
  appVersion: '',
  canSelfInstall: false,
  available: null,
  downloadState: 'idle',
  progressPct: 0,
  checkState: 'idle',

  init: () => {
    if (initialized) return
    initialized = true
    window.api.onUpdateAvailable((u) => {
      // De-dupe: ignore a repeat notice for the same version.
      if (get().available?.version === u.version) return
      set({ available: u, checkState: 'available' })
    })
    window.api.onUpdateProgress(({ downloaded, total }) => {
      if (get().downloadState !== 'downloading') return
      set({ progressPct: total > 0 ? Math.floor((downloaded / total) * 100) : 0 })
    })
    void window.api.getAppVersion().then((v) => set({ appVersion: v }))
    void window.api.canSelfInstall().then((c) => set({ canSelfInstall: c }))
  },

  check: async () => {
    set({ checkState: 'checking' })
    const r = await window.api.checkForUpdates()
    if (r.status === 'available') {
      set({
        checkState: 'available',
        available: { version: r.version, downloadUrl: r.downloadUrl, releaseUrl: r.releaseUrl }
      })
    } else {
      set({ checkState: r.status === 'up-to-date' ? 'up-to-date' : 'error' })
      setTimeout(() => {
        if (get().checkState !== 'available') set({ checkState: 'idle' })
      }, 3000)
    }
  },

  startDownload: async () => {
    const a = get().available
    if (!a) return
    if (!get().canSelfInstall) {
      void window.api.openExternal(a.releaseUrl)
      return
    }
    set({ downloadState: 'downloading', progressPct: 0 })
    const r = await window.api.downloadUpdate(a.downloadUrl)
    set({ downloadState: r.ok ? 'ready' : 'failed' })
  },

  apply: () => {
    set({ downloadState: 'restarting' })
    void window.api.applyUpdate()
  },

  openRelease: () => {
    const a = get().available
    if (a) void window.api.openExternal(a.releaseUrl)
  }
}))
