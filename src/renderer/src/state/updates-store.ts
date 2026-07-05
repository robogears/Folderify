import { create } from 'zustand'
import type { UpdateAvailable, UpdateCheck } from '@shared/models'

export type DownloadState = 'idle' | 'downloading' | 'ready' | 'restarting' | 'failed'
export type CheckState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'no-releases'
  | 'available'
  | 'rate-limited'
  | 'offline'
  | 'error'

interface UpdatesState {
  appVersion: string
  canSelfInstall: boolean
  available: UpdateAvailable | null
  downloadState: DownloadState
  progressPct: number
  indeterminate: boolean // true while downloading with no known content-length
  checkState: CheckState
  retryAfterSeconds: number // live countdown while rate-limited
  init: () => void
  check: (opts?: { silent?: boolean }) => Promise<void>
  startDownload: () => Promise<void>
  apply: () => Promise<void>
  openRelease: () => void
}

let initialized = false
let onlineArmed = false

export const useUpdates = create<UpdatesState>((set, get) => {
  let rateLimitTimer: ReturnType<typeof setInterval> | null = null

  // Manual-check feedback flashes briefly, then returns to idle. Never override
  // an 'available' that landed in the meantime.
  const flashThenIdle = (state: CheckState, ms = 4000): void => {
    set({ checkState: state })
    setTimeout(() => {
      if (get().checkState === state) set({ checkState: 'idle' })
    }, ms)
  }

  // Rate-limited: live countdown; the button stays disabled until it hits zero.
  const startRetryCountdown = (seconds: number): void => {
    if (rateLimitTimer) clearInterval(rateLimitTimer)
    set({ checkState: 'rate-limited', retryAfterSeconds: seconds })
    rateLimitTimer = setInterval(() => {
      const s = get().retryAfterSeconds - 1
      if (s <= 0) {
        if (rateLimitTimer) clearInterval(rateLimitTimer)
        rateLimitTimer = null
        set({ checkState: 'idle', retryAfterSeconds: 0 })
      } else {
        set({ retryAfterSeconds: s })
      }
    }, 1000)
  }

  // Offline: arm ONE 'online' listener that silently re-checks when connectivity
  // returns. Once, not per-failure — repeated offline checks must not stack listeners.
  const armOnlineRecheck = (): void => {
    if (onlineArmed) return
    onlineArmed = true
    window.addEventListener(
      'online',
      () => {
        onlineArmed = false
        if (get().checkState === 'offline') set({ checkState: 'idle' })
        void get().check({ silent: true })
      },
      { once: true }
    )
  }

  const applyResult = (r: UpdateCheck, silent: boolean): void => {
    if (r.status === 'available') {
      set({ available: r, checkState: 'available' })
      return
    }
    if (r.status === 'offline') armOnlineRecheck()
    if (silent) return
    switch (r.status) {
      case 'up-to-date':
        flashThenIdle('up-to-date')
        break
      case 'no-releases':
        flashThenIdle('no-releases')
        break
      case 'offline':
        set({ checkState: 'offline' })
        break
      case 'rate-limited':
        startRetryCountdown(r.retryAfterSeconds ?? 60)
        break
      case 'error':
        flashThenIdle('error')
        break
    }
  }

  return {
    appVersion: '',
    canSelfInstall: false,
    available: null,
    downloadState: 'idle',
    progressPct: 0,
    indeterminate: false,
    checkState: 'idle',
    retryAfterSeconds: 0,

    init: () => {
      if (initialized) return
      initialized = true
      // 1. Subscriptions FIRST.
      window.api.onUpdateAvailable((u) => {
        if (get().available?.version === u.version) return // de-dupe repeat notices
        set({ available: u, checkState: 'available' })
      })
      window.api.onUpdateProgress(({ downloaded, total }) => {
        if (get().downloadState !== 'downloading') return
        if (total > 0) {
          set({ indeterminate: false, progressPct: Math.floor((downloaded / total) * 100) })
        } else {
          set({ indeterminate: true })
        }
      })
      // 2. Environment facts (failures are non-fatal; defaults already safe).
      void window.api
        .getAppVersion()
        .then((v) => set({ appVersion: v }))
        .catch(() => {})
      void window.api
        .canSelfInstall()
        .then((c) => set({ canSelfInstall: c }))
        .catch(() => {})
      // 3. THE first check — silent: nothing surfaced unless available.
      void get().check({ silent: true })
      // 4. Replay anything main discovered before our listeners existed.
      void window.api
        .getPendingUpdate()
        .then((r) => {
          if (r && r.status === 'available' && !get().available) {
            set({ available: r, checkState: 'available' })
          }
        })
        .catch(() => {})
    },

    check: async (opts = {}) => {
      const silent = opts.silent === true
      if (!silent) set({ checkState: 'checking' })
      try {
        applyResult(await window.api.checkForUpdates(), silent)
      } catch {
        // 'checking' must NEVER be a terminal state.
        if (silent) return
        flashThenIdle('error')
      }
    },

    startDownload: async () => {
      const a = get().available
      if (!a) return
      // Open the release page instead of self-installing when EITHER this build
      // can't self-install OR there's no arch-matched asset (no downloadUrl).
      if (!get().canSelfInstall || !a.downloadUrl) {
        void window.api.openExternal(a.releaseUrl).catch(() => {})
        return
      }
      set({ downloadState: 'downloading', progressPct: 0, indeterminate: false })
      try {
        const r = await window.api.downloadUpdate()
        set({ downloadState: r.ok ? 'ready' : 'failed', indeterminate: false })
      } catch {
        set({ downloadState: 'failed', indeterminate: false })
      }
    },

    apply: async () => {
      set({ downloadState: 'restarting' })
      try {
        const r = await window.api.applyUpdate()
        if (r.ok) return // the app is quitting; nothing more to do
        if (r.code === 'stage-missing') {
          set({ downloadState: 'idle' })
        } else if (r.code !== 'busy') {
          set({ downloadState: 'ready' }) // unknown failure: let the user retry
        }
      } catch {
        set({ downloadState: 'ready' })
      }
    },

    openRelease: () => {
      const a = get().available
      if (a) void window.api.openExternal(a.releaseUrl).catch(() => {})
    }
  }
})
