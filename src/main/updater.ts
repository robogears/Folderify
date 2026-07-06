// ============================================================================
// src/main/updater.ts — Electron self-updater from GitHub Releases (macOS + Windows).
//
// The entire feature's brain. Runs in the MAIN process (the only one with disk +
// unrestricted network — the renderer never talks to GitHub, so no CORS/CSP work).
// Registers all update:* IPC and returns { checkAndNotify, stop }.
//
// Platform dispatch lives IN THIS FILE, not in a fork of it: one shared
// check → download → SHA-256 verify pipeline, then a per-platform stage/apply.
//   darwin — mount the dmg, ditto the .app out, hand it to a detached
//            double-forked relauncher that swaps with .bak rollback.
//   win32  — the verified NSIS installer IS the stage; apply spawns it
//            detached with ['/S', '--force-run'] and quits.
// Everything else (transport, ETag cache, version compare, asset contract,
// integrity gate, re-entrancy, temp hygiene, re-check cadence) is identical.
// (Folderify ships macOS-only; the win32 path is kept for parity + future use.)
//
// This is the HARDENED default:
//   - Electron `net.request` transport everywhere (system proxy + OS cert store;
//     raw node:https fails forever behind corporate proxies). Redirects are
//     MANUAL: the host is re-validated on every hop before followRedirect().
//   - Host-pinned downloads. http and API-base overrides exist ONLY behind
//     overridesAllowed() — dev build, or an explicit
//     UPDATER_ALLOW_INSECURE_OVERRIDE=1 for the packaged updater-e2e-harness run.
//   - ETag-cached checks persisted to userData: a 304 reply costs ZERO of the
//     shared 60/hr unauthenticated quota. 403/429 → 'rate-limited' with a retry
//     time; 404 → 'no-releases'; net.isOnline() false → 'offline'.
//   - SHA-256 sidecar gate before staging; downloads land in *.part and rename
//     on success; disk-space + install-target-writability preflights;
//     re-entrancy guards; startup temp sweep; throttled progress events.
//   - Arch-matched assets with NO wrong-arch fallback (-universal.dmg is the one
//     exception — it contains both slices). Staged-app existence re-checked
//     before apply. The relauncher aborts (and reopens the old app) if the old
//     process never exits, and rolls back on ANY failure.
//
// Wired in src/main/index.ts:
//     const updater = registerUpdater(() => mainWindow)   // pass a GETTER
//     app.on('before-quit', () => updater.stop())
//     // The renderer invokes update:check itself once it has attached its
//     // listeners (updates-store init) — no launch setTimeout race.
// ============================================================================
import { app, ipcMain, net, powerMonitor, shell, type BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import {
  accessSync,
  appendFileSync,
  chmodSync,
  constants as fsConstants,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  promises as fs,
  readdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { Readable } from 'node:stream'
import type { UpdateCheck } from '../shared/models'

// ── CONFIG ───────────────────────────────────────────────────────────────────
const OWNER = 'robogears'
const REPO = 'Folderify'
const TMP_PREFIX = 'folderify' //     lowercase slug for temp file/dir names
const LOG_DIR_NAME = 'Folderify' //   ~/Library/Logs/<LOG_DIR_NAME>/
const RECHECK_INTERVAL_MS = 12 * 60 * 60 * 1000 // periodic re-check cadence (12h)
// Windows asset contract (unused on macOS-only builds; kept for parity).
const WIN_ASSET_SUFFIX = '-setup.exe'
// Hosts update bytes may come from. GitHub serves the API from api.github.com and
// release assets from github.com → objects.githubusercontent.com; nothing else.
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com'])
// ─────────────────────────────────────────────────────────────────────────────

type AvailableUpdate = Extract<UpdateCheck, { status: 'available' }>

// Staged update (darwin: extracted .app path; win32: verified installer .exe path).
let pendingUpdatePath: string | null = null
// Last "available" result, kept so the renderer can pull it after it finishes
// init() (update:get-pending) — replaces the old "check 2.5s after launch and hope
// the listeners are attached" race. It is ALSO the only source of the
// {downloadUrl, sha256Url} pair: update:download takes no arguments.
let lastAvailable: AvailableUpdate | null = null
// Re-entrancy guards: one download in flight, one apply in flight.
let downloadInFlight = false
let applying = false
// Set just before we quit for an update. Quit interceptors must let the quit
// through when this is true.
let quittingForUpdate = false
export function isQuittingForUpdate(): boolean {
  return quittingForUpdate
}
// Epoch ms of the last check that reached the network. Drives the wake re-check.
let lastCheckedAtMs = 0

interface GitHubAsset {
  name: string
  browser_download_url: string
}
interface GitHubRelease {
  tag_name: string
  html_url: string
  body?: string //         release notes — shown as "What's new"; already paid for
  published_at?: string
  assets: GitHubAsset[]
}

// ── Override guard (the ONE predicate; see SKILL.md §10) ─────────────────────
/**
 * Every relaxation in this file — the UPDATER_API_BASE override, non-https
 * transport, and host-allowlist widening — is gated by THIS predicate and
 * nothing else. Dev builds get overrides for free; a packaged build must opt in
 * explicitly with UPDATER_ALLOW_INSECURE_OVERRIDE=1 (how the updater-e2e-harness
 * tests the real stage/swap/relaunch path against its local mock). A shipped
 * build without that env var ignores every override — always pinned, always https.
 */
function overridesAllowed(): boolean {
  return !app.isPackaged || process.env.UPDATER_ALLOW_INSECURE_OVERRIDE === '1'
}

/** Host (host:port) of the UPDATER_API_BASE override, when the guard allows it. */
function overrideHost(): string | null {
  if (!overridesAllowed()) return null
  const base = process.env.UPDATER_API_BASE
  if (!base) return null
  try {
    return new URL(base).host
  } catch {
    return null
  }
}

/** API base for the release check. Overridable only behind the guard. */
function apiBase(): string {
  if (overridesAllowed() && process.env.UPDATER_API_BASE) {
    try {
      return new URL(process.env.UPDATER_API_BASE).toString().replace(/\/+$/, '')
    } catch {
      console.warn('[updater] UPDATER_API_BASE is not a valid URL; using api.github.com')
    }
  }
  return 'https://api.github.com'
}

/**
 * Reject any request target that isn't a pinned GitHub host over HTTPS. Applied
 * to the INITIAL url of all three request sites (check, artifact, sidecar) AND to
 * every redirect hop. The one relaxation: when overridesAllowed(), the exact host
 * of UPDATER_API_BASE is accepted (http included) so the e2e-harness mock on
 * 127.0.0.1 can serve the whole flow.
 */
function isAllowedDownloadUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  const ovr = overrideHost()
  if (ovr && parsed.host === ovr) return true
  if (parsed.protocol !== 'https:') return false
  if (ALLOWED_HOSTS.has(parsed.hostname)) return true
  if (parsed.hostname.endsWith('.githubusercontent.com')) return true
  return false
}

// ── Transport (shared by all three request sites) ────────────────────────────
/**
 * GET a URL with Electron's `net` (Chromium networking: system proxy resolution +
 * OS certificate store; also speaks plain http for the dev-mock override).
 * Redirects are MANUAL: re-validate the absolute redirect URL against the
 * allowlist, then followRedirect() synchronously (Electron contract) — or abort.
 */
function guardedGet(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {}
): Promise<Electron.IncomingMessage> {
  return new Promise((resolve, reject) => {
    if (!isAllowedDownloadUrl(url)) {
      return reject(new Error('Blocked: host not allowed'))
    }
    const req = net.request({ url, method: 'GET', redirect: 'manual' })
    req.setHeader('User-Agent', `${app.getName()}/${app.getVersion()}`)
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      req.abort()
      reject(new Error('Request timed out'))
    }, timeoutMs)
    req.on('redirect', (_statusCode, _method, redirectUrl) => {
      if (!isAllowedDownloadUrl(redirectUrl)) {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(new Error('Blocked: redirect to disallowed host'))
        }
        req.abort()
        return
      }
      req.followRedirect()
    })
    req.on('response', (res) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(res)
    })
    req.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

