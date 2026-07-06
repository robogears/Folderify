import { ipcMain, shell, type BrowserWindow } from 'electron'
import { Library } from './library/model'
import { LibraryWatcher } from './library/watcher'
import { chooseFolder, saveRoot } from './library/root-store'
import { safeResolveUnder } from './path-safety'

export interface IpcContext {
  library: Library
  watcher: LibraryWatcher
  getWindow: () => BrowserWindow | null
  isScanning: () => boolean
  /** Kick off a scan + watch of `root` (fire-and-forget; streams progress). */
  rebuild: (root: string) => void
}

export function registerIpc(ctx: IpcContext): void {
  ipcMain.handle('library:choose-folder', async () => {
    const root = await chooseFolder(ctx.getWindow())
    if (root) {
      await saveRoot(root)
      ctx.rebuild(root)
    }
    return { root }
  })

  ipcMain.handle('library:get', async () => {
    return { ...ctx.library.toModel(), scanning: ctx.isScanning() }
  })

  ipcMain.handle('library:rescan', async () => {
    const root = ctx.library.getRoot()
    if (root) ctx.rebuild(root)
    return { ok: root !== null }
  })

  ipcMain.handle('library:forget', async () => {
    await ctx.watcher.stop()
    ctx.library.reset()
    await saveRoot(null)
    return { ok: true }
  })

  ipcMain.handle('track:reveal', async (_e, path: unknown) => {
    if (typeof path !== 'string' || !path) return
    // Confine to the current library root — never reveal an arbitrary absolute path a
    // (hypothetically compromised) renderer could pass, matching the media:// guard.
    const root = ctx.library.getRoot()
    if (root && safeResolveUnder(root, path)) shell.showItemInFolder(path)
  })
}
