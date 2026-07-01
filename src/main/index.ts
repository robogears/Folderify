import { app, BrowserWindow, session, Tray, Menu, nativeImage, screen, ipcMain } from 'electron'
import { join } from 'node:path'
import { TRAY_ICON_1X, TRAY_ICON_2X } from './tray-icon'
import { registerSchemes, registerProtocolHandlers } from './protocols'
import { registerIpc } from './ipc'
import { registerUpdater } from './updater'
import { MetaCache } from './cache'
import { Library } from './library/model'
import { LibraryWatcher } from './library/watcher'
import { ensureThumbsDir } from './thumbnails'
import { loadRoot } from './library/root-store'
import type { FsDelta, ScanProgress } from '../shared/models'

const RENDERER_DIST = join(__dirname, '../renderer')
const DEV_URL = process.env['ELECTRON_RENDERER_URL']

const cache = new MetaCache()
const library = new Library(cache)
let watcher: LibraryWatcher
let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null

let scanning = false
let queuedRoot: string | null = null

function send<C extends string, T>(channel: C, payload: T): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

// Custom schemes must be registered before the app is ready.
registerSchemes()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0b0b0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // Never open external content in-app.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL)
  } else {
    void mainWindow.loadURL('app://localhost/index.html')
  }
}

function showMain(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createMiniWindow(): void {
  miniWindow = new BrowserWindow({
    width: 340,
    height: 234,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  miniWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  const miniUrl = DEV_URL ? `${DEV_URL}#mini` : 'app://localhost/index.html#mini'
  void miniWindow.loadURL(miniUrl)
  miniWindow.on('blur', () => miniWindow?.hide())
  miniWindow.on('closed', () => {
    miniWindow = null
  })
}

function positionMini(bounds: Electron.Rectangle): void {
  if (!miniWindow) return
  const { width } = miniWindow.getBounds()
  const x = Math.round(bounds.x + bounds.width / 2 - width / 2)
  const y = Math.round(bounds.y + bounds.height + 4)
  const wa = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea
  const clampedX = Math.max(wa.x + 6, Math.min(x, wa.x + wa.width - width - 6))
  miniWindow.setPosition(clampedX, Math.max(wa.y + 4, y), false)
}

function toggleMini(bounds: Electron.Rectangle): void {
  if (!miniWindow || miniWindow.isDestroyed()) createMiniWindow()
  if (!miniWindow) return
  if (miniWindow.isVisible()) {
    miniWindow.hide()
    return
  }
  positionMini(bounds)
  miniWindow.show()
  miniWindow.focus()
}

function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_1X)
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_2X })
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Folderify')
  tray.on('click', (_e, bounds) => toggleMini(bounds))
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      { label: 'Open Folderify', click: () => showMain() },
      { type: 'separator' },
      { label: 'Quit Folderify', click: () => app.quit() }
    ])
    tray?.popUpContextMenu(menu)
  })
}

async function runRebuild(root: string): Promise<void> {
  scanning = true
  try {
    await watcher.stop()
    await library.build(root, (scanned, total, phase) => {
      const progress: ScanProgress = { scanned, total, done: phase === 'done', phase }
      send('library:scan-progress', progress)
    })
    await watcher.start(root)
    send('library:loaded', library.toModel())
  } catch (err) {
    console.error('[folderify] rebuild failed:', err)
    send('library:loaded', library.toModel())
  } finally {
    scanning = false
    if (queuedRoot) {
      const next = queuedRoot
      queuedRoot = null
      if (next !== root) void runRebuild(next)
    }
  }
}

function startRebuild(root: string): void {
  if (scanning) {
    queuedRoot = root
    return
  }
  void runRebuild(root)
}

app.whenReady().then(async () => {
  // Strict CSP in production. In dev we defer to the Vite dev server (HMR needs
  // inline/eval and a websocket connection that a strict policy would block).
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    if (DEV_URL) {
      cb({ responseHeaders: details.responseHeaders })
      return
    }
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' app:; " +
            "script-src 'self' app:; " +
            "style-src 'self' app: 'unsafe-inline'; " +
            "font-src 'self' app: data:; " +
            "img-src 'self' app: cover: data:; " +
            "media-src 'self' media:; " +
            "connect-src 'self' app: cover: media:; " +
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
        ]
      }
    })
  })

  await ensureThumbsDir()
  await cache.load()

  watcher = new LibraryWatcher(library, (delta: FsDelta) => send('library:changed', delta))

  registerProtocolHandlers({ getRoot: () => library.getRoot(), rendererDist: RENDERER_DIST })
  registerIpc({
    library,
    watcher,
    getWindow: () => mainWindow,
    isScanning: () => scanning,
    rebuild: startRebuild
  })
  const runUpdateCheck = registerUpdater(() => mainWindow)

  createWindow()
  createMiniWindow()
  createTray()

  // Relay player state (main window → popover) and commands (popover → main window).
  ipcMain.on('player:state', (_e, snapshot) => {
    if (miniWindow && !miniWindow.isDestroyed()) miniWindow.webContents.send('player:state', snapshot)
  })
  ipcMain.on('player:command', (_e, cmd) => {
    if (cmd && cmd.type === 'showApp') {
      miniWindow?.hide()
      showMain()
      return
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('player:command', cmd)
  })

  // Silent update check shortly after launch (renderer listener is attached by then).
  setTimeout(() => void runUpdateCheck(), 2500)

  // Restore the previously chosen library in the background.
  // FOLDERIFY_DEFAULT_ROOT is a dev convenience for launching into a known folder
  // (not persisted — the real source of truth is the saved config).
  const savedRoot = (await loadRoot()) ?? process.env.FOLDERIFY_DEFAULT_ROOT ?? null
  if (savedRoot) startRebuild(savedRoot)

  app.on('activate', () => showMain())
}).catch((err) => console.error('[folderify] startup failed:', err))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void cache.flush()
  void watcher?.stop()
})