/** Drain a (small) response body to a string. Arms its own stall timer. */
function readBody(res: Electron.IncomingMessage, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    const timer = setTimeout(() => {
      ;(res as unknown as Readable).destroy(new Error('Body read timed out'))
    }, timeoutMs)
    res.on('data', (d) => (data += d))
    res.on('end', () => {
      clearTimeout(timer)
      resolve(data)
    })
    res.on('error', (e: Error) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

/** First value of a possibly-multi header, or undefined. */
function headerStr(res: Electron.IncomingMessage, name: string): string | undefined {
  const v = res.headers[name]
  if (Array.isArray(v)) return v[0]
  return typeof v === 'string' ? v : undefined
}

// ── ETag check cache (persisted; survives restarts) ──────────────────────────
// The unauthenticated GitHub API quota is 60 req/h PER IP, shared across every app
// checking from that machine/NAT. A conditional GET answered with 304 does NOT
// count against it. We cache the raw RELEASE (not the derived UpdateCheck): the
// derivation depends on app.getVersion(), so re-deriving on every 304 means a
// just-updated app can never resurrect a stale 'available' for the version it runs.
interface CheckCache {
  etag?: string
  lastResult?: GitHubRelease
  lastCheckedAt?: number
}
let cacheMem: CheckCache | null = null
function cachePath(): string {
  return path.join(app.getPath('userData'), 'updater-check-cache.json')
}
function loadCache(): CheckCache {
  if (cacheMem) return cacheMem
  try {
    cacheMem = JSON.parse(readFileSync(cachePath(), 'utf8')) as CheckCache
  } catch {
    cacheMem = {}
  }
  return cacheMem
}
function saveCache(patch: Partial<CheckCache>): void {
  cacheMem = { ...loadCache(), ...patch }
  try {
    writeFileSync(cachePath(), JSON.stringify(cacheMem))
  } catch {
    /* a failed cache write only costs quota, never correctness */
  }
}

type FetchResult =
  | { kind: 'ok'; release: GitHubRelease }
  | { kind: 'no-releases' }
  | { kind: 'rate-limited'; retryAfterSeconds?: number }
  | { kind: 'offline' }
  | { kind: 'error' }

/**
 * GET the latest PUBLISHED release (drafts and prereleases are invisible to
 * releases/latest — publishing is github-ship's deliberate flip).
 *  - Sends If-None-Match; a 304 re-uses the cached release at zero quota cost.
 *  - 404 = "no published releases yet" — a status, not an error.
 *  - 403/429 → 'rate-limited' with a retry time from Retry-After / X-RateLimit-Reset.
 *  - Offline detected up front (net.isOnline()) and reported distinctly.
 */
function fetchLatestRelease(): Promise<FetchResult> {
  return (async (): Promise<FetchResult> => {
    if (!net.isOnline()) return { kind: 'offline' }
    const cached = loadCache()
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' }
    if (cached.etag) headers['If-None-Match'] = cached.etag
    let res: Electron.IncomingMessage
    try {
      res = await guardedGet(`${apiBase()}/repos/${OWNER}/${REPO}/releases/latest`, 10_000, headers)
    } catch {
      return { kind: 'error' }
    }
    const status = res.statusCode ?? 0
    const body = await readBody(res, 10_000).catch(() => '')
    lastCheckedAtMs = Date.now()
    saveCache({ lastCheckedAt: lastCheckedAtMs })

    if (status === 304) {
      if (cached.lastResult) return { kind: 'ok', release: cached.lastResult }
      saveCache({ etag: undefined })
      return { kind: 'error' }
    }
    if (status === 404) return { kind: 'no-releases' }
    if (status === 403 || status === 429) {
      const retryAfter = parseInt(headerStr(res, 'retry-after') ?? '', 10)
      const resetEpoch = parseInt(headerStr(res, 'x-ratelimit-reset') ?? '', 10)
      const retryAfterSeconds = Number.isFinite(retryAfter)
        ? Math.max(0, retryAfter)
        : Number.isFinite(resetEpoch)
          ? Math.max(0, resetEpoch - Math.floor(Date.now() / 1000))
          : undefined
      return { kind: 'rate-limited', retryAfterSeconds }
    }
    if (status !== 200) return { kind: 'error' }
    try {
      const release = JSON.parse(body) as GitHubRelease
      if (!release || !release.tag_name) return { kind: 'error' }
      saveCache({ etag: headerStr(res, 'etag'), lastResult: release })
      return { kind: 'ok', release }
    } catch {
      return { kind: 'error' }
    }
  })()
}

// ── Version compare ───────────────────────────────────────────────────────────
/** Parse "v1.2.3" / "1.2.3-rc.1" (leading v stripped CASE-insensitively). Returns
 *  null for garbage tags that don't match ^v?\d+(\.\d+)*. */
function parseVersionTag(tag: string): { nums: number[]; prerelease: string | null } | null {
  const s = String(tag).trim().replace(/^v/i, '')
  if (!/^\d+(\.\d+)*(-.+)?$/.test(s)) return null
  const dash = s.indexOf('-')
  const numPart = dash === -1 ? s : s.slice(0, dash)
  const prerelease = dash === -1 ? null : s.slice(dash + 1)
  return { nums: numPart.split('.').map((n) => parseInt(n, 10)), prerelease }
}

/** Numeric segment compare (never string compare); a prerelease ranks BELOW its
 *  own release at equal numerics; a garbage tag is logged and ignored. */
function isNewerVersion(remote: string, current: string): boolean {
  const r = parseVersionTag(remote)
  const c = parseVersionTag(current)
  if (!r) {
    console.warn(`[updater] ignoring unparseable remote version tag: ${remote}`)
    return false
  }
  if (!c) {
    console.warn(`[updater] ignoring unparseable current version: ${current}`)
    return false
  }
  const len = Math.max(r.nums.length, c.nums.length)
  for (let i = 0; i < len; i++) {
    const a = r.nums[i] ?? 0
    const b = c.nums[i] ?? 0
    if (a > b) return true
    if (a < b) return false
  }
  return c.prerelease !== null && r.prerelease === null
}

// ── Asset matching (THE naming contract; SKILL.md §4) ─────────────────────────
/** Pick the one asset this machine may self-install, by NAME. NO wrong-arch
 *  fallback (only -universal.dmg after an exact-arch miss). */
function matchAsset(assets: GitHubAsset[]): GitHubAsset | undefined {
  if (process.platform === 'darwin') {
    const wanted = `-${process.arch}.dmg` // e.g. "-arm64.dmg"
    const exact = assets.find((a) => a.name && a.name.includes(wanted))
    if (exact) return exact
    return assets.find((a) => a.name && a.name.includes('-universal.dmg'))
  }
  if (process.platform === 'win32') {
    return assets.find((a) => a.name && a.name.endsWith(WIN_ASSET_SUFFIX))
  }
  return undefined
}

async function getUpdateStatus(): Promise<UpdateCheck> {
  const fetched = await fetchLatestRelease()
  if (fetched.kind === 'offline') return { status: 'offline' }
  if (fetched.kind === 'no-releases') return { status: 'no-releases' }
  if (fetched.kind === 'rate-limited') {
    return { status: 'rate-limited', retryAfterSeconds: fetched.retryAfterSeconds }
  }
  if (fetched.kind === 'error') {
    return { status: 'error', message: 'Could not reach GitHub' }
  }
  const release = fetched.release
  if (!isNewerVersion(release.tag_name, app.getVersion())) {
    return { status: 'up-to-date', version: app.getVersion() }
  }

  const assets = release.assets || []
  const asset = matchAsset(assets)
  const shaAsset = asset ? assets.find((a) => a.name === `${asset.name}.sha256`) : undefined
  const version = release.tag_name.replace(/^v/i, '')

  if (!asset) {
    return {
      status: 'available',
      version,
      notes: release.body || undefined,
      publishedAt: release.published_at || undefined,
      releaseUrl: release.html_url,
      reason: 'no-asset-for-arch'
    }
  }

  return {
    status: 'available',
    version,
    notes: release.body || undefined,
    publishedAt: release.published_at || undefined,
    downloadUrl: asset.browser_download_url,
    sha256Url: shaAsset?.browser_download_url,
    releaseUrl: release.html_url
  }
}

/** Self-install is only possible from a packaged build on a platform this file can
 *  swap (darwin dmg, win32 NSIS). Dev builds degrade to "Get vX" → release page. */
function canSelfInstall(): boolean {
  return (process.platform === 'darwin' || process.platform === 'win32') && app.isPackaged
}

// ── Download (shared: dmg and installer exe) ─────────────────────────────────
/** Stream a URL to `destPath` via `destPath + '.part'`; disk-space preflight;
 *  stall timer; every error path destroys both streams. */
async function downloadToFile(
  url: string,
  destPath: string,
  onProgress: (downloaded: number, total: number) => void
): Promise<void> {
  const partPath = destPath + '.part'
  const res = await guardedGet(url, 30_000)
  const bodyStream = res as unknown as Readable
  if (res.statusCode !== 200) {
    bodyStream.destroy()
    throw new Error(`HTTP ${res.statusCode}`)
  }
  const total = parseInt(headerStr(res, 'content-length') ?? '0', 10) || 0
  if (total > 0) {
    let free = Infinity
    try {
      const st = statfsSync(os.tmpdir())
      free = st.bavail * st.bsize
    } catch {
      /* exotic tmpdir fs — skip the preflight rather than leak the response */
    }
    const needed = Math.ceil(total * 2.5)
    if (needed > free) {
      bodyStream.destroy()
      const needMb = Math.ceil(needed / (1024 * 1024))
      throw new Error(`not enough disk space (need ~${needMb} MB)`)
    }
  }
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(partPath)
    let downloaded = 0
    let settled = false
    let stallTimer: NodeJS.Timeout | null = null
    const armStall = (): void => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => fail(new Error('Download stalled')), 60_000)
    }
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      if (stallTimer) clearTimeout(stallTimer)
      bodyStream.destroy()
      out.destroy()
      reject(err)
    }
    armStall()
    bodyStream.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      armStall()
      onProgress(downloaded, total)
    })
    bodyStream.on('error', fail)
    out.on('error', fail)
    out.on('close', () => {
      if (settled) return
      if (out.writableFinished) {
        settled = true
        if (stallTimer) clearTimeout(stallTimer)
        resolve()
      } else {
        fail(new Error('Write stream closed before finishing'))
      }
    })
    bodyStream.pipe(out)
  }).catch(async (err) => {
    await fs.unlink(partPath).catch(() => {})
    throw err
  })
  try {
    await fs.rename(partPath, destPath)
  } catch (e) {
    await fs.unlink(partPath).catch(() => {})
    throw e
  }
}

