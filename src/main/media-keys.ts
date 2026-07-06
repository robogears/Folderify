// Exclusive media keys (opt-in, default OFF). When enabled, Folderify registers the
// hardware media keys (F7/F8/F9 → prev / play-pause / next) as GLOBAL shortcuts, which
// intercepts them before macOS's cooperative Now Playing routing — so no other app
// (Spotify, a browser tab) can take them while the toggle is on. When disabled (the
// default), the keys keep flowing through the normal MediaSession/Now Playing path,
// which routes to whichever app played most recently.
//
// macOS gotcha: since 10.14, capturing media keys via an event tap requires the app to
// be a *trusted accessibility client* (System Settings → Privacy & Security →
// Accessibility). We check first and surface a typed reason so the renderer can walk
// the user through granting it — silently failing to grab the keys would read as "the
// toggle does nothing." In dev the grant applies to Electron.app, not Folderify.

import { globalShortcut, ipcMain, systemPreferences, type BrowserWindow } from 'electron'
import type { PlayerCommand } from '../shared/models'

const KEYS: { accelerator: string; command: PlayerCommand }[] = [
  { accelerator: 'MediaPreviousTrack', command: { type: 'prev' } }, // F7
  { accelerator: 'MediaPlayPause', command: { type: 'toggle' } }, //   F8
  { accelerator: 'MediaNextTrack', command: { type: 'next' } } //      F9
]

let active = false

type SetResult = { ok: boolean; reason?: 'accessibility' | 'taken' }

export function registerMediaKeys(getWindow: () => BrowserWindow | null): () => void {
  const send = (command: PlayerCommand): void => {
    const w = getWindow()
    // Reuses the existing player:command channel — the main window's tray-bridge
    // already applies toggle/next/prev, so no new renderer wiring is needed.
    if (w && !w.isDestroyed()) w.webContents.send('player:command', command)
  }

  const disable = (): void => {
    if (!active) return
    for (const k of KEYS) {
      try {
        globalShortcut.unregister(k.accelerator)
      } catch {
        /* ignore */
      }
    }
    active = false
  }

  const enable = (): SetResult => {
    if (active) return { ok: true }
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      // Fire the system prompt (adds Folderify to the Accessibility list, unchecked)
      // and tell the renderer why we couldn't grab the keys yet.
      systemPreferences.isTrustedAccessibilityClient(true)
      return { ok: false, reason: 'accessibility' }
    }
    const registered: string[] = []
    for (const k of KEYS) {
      let ok = false
      try {
        ok = globalShortcut.register(k.accelerator, () => send(k.command))
      } catch {
        ok = false
      }
      if (!ok) {
        // Partial grabs are worse than none (F8 works, F7 doesn't) — roll back.
        for (const acc of registered) globalShortcut.unregister(acc)
        return { ok: false, reason: 'taken' }
      }
      registered.push(k.accelerator)
    }
    active = true
    return { ok: true }
  }

  ipcMain.handle('mediakeys:set-exclusive', (_e, on: unknown): SetResult => {
    if (on === true) return enable()
    disable()
    return { ok: true }
  })

  return disable
}
