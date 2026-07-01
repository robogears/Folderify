import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import https from 'node:https'
import {
  createWriteStream,
  promises as fs,
  mkdirSync,
  writeFileSync,
  chmodSync,
  appendFileSync,
  readdirSync
} from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { UpdateCheck } from '../shared/models'

const OWNER = 'robogears'
const REPO = 'Folderify'

let pendingUpdatePath: string | null = null

interface GitHubAsset {
  name: string
  browser_download_url: string
}
interface GitHubRelease {
  tag_name: string
  html_url: string
  assets: GitHubAsset[]
}

function fetchLatestRelease(): Promise<GitHubRelease | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.github.com',
        path: `/repos/${OWNER}/${REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `Folderify/${app.getVersion()}`,
          Accept: 'application/vnd.github+json'
        },
        timeout: 10_000
      },
      (res) => {
        let data = ''
        res.on('data', (d) => (data += d))
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null)
          try {
            resolve(JSON.parse(data) as GitHubRelease)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

function isNewerVersion(remote: string, current: string): boolean {
  const r = String(remote)
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const c = String(current)
    .replace(/^v/, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0)
  const len = Math.max(r.length, c.length)
  for (let i = 0; i < len; i++) {
    const a = r[i] || 0
    const b = c[i] || 0
    if (a > b) return true
    if (a < b) return false
  }
  return false
}

async function getUpdateStatus(): Promise<UpdateCheck> {
  const release = await fetchLatestRelease()
  if (!release || !release.tag_name) {
    return { status: 'error', message: 'Could not reach GitHub' }
  }
  if (!isNewerVersion(release.tag_name, app.getVersion())) {
    return { status: 'up-to-date', version: app.getVersion() }
  }
  // Match the .dmg for this Mac's architecture, e.g. "…-arm64.dmg".
  const wanted = `-${process.arch}.dmg`
  let downloadUrl = release.html_url
  const asset = (release.assets || []).find((a) => a.name && a.name.includes(wanted))
  if (asset?.browser_download_url) downloadUrl = asset.browser_download_url
  return {
    status: 'available',
    version: release.tag_name.replace(/^v/, ''),
    downloadUrl,
    releaseUrl: release.html_url
  }
}

function canSelfInstall(): boolean {
  return process.platform === 'darwin' && app.isPackaged
}

function downloadToFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const get = (u: string, redirects = 0): void => {
      const req = https.request(
        u,
        { method: 'GET', headers: { 'User-Agent': `Folderify/${app.getVersion()}` } },
        (res) => {
          if (
            [301, 302, 303, 307, 308].includes(res.statusCode ?? 0) &&
            res.headers.location &&
            redirects < 5
          ) {
            res.resume()
            return get(res.headers.location, redirects + 1)
          }
          if (res.statusCode !== 200) {
            res.resume()
            return reject(new Error(`HTTP ${res.statusCode}`))
          }
          const total = parseInt(String(res.headers['content-length'] ?? '0'), 10) || 0
          let downloaded = 0
          const out = createWriteStream(destPath)
          res.on('data', (chunk) => {
            downloaded += chunk.length
            onProgress(downloaded, total)
          })
          res.pipe(out)
          out.on('finish', () => out.close(() => resolve()))
          out.on('error', reject)
          res.on('error', reject)
        }
      )
      req.on('error', reject)
      req.setTimeout(60_000, () => req.destroy(new Error('Download timed out')))
      req.end()
    }
    get(url)
  })
}

/** Mount a .dmg, copy the .app out with ditto (preserves xattrs), detach. Returns staged .app path. */
function mountAndExtractMacDmg(dmgPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ts = Date.now()
    const mountPoint = path.join(os.tmpdir(), `folderify-mount-${ts}`)
    const stagingDir = path.join(os.tmpdir(), `folderify-staged-${ts}`)
    try {
      mkdirSync(stagingDir, { recursive: true })
    } catch {
      /* ignore */
    }
    const detach = (): void => {
      try {
        spawn('hdiutil', ['detach', '-quiet', mountPoint], { stdio: 'ignore' }).unref()
      } catch {
        /* ignore */
      }
    }
    const attach = spawn(
      'hdiutil',
      ['attach', '-nobrowse', '-quiet', '-mountpoint', mountPoint, dmgPath],
      { stdio: 'ignore' }
    )
    attach.on('error', reject)
    attach.on('close', (code) => {
      if (code !== 0) return reject(new Error(`hdiutil attach exit ${code}`))
      let appName: string | undefined
      try {
        appName = readdirSync(mountPoint).find((n) => n.endsWith('.app'))
      } catch (e) {
        detach()
        return reject(new Error(`read mount: ${(e as Error).message}`))
      }
      if (!appName) {
        detach()
        return reject(new Error('No .app in DMG'))
      }
      const sourceApp = path.join(mountPoint, appName)
      const destApp = path.join(stagingDir, appName)
      const cp = spawn('ditto', [sourceApp, destApp], { stdio: 'ignore' })
      cp.on('error', (err) => {
        detach()
        reject(err)
      })
      cp.on('close', (cpCode) => {
        detach()
        if (cpCode !== 0) return reject(new Error(`ditto exit ${cpCode}`))
        resolve(destApp)
      })
    })
  })
}

/** Write a detached, double-forked relauncher that swaps the .app after we quit. */
function applyUpdate(): void {
  if (!pendingUpdatePath) return
  const newPath = pendingUpdatePath
  const exePath = app.getPath('exe')
  const runningAppBundle = exePath.replace(/\/Contents\/MacOS\/[^/]+$/, '')
  const isTranslocated = runningAppBundle.includes('/AppTranslocation/')
  const targetAppBundle = isTranslocated
    ? path.join('/Applications', path.basename(runningAppBundle))
    : runningAppBundle

  const ts = Date.now()
  const scriptPath = path.join(os.tmpdir(), `folderify-update-${ts}.sh`)
  const logDir = path.join(os.homedir(), 'Library', 'Logs', 'Folderify')
  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    /* ignore */
  }
  const logPath = path.join(logDir, `update-${ts}.log`)
  try {
    appendFileSync(
      path.join(logDir, 'attempts.log'),
      `[${new Date().toISOString()}] applyUpdate pid=${process.pid} new=${newPath} target=${targetAppBundle}\n`
    )
  } catch {
    /* ignore */
  }

  const script = [
    '#!/bin/bash',
    `LOG="${logPath}"`,
    'if [ "$1" != "--daemonized" ]; then',
    '  nohup "$0" --daemonized "$@" </dev/null >/dev/null 2>&1 &',
    '  disown',
    '  exit 0',
    'fi',
    'shift',
    'exec >>"$LOG" 2>&1',
    'set -x',
    'trap "" HUP TERM',
    'PID=$1',
    `NEW_APP="${newPath}"`,
    `TARGET="${targetAppBundle}"`,
    'BACKUP="${TARGET}.bak"',
    'for i in $(seq 1 30); do',
    '  if ! ps -p $PID > /dev/null 2>&1; then break; fi',
    '  sleep 1',
    'done',
    'xattr -dr com.apple.quarantine "$NEW_APP" 2>/dev/null || true',
    'if [ -d "$TARGET" ]; then',
    '  rm -rf "$BACKUP" 2>/dev/null',
    '  if ! mv "$TARGET" "$BACKUP"; then echo "ERROR: backup failed"; rm -f "$0"; exit 1; fi',
    'fi',
    'if mv "$NEW_APP" "$TARGET"; then',
    '  codesign --force --deep --sign - "$TARGET" 2>&1 || true',
    '  rm -rf "$BACKUP" 2>/dev/null',
    '  open "$TARGET"',
    'else',
    '  echo "ERROR: move failed, rolling back"',
    '  [ -d "$BACKUP" ] && [ ! -d "$TARGET" ] && mv "$BACKUP" "$TARGET"',
    '  [ -d "$TARGET" ] && open "$TARGET"',
    'fi',
    'rm -f "$0"',
    ''
  ].join('\n')

  writeFileSync(scriptPath, script)
  chmodSync(scriptPath, 0o755)
  const child = spawn('/bin/bash', [scriptPath, String(process.pid)], {
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
  setTimeout(() => app.quit(), 500)
}

/** Register updater IPC + return a launch-time check-and-notify function. */
export function registerUpdater(getWindow: () => BrowserWindow | null): () => Promise<void> {
  const notify = (r: UpdateCheck): void => {
    if (r.status === 'available') {
      getWindow()?.webContents.send('update:available', {
        version: r.version,
        downloadUrl: r.downloadUrl,
        releaseUrl: r.releaseUrl
      })
    }
  }

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:can-self-install', () => canSelfInstall())
  ipcMain.handle('update:check', async () => {
    const r = await getUpdateStatus()
    notify(r)
    return r
  })
  ipcMain.handle('shell:open-external', (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  ipcMain.handle('update:download', async (_e, url: unknown) => {
    if (!canSelfInstall()) return { ok: false, error: 'Self-install not supported here' }
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { ok: false, error: 'Invalid URL' }
    const destPath = path.join(os.tmpdir(), `folderify-update-${Date.now()}.dmg`)
    try {
      await downloadToFile(url, destPath, (downloaded, total) => {
        getWindow()?.webContents.send('update:download-progress', { downloaded, total })
      })
      pendingUpdatePath = await mountAndExtractMacDmg(destPath)
      try {
        await fs.unlink(destPath)
      } catch {
        /* ignore */
      }
      return { ok: true }
    } catch (e) {
      try {
        await fs.unlink(destPath)
      } catch {
        /* ignore */
      }
      return { ok: false, error: (e as Error).message }
    }
  })
  ipcMain.handle('update:apply', () => {
    applyUpdate()
  })

  return async () => {
    const r = await getUpdateStatus()
    notify(r)
  }
}