/** Compute the hex SHA-256 of a file on disk. */
function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/** Fetch the small .sha256 sidecar; return the bare hex digest or null. */
async function fetchExpectedSha(url: string): Promise<string | null> {
  try {
    const res = await guardedGet(url, 15_000)
    if (res.statusCode !== 200) {
      ;(res as unknown as Readable).destroy()
      return null
    }
    const body = await readBody(res, 15_000)
    const token = body.trim().split(/\s+/)[0]
    return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : null
  } catch {
    return null
  }
}

// ── macOS: stage (mount dmg → ditto .app out → detach) ───────────────────────
function mountAndExtractMacDmg(dmgPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ts = Date.now()
    const mountPoint = path.join(os.tmpdir(), `${TMP_PREFIX}-mount-${ts}`)
    const stagingDir = path.join(os.tmpdir(), `${TMP_PREFIX}-staged-${ts}`)
    try {
      mkdirSync(stagingDir, { recursive: true })
    } catch {
      /* ignore */
    }
    const detach = (): void => {
      const attempt = (force: boolean): void => {
        const args = force ? ['detach', '-force', mountPoint] : ['detach', '-quiet', mountPoint]
        try {
          const p = spawn('hdiutil', args, { stdio: 'ignore' })
          p.on('error', () => {})
          p.on('close', (code) => {
            if (code !== 0 && !force) {
              console.warn(`[updater] hdiutil detach exit ${code}; retrying with -force in 2s`)
              setTimeout(() => attempt(true), 2_000)
            }
          })
          p.unref()
        } catch {
          /* ignore */
        }
      }
      attempt(false)
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
      // The staged path is later interpolated into the relauncher bash script, so reject
      // any bundle whose name carries shell metacharacters. Do NOT require an exact
      // product-name match: app.getName() returns the lowercase package name
      // ("folderify") while the real bundle is "Folderify.app", so an == check wrongly
      // rejected every legit update. A safe-character allowlist closes the injection
      // vector without depending on that mismatch.
      if (!/^[\w .-]+\.app$/.test(appName)) {
        detach()
        return reject(new Error(`Unsafe .app name in DMG: ${appName}`))
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

// ── macOS: apply (detached relauncher swap) ──────────────────────────────────
function resolveDarwinTarget(): {
  runningAppBundle: string
  targetAppBundle: string
  isTranslocated: boolean
} {
  const exePath = app.getPath('exe')
  const runningAppBundle = exePath.replace(/\/Contents\/MacOS\/[^/]+$/, '')
  const isTranslocated = runningAppBundle.includes('/AppTranslocation/')
  const targetAppBundle = isTranslocated
    ? path.join('/Applications', path.basename(runningAppBundle))
    : runningAppBundle
  return { runningAppBundle, targetAppBundle, isTranslocated }
}

/** Per-platform log dir that SURVIVES the app (the swap runs after we're gone). */
function updaterLogDir(): string {
  return process.platform === 'win32'
    ? path.join(app.getPath('appData'), LOG_DIR_NAME)
    : path.join(os.homedir(), 'Library', 'Logs', LOG_DIR_NAME)
}

function logAttempt(line: string): void {
  const logDir = updaterLogDir()
  try {
    mkdirSync(logDir, { recursive: true })
    appendFileSync(path.join(logDir, 'attempts.log'), `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    /* ignore */
  }
}

type ApplyResult = { ok: boolean; code?: 'stage-missing' | 'busy'; error?: string }

/** Write a detached, double-forked relauncher that swaps the .app after we quit. */
function applyDarwin(newPath: string): ApplyResult {
  const { targetAppBundle, isTranslocated } = resolveDarwinTarget()

  try {
    accessSync(path.dirname(targetAppBundle), fsConstants.W_OK)
  } catch {
    return {
      ok: false,
      error: `Install location not writable (${path.dirname(targetAppBundle)}) — move the app to a folder you own and try again`
    }
  }

  const ts = Date.now()
  const scriptPath = path.join(os.tmpdir(), `${TMP_PREFIX}-update-${ts}.sh`)
  const logDir = updaterLogDir()
  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    /* ignore */
  }
  const logPath = path.join(logDir, `update-${ts}.log`)
  logAttempt(`applyUpdate pid=${process.pid} new=${newPath} target=${targetAppBundle}`)

  if (isTranslocated) {
    try {
      writeFileSync(
        path.join(app.getPath('userData'), 'moved-to-applications.marker'),
        targetAppBundle
      )
    } catch {
      /* ignore */
    }
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
    'for _ in $(seq 1 30); do',
    '  if ! ps -p "$PID" > /dev/null 2>&1; then break; fi',
    '  sleep 1',
    'done',
    'if ps -p "$PID" > /dev/null 2>&1; then',
    '  echo "ERROR: old process still alive after 30s (quit interceptor?) — aborting swap"',
    '  open "$TARGET"',
    '  rm -f "$0"',
    '  exit 1',
    'fi',
    'xattr -dr com.apple.quarantine "$NEW_APP" 2>/dev/null || true',
    'if [ -d "$TARGET" ]; then',
    '  rm -rf "$BACKUP" 2>/dev/null',
    '  if ! mv "$TARGET" "$BACKUP"; then',
    '    echo "ERROR: backup failed — reopening existing app"',
    '    [ -d "$TARGET" ] && open "$TARGET"',
    '    rm -f "$0"',
    '    exit 1',
    '  fi',
    'fi',
    'if ! mv "$NEW_APP" "$TARGET"; then',
    '  echo "ERROR: move-in failed, rolling back"',
    '  [ -d "$BACKUP" ] && [ ! -d "$TARGET" ] && mv "$BACKUP" "$TARGET"',
    '  [ -d "$TARGET" ] && open "$TARGET"',
    '  rm -f "$0"',
    '  exit 1',
    'fi',
    'if codesign --force --deep --sign - "$TARGET" && codesign --verify --deep --strict "$TARGET"; then',
    '  rm -rf "$BACKUP" 2>/dev/null',
    '  open "$TARGET"',
    'else',
    '  echo "ERROR: re-sign/verify failed"',
    '  if [ -d "$BACKUP" ]; then',
    '    rm -rf "$TARGET" 2>/dev/null',
    '    mv "$BACKUP" "$TARGET"',
    '  fi',
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
  quittingForUpdate = true
  setTimeout(() => app.quit(), 500)
  return { ok: true }
}

// ── Windows: apply (detached silent NSIS reinstall) ──────────────────────────
function applyWin32(installerPath: string): ApplyResult {
  logAttempt(`applyUpdate(win32) pid=${process.pid} installer=${installerPath}`)
  try {
    const child = spawn(installerPath, ['/S', '--force-run'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })
    child.once('spawn', () => {
      child.unref()
      quittingForUpdate = true
      setTimeout(() => app.quit(), 200)
    })
    child.once('error', (err) => {
      applying = false
      logAttempt(`applyUpdate(win32) spawn FAILED: ${err.message}`)
      console.error(`[updater] installer spawn failed: ${err.message}`)
    })
  } catch (e) {
    return { ok: false, error: `Could not start installer: ${(e as Error).message}` }
  }
  return { ok: true }
}

/** Platform dispatch + the guards every apply shares. */
function applyUpdate(): ApplyResult {
  if (applying) return { ok: false, code: 'busy' }
  if (!pendingUpdatePath || !existsSync(pendingUpdatePath)) {
    pendingUpdatePath = null
    return { ok: false, code: 'stage-missing' }
  }
  applying = true
  const result =
    process.platform === 'win32' ? applyWin32(pendingUpdatePath) : applyDarwin(pendingUpdatePath)
  if (!result.ok) applying = false
  return result
}

// ── Temp hygiene ─────────────────────────────────────────────────────────────
function sweepStaleTemp(): void {
  const now = Date.now()
  let entries: string[] = []
  try {
    entries = readdirSync(os.tmpdir())
  } catch {
    return
  }
  for (const name of entries) {
    if (!name.startsWith(`${TMP_PREFIX}-`)) continue
    const full = path.join(os.tmpdir(), name)
    if (pendingUpdatePath && pendingUpdatePath.startsWith(full)) continue
    try {
      const isOrphanPart = name.endsWith('.part')
      const stale = now - statSync(full).mtimeMs > 24 * 60 * 60 * 1000
      if (isOrphanPart || stale) {
        rmSync(full, { recursive: true, force: true })
      }
    } catch {
      /* ignore — best-effort hygiene */
    }
  }
}

// ── Registration: IPC + cadence ──────────────────────────────────────────────
export function registerUpdater(getWindow: () => BrowserWindow | null): {
  checkAndNotify: () => Promise<void>
  stop: () => void
} {
  sweepStaleTemp()

  const send = (channel: string, payload: unknown): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }

  const notify = (r: UpdateCheck): void => {
    if (r.status === 'available') {
      lastAvailable = r
      send('update:available', r)
    }
  }

  const doCheck = async (): Promise<UpdateCheck> => {
    try {
      const r = await getUpdateStatus()
      notify(r)
      return r
    } catch (e) {
      return { status: 'error', message: (e as Error).message || 'Update check failed' }
    }
  }

  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:can-self-install', () => canSelfInstall())
  ipcMain.handle('update:check', () => doCheck())
  ipcMain.handle('update:get-pending', () => lastAvailable)
  ipcMain.handle('shell:open-external', (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) {
      shell.openExternal(url).catch(() => {})
    }
  })

  // NO url argument: main downloads the {downloadUrl, sha256Url} pair from its OWN
  // last check state, read atomically from one object.
  ipcMain.handle('update:download', async () => {
    if (!canSelfInstall()) return { ok: false, error: 'Self-install not supported here' }
    if (downloadInFlight) return { ok: false, error: 'busy' }
    const av = lastAvailable
    if (!av || !av.downloadUrl) {
      return { ok: false, error: 'No downloadable update — check again' }
    }
    if (process.platform === 'darwin') {
      const { targetAppBundle } = resolveDarwinTarget()
      try {
        accessSync(path.dirname(targetAppBundle), fsConstants.W_OK)
      } catch {
        return {
          ok: false,
          error: `Install location not writable (${path.dirname(targetAppBundle)}) — move the app to a folder you own and try again`
        }
      }
    }
    downloadInFlight = true
    const ts = Date.now()
    const destPath =
      process.platform === 'win32'
        ? path.join(os.tmpdir(), `${TMP_PREFIX}-update-${ts}${WIN_ASSET_SUFFIX}`)
        : path.join(os.tmpdir(), `${TMP_PREFIX}-update-${ts}.dmg`)

    let lastPct = -1
    let lastEmit = 0
    const onProgress = (downloaded: number, total: number): void => {
      const now = Date.now()
      const pct = total > 0 ? Math.floor((downloaded / total) * 100) : -1
      if (pct !== lastPct || now - lastEmit >= 150) {
        lastPct = pct
        lastEmit = now
        send('update:download-progress', { downloaded, total })
      }
    }

    try {
      await downloadToFile(av.downloadUrl, destPath, onProgress)

      // SHA-256 gate BEFORE staging. Missing sidecar (old release) → warn + proceed
      // on the TLS floor.
      if (av.sha256Url) {
        // The release advertises a sidecar → the checksum gate is mandatory. Fail CLOSED
        // if we can't fetch/parse it: a present-but-unreadable digest is exactly what an
        // attacker who dropped the sidecar (to force a skip) would produce. (Pre-contract
        // releases have NO sha256Url at all and take the lenient path below.)
        const expected = await fetchExpectedSha(av.sha256Url)
        if (!expected) {
          await fs.unlink(destPath).catch(() => {})
          return { ok: false, error: 'Checksum unavailable — could not verify the download' }
        }
        const actual = await sha256File(destPath)
        if (actual !== expected) {
          await fs.unlink(destPath).catch(() => {})
          return { ok: false, error: 'Checksum mismatch — download corrupted or tampered' }
        }
      } else {
        console.warn('[updater] no .sha256 asset for this release; skipping checksum verify')
      }

      if (process.platform === 'win32') {
        pendingUpdatePath = destPath
      } else {
        pendingUpdatePath = await mountAndExtractMacDmg(destPath)
        await fs.unlink(destPath).catch(() => {})
      }
      return { ok: true }
    } catch (e) {
      await fs.unlink(destPath).catch(() => {})
      return { ok: false, error: (e as Error).message }
    } finally {
      downloadInFlight = false
    }
  })
  ipcMain.handle('update:apply', () => applyUpdate())

  const timer = setInterval(() => {
    void doCheck()
  }, RECHECK_INTERVAL_MS)
  timer.unref?.()

  const onResume = (): void => {
    if (Date.now() - lastCheckedAtMs > RECHECK_INTERVAL_MS) void doCheck()
  }
  powerMonitor.on('resume', onResume)

  return {
    checkAndNotify: async () => {
      await doCheck()
    },
    stop: () => {
      clearInterval(timer)
      powerMonitor.removeListener('resume', onResume)
      for (const ch of [
        'app:version',
        'update:can-self-install',
        'update:check',
        'update:get-pending',
        'shell:open-external',
        'update:download',
        'update:apply'
      ]) {
        ipcMain.removeHandler(ch)
      }
    }
  }
}
