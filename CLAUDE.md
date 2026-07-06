# Folderify — CLAUDE.md

A macOS music player (Spotify-style) where **your folders are your playlists**, plus an
**iPhone app** that reuses the same renderer via Capacitor. The app is a strict **read-only
mirror** of the filesystem: pick a root folder = your library; each immediate subfolder = a
playlist. Nothing is ever created/moved/renamed/deleted by the app — the filesystem is the
single source of truth, scanned at launch and watched live while running.

Current version: **0.1.12** (package.json, package-lock, and iOS `MARKETING_VERSION` are kept in
lockstep — bump all three when releasing).

---

## Core model (the one rule that matters)

- **Library** = every audio file found **recursively** under the chosen root folder.
- **Playlist** = the **first path segment** under the root. A file at `<root>/Techno/Artist/x.mp3`
  belongs to playlist `Techno`. A playlist contains every audio file recursively inside its subfolder.
- **Loose Tracks** = files sitting directly in the root (no subfolder). Reserved id `__root__`
  (`LOOSE_PLAYLIST_ID` / `LOOSE_PLAYLIST_NAME` in `src/shared/models.ts`), pinned last in the
  sidebar. Playlist ordering is alphabetical (case-insensitive) with Loose Tracks last; tracks
  within a playlist sort album → discNo → trackNo (missing = 9999) → title.
- The UI never mutates the music folder. The only writes anywhere are to the app's own data dir
  (config, metadata cache, thumbnails) and the renderer's localStorage (preferences).

## Refresh / sync behavior

- **Every launch** runs a full rescan (`runRebuild` in `src/main/index.ts`): re-walks the tree,
  re-`stat`s every file, picks up additions/removals/changes. A `scanning` flag plus a single
  `queuedRoot` slot serialize rebuilds; a queued root only re-runs if it differs from the one
  just scanned.
- The **metadata cache** (`src/main/cache.ts`) is keyed by **path + mtime + size** (JSON file,
  `CACHE_VERSION` mismatch discards everything; saves debounced 1.5s, flushed after builds and on
  `before-quit`). Unchanged files are served from cache with no re-parse and no thumbnail regen —
  so relaunch scans are cheap.
- While running, **chokidar** (`src/main/library/watcher.ts`) watches the root and emits debounced
  (400ms) batched deltas — one flush = one model recompute = one `FsDelta`. Options:
  `ignoreInitial`, `followSymlinks: false`, `awaitWriteFinish {1500ms, poll 100ms}`; dot-files
  skipped.
- **Startup order** (`app.whenReady`): CSP hook → thumbs dir → cache load → watcher created →
  protocol handlers → IPC → updater (registered; the **renderer** runs the first check itself) →
  listen module → main window + mini window + tray → player relay → restore root
  (`loadRoot() ?? FOLDERIFY_DEFAULT_ROOT`) → rebuild.

---

## Tech stack (exact versions — pinned for a reason)

| Package | Version | Note |
|---|---|---|
| electron | ^43 | Chromium ships proprietary codecs (mp3/aac/flac native) |
| electron-vite | ^5 | build orchestration (main + preload + renderer) |
| vite | **^7** (NOT 8) | electron-vite 5 peers `vite ^5‖^6‖^7` — vite 8 breaks it |
| @vitejs/plugin-react | **^5.2** (NOT 6) | plugin-react 6 requires vite 8 |
| typescript | **~5.9** (NOT 6) | TS 6 is breaking for this config |
| react / react-dom | ^19.2 | |
| zustand | ^5 | renderer state (incl. `persist` middleware for settings) |
| music-metadata | ^11.13 | **ESM-only** → dynamic `import()` in main |
| chokidar | ^5 | **ESM-only** → dynamic `import()` in main |
| electron-builder | ^26.15 | packaging |
| @capacitor/{core,cli,ios} | ^8.4 | **devDependencies** — mobile build tooling only, never bundled into the desktop app |

> `npm install vite@latest` / `typescript@latest` / `@vitejs/plugin-react@latest` will pull
> vite 8 / TS 6 / plugin-react 6 and **break the build**. Keep the pins above. Future electron
> majors are untested — bump deliberately.

**No native modules by design.** We deliberately avoid `better-sqlite3` and `sharp` so there's
no `electron-rebuild` step and no `NODE_MODULE_VERSION` crashes. Instead:
- metadata cache = a JSON file (`cache.ts`)
- thumbnails = Electron's built-in **`nativeImage`** (`thumbnails.ts`)

These are the documented scale-up swap-ins for 10k+ track libraries (plus worker threads and
`react-window` virtualization), but not needed for v1.

---

## Architecture

Three processes, strict security posture (`contextIsolation: true, sandbox: true,
nodeIntegration: false`; `setWindowOpenHandler` denies all popups).

- **Main** (`src/main/`) — the only process with disk access. Owns the JSON cache, the chokidar
  watcher, the recursive scanner, the metadata/thumbnail pipeline, the filesystem→model builder,
  the custom protocol handlers, the **tray + mini-player window**, and the **in-app updater**.
  Validates every path stays under the root.
- **Preload** (`src/preload/index.ts`) — sandboxed; exposes a single typed `window.api` via
  `contextBridge`. Never exposes raw `ipcRenderer`. **Must stay CommonJS** (sandboxed preloads
  can't be ESM).
- **Renderer** (`src/renderer/`) — React UI. No filesystem logic. Gets the model over IPC, drives a
  plain `<audio>` element, and references all bytes through custom protocols. **Dual-entry**: the
  same bundle renders `<App/>` normally or `<MiniPlayer/>` when the URL hash is `#mini`
  (`src/renderer/src/main.tsx`).

### Windows, tray, and app lifetime

- **Main window**: 1280×840 (min 960×620), `titleBarStyle: 'hiddenInset'` — the sidebar header
  pads 46px top so the logo clears the traffic lights.
- **Mini-player window** (`createMiniWindow`): 340×234, frameless/transparent/alwaysOnTop/
  skipTaskbar, visible on all workspaces, hides on blur; created eagerly at startup; loads the
  renderer with `#mini`. Positioned centered under the tray icon, clamped inside the workArea.
- **Tray** (`createTray` + `src/main/tray-icon.ts`): template-image icon (base64 PNGs, 1x+2x) so
  macOS tints it. Left-click toggles the mini-player; right-click → Open Folderify / Quit.
- **macOS lifetime**: closing all windows does NOT quit (menu-bar app); `window-all-closed` quits
  only off-darwin; `activate`/tray reopens the main window.

### Custom protocols (`src/main/protocols.ts`)

Registered privileged **before** `app.ready` (`registerSchemes`: media gets
standard/secure/supportFetchAPI/stream/bypassCSP; cover/app get standard/secure/supportFetchAPI),
handled after ready (`registerProtocolHandlers`).

| Scheme | Purpose |
|---|---|
| `media://` | Streams seekable audio via `fs.createReadStream` (wrapped `Readable.toWeb`) with manual HTTP **Range** support: 206 + `Content-Range` for `bytes=start-end`, 416 on invalid ranges, 200 full-stream otherwise. Sends `Accept-Ranges: bytes`, `Cache-Control: no-cache`, and `Access-Control-Allow-Origin: *`. Path traversal guarded by `safeResolveUnder()` (403 on escape). MIME by extension map. |
| `cover://` | Serves `userData/thumbs/<id>_<sm|lg>.jpg` (`?s=sm|lg`; immutable 1y cache) or, on miss / id `placeholder`, an inline gradient+note SVG (24h cache). |
| `app://` | Serves the built renderer from `out/renderer` in production (never `file://`) with the same traversal guard and an SPA fallback to `index.html`. Dev loads the Vite dev server. |

URL helpers live in `src/shared/ipc.ts`: `mediaUrl(absPath)`, `coverUrl(trackId, 'sm'|'lg')`.

### IPC surface (implemented in `src/preload/index.ts`; see `src/shared/api.ts` for `window.api`)

**Library** (typed in `IpcInvokeMap`/`IpcEventMap`, `src/shared/ipc.ts`; handled in `src/main/ipc.ts`):
- invoke: `library:choose-folder`, `library:get` (model + live `scanning` flag),
  `library:rescan`, `library:forget`, `track:reveal` (validates string arg; `shell.showItemInFolder`).
- push: `library:loaded` (full model after every rebuild — also sent on rebuild failure),
  `library:changed` (`FsDelta`), `library:scan-progress` (`ScanProgress`).

**Updater** (handled in `src/main/updater.ts`; NOT in the typed maps — wired as raw strings):
- invoke: `app:version`, `update:check`, `update:get-pending` (replays the last `available`),
  `update:can-self-install` (darwin + packaged only), `update:download` (**no args** — main
  downloads its own last-checked asset+sidecar pair), `update:apply`, `shell:open-external`
  (http/https URLs only).
- push: `update:available`, `update:download-progress`.

**Exclusive media keys** (`src/main/media-keys.ts`; raw string channel): invoke
`mediakeys:set-exclusive` (boolean) — when on, main `globalShortcut`-registers
MediaPreviousTrack/PlayPause/NextTrack (F7/F8/F9) so **only Folderify** gets them, and fires the
existing `player:command` channel (tray-bridge applies them). macOS requires the **Accessibility**
grant (typed `reason:'accessibility'` → the renderer reverts the toggle + explains; partial grabs
roll back with `reason:'taken'`). Persisted as `exclusiveMediaKeys` in `folderify.settings`
(default OFF); the renderer re-applies it on launch (main is stateless about it). When off, keys
flow through the normal cooperative MediaSession/Now Playing routing.

**Mini-player relay** (fire-and-forget `ipcRenderer.send`, relayed window↔window in
`src/main/index.ts`): main window publishes `player:state` (a `PlayerSnapshot`) → forwarded to the
mini window; mini window sends `player:command` (a `PlayerCommand`) → forwarded to the main window,
except `{type:'showApp'}` which main handles itself (hide popover, focus main window).

> Load race: the renderer attaches all three library listeners **before** the first `getLibrary()`
> call (`library-store.init`), so a `library:loaded` push can't be missed.

### In-app updater (`src/main/updater.ts`)

Hardened GitHub-Releases recipe (github-updater skill). NOT `node:https` — everything below.

- **Transport**: Electron `net` (system proxy + OS cert store), **host-pinned** to api.github.com /
  github.com / `*.githubusercontent.com`, re-validated on **every redirect hop**. http + the
  `UPDATER_API_BASE` override exist only behind `overridesAllowed()` (dev build, or an explicit
  `UPDATER_ALLOW_INSECURE_OVERRIDE=1` for the updater-e2e-harness) — dead in a shipped build.
- **Check**: GET `.../releases/latest` with an **ETag** cache persisted to
  `userData/updater-check-cache.json`; a `304` reuses the cached release at zero of the shared
  60/hr quota. Typed outcomes: 404 → `no-releases`, 403/429 → `rate-limited` (retry seconds),
  offline → `offline`, else `up-to-date`/`available`. Version compare strips `v`
  case-insensitively, is prerelease-aware, ignores garbage tags. Asset match: `-${process.arch}.dmg`
  then `-universal.dmg`, else `available` with **no** `downloadUrl` (`reason:'no-asset-for-arch'` →
  UI routes to the release page; there is **no** wrong-arch fallback). The **renderer** drives the
  launch check (silent `check()` + `update:get-pending` replay — no launch setTimeout); main arms a
  12h timer + `powerMonitor` wake re-check and a `stop()` teardown.
- **Download/stage**: refuses unless self-installable (darwin + packaged); `update:download` takes
  **no URL** (main uses its own `{downloadUrl, sha256Url}` pair, closing a renderer-supplied-URL
  hole + race). Streams to `*.part` → rename on success; disk-space + install-writability
  preflights; stall timer; re-entrancy guard; startup temp sweep. **SHA-256 sidecar verified before
  staging** — a mismatch, or (when a sidecar is advertised) an unfetchable digest, **fails closed**;
  a release with no sidecar at all proceeds on the TLS floor with a warning. Then `hdiutil attach
  -nobrowse` → `ditto` the `.app` out → detach → delete the dmg.
- **Apply**: derives the running bundle from the exe path. **App Translocation guard** — if the path
  contains `/AppTranslocation/`, install to `/Applications/<name>` instead. Writes a self-deleting
  bash script that **double-forks** (`nohup` + `disown` + `--daemonized` re-exec) so it survives app
  exit; logs to `~/Library/Logs/Folderify/update-<ts>.log`; waits ≤30s for the PID (aborts + reopens
  the old app if it never exits); strips quarantine (`xattr -dr`); moves old app to `.bak`; moves
  the new app in; **re-signs ad-hoc AND verifies** (rolls back to `.bak` on a failed re-sign);
  reopens the old app if even the backup step fails. App quits itself 500ms after spawning the
  script.
- The updater depends on the release asset naming contract `Folderify-<version>-arm64.dmg` **plus a
  `Folderify-<version>-arm64.dmg.sha256` sidecar** — don't change `artifactName` in
  electron-builder.yml (or drop the CI checksum step) without keeping the matcher in sync. Drafts
  are invisible to `releases/latest`; users only see the update once the release is published.

---

## Directory map

```
src/
  shared/                  types/consts imported by BOTH processes (use `import type` in renderer)
    models.ts              Track, Playlist, LibraryModel, FsDelta, ScanProgress, PlayerSnapshot,
                           PlayerCommand, UpdateAvailable/UpdateCheck/UpdateProgress,
                           LOOSE_PLAYLIST_ID/NAME
    ipc.ts                 IpcInvokeMap, IpcEventMap (library channels only), PROTOCOL,
                           mediaUrl(), coverUrl()
    api.ts                 FolderifyApi — the full 22-member window.api surface (incl. listen.*)
    audio-extensions.ts    AUDIO_EXT (24 exts), UNSUPPORTED_EXT, isAudioFile()
  main/
    index.ts               lifecycle, windows (main/mini), tray, CSP, rebuild queue, player relay
    protocols.ts           registerSchemes (pre-ready) + media/cover/app handlers
    path-safety.ts         safeResolveUnder() — traversal guard (resolve+relative, rejects ..)
    ipc.ts                 library ipcMain.handle registrations
    updater.ts             GitHub release check/download/self-install (see Updater section)
    tray-icon.ts           template tray icon (base64 1x/2x PNGs)
    cache.ts               MetaCache (JSON), trackIdForPath() = sha1(path) first 16 hex chars
    thumbnails.ts          nativeImage resize → userData/thumbs/<id>_<sm|lg>.jpg (sm 256 / lg 512,
                           JPEG q82; only the sm write determines hasArt)
    codecs.ts              isUnsupportedCodec() — by parsed codec (ALAC/AIFF/APE/WavPack/Musepack/
                           DSD/WMA) or container; extension fallback only when nothing parsed
    library/
      root-store.ts        loadRoot (re-stats; null if gone) / saveRoot / chooseFolder() dialog
      scanner.ts           scanAudioFiles() — recursive readdir(withFileTypes) walker,
                           concurrency 12, skips dot-entries, FOLLOWS symlinks
      metadata.ts          parseTrack() = cache → music-metadata → thumbnails; sidecar folder-art
                           fallback (cover/folder/front/album/albumart*.jpg|jpeg|png|webp|gif,
                           memoized per dir); parse errors fall back to filename + ext-flagging
      model.ts             Library class: tracks Map, playlist derivation, build/upsert/remove
                           (remove also deletes thumbs + cache entry; reset() does NOT)
      watcher.ts           LibraryWatcher: chokidar + 400ms debounced batched deltas,
                           followSymlinks:false
  preload/index.ts         contextBridge.exposeInMainWorld('api', …) — all channels wired here
  renderer/
    index.html
    src/
      main.tsx             dual entry: '#mini' hash → MiniPlayer, else App
      App.tsx              splash → EmptyState → app shell; search/Home/All Songs views;
                           resume-last-track effect; data-layout/data-sidebar attributes
      env.d.ts
      tray-bridge.ts       useTrayBridge(): publishes PlayerSnapshot (discrete changes + 500ms
                           clock), applies incoming PlayerCommands
      audio/engine.ts      HTMLAudioElement wrapper — NO Web Audio, NO crossOrigin (see gotchas);
                           prepare(url, time) = load-paused-and-seek; VBR Infinity-duration fix;
                           rAF time loop throttled ~33ms
      state/library-store.ts  zustand: model + selection (+ALL_SONGS_ID) + search; init() wires IPC
      state/player-store.ts    queue/originalQueue/shuffle/repeat/volume; findPlayable() skips
                               unsupported tracks; engine errors auto-skip (with a consecutive-
                               failure cap); explicit **upNext** queue (addToQueue/playNextInQueue/
                               playUpNextNow, drained by next() before the context resumes);
                               persists folderify.volume + folderify.lastplayed
      components/QueuePanel.tsx  "Up next" right-drawer (own open-state store); shows now-playing +
                               upNext + the peer's shared queue. Right-click a TrackRow → Add to
                               queue / Play next. Queue button lives in NowPlayingBar.
      state/settings-store.ts  layout preset + sidebarCollapsed + resumeLastTrack, persisted via
                               zustand persist ('folderify.settings'); transient settingsOpen
      state/updates-store.ts   update check/download/apply state machine for the UI
      lib/format.ts        formatTime, formatDurationLong, pluralize, normalizeSearch (NFC)
      assets/note-mark.png the app-icon music note (CSS-mask source for the sidebar logo)
      styles/              tokens.css (design system), global.css, keyframes.css, app.css
                           (all layout variants live here, keyed off [data-layout])
      components/          Sidebar, TopBar, FolderHero, TrackList/TrackRow, AlbumGrid,
                           NowPlayingBar, SeekBar, VolumeSlider, TransportControls, EmptyState,
                           Cover, PlayingIndicator, Icons, MiniPlayer, SettingsPanel, UpdateButton
  mobile/                  iPhone shell (see iOS section)
build/
  after-pack.js            ad-hoc signing hook (xattr -cr + codesign --force --deep --sign -)
  entitlements.mac.plist   currently INERT (not referenced by any signing step; kept for a future
                           Developer ID + hardened-runtime build)
  icon.icns / icon.png     app icon — white note on dark squircle
.github/workflows/release.yml  CI (see Shipping section)
RELEASE_NOTES.md           the release body (body_path in CI) — rewrite per release
```

---

## Renderer features

### Layouts (`settings-store.ts` + `app.css`)

`LayoutPreset = 'default' | 'compact' | 'cover' | 'clean_01' | 'clean_02'`, applied as
`data-layout` on the root `.app` div (alongside `data-sidebar="collapsed|expanded"`):

- **default** — album-art grid, comfortable rows.
- **compact** — denser rows (44px), smaller art, denser grid.
- **cover** — bigger artwork everywhere, 68px rows.
- **clean_01** — full **light theme** via CSS-variable overrides (paper `#fbfbfd`, indigo accent).
- **clean_02** — dark "listening room": re-grids the app to 3 columns — 64px icon-rail sidebar |
  content | 340px full-height now-playing **panel** (the bottom bar becomes the right column).

### Settings & persistence (all renderer localStorage, in userData via Chromium)

- `folderify.settings` — layout, sidebarCollapsed, resumeLastTrack (zustand persist; transient
  `settingsOpen` excluded).
- `folderify.volume` — 0..1 slider value (default 0.8; engine applies a perceptual `v*v` curve;
  mute zeroes the element while preserving the slider value).
- `folderify.lastplayed` — `{trackId, time}`, saved on track start/pause/pagehide. Resume: after
  the library loads, if enabled and the track still exists, `restore()` rebuilds the queue from
  its playlist and `engine.prepare()`s it **paused** at the saved position.
- These keys are NOT cleared by "Disconnect folder".

### Mini-player / update UI

- `MiniPlayer.tsx` holds no player state — renders the last `PlayerSnapshot`, sends
  `PlayerCommand`s (toggle/next/prev/seek/setVolume/toggleMute/toggleShuffle/cycleRepeat/showApp).
  Includes cover art (click → showApp), seek bar, volume, shuffle/repeat.
- `UpdateButton.tsx` renders in the TopBar (pill) and Settings → Updates. States: "Get vX" (no
  self-install → opens release page), "Update to vX" → "Downloading N%" → "Restart to apply" →
  "Updating…", "Download failed — retry". Renders null when no update.
- `SettingsPanel.tsx` — modal (gear in TopBar, Escape/backdrop closes): Layout cards + sidebar
  toggle, Playback (resume toggle), Updates (version + check/update), Library stats.

---

## ⚠️ Gotchas / landmines (learned the hard way)

- **Never set `crossOrigin` on media loaded from a custom scheme, and don't route it through the
  Web Audio API.** `audio.crossOrigin='anonymous'` forced a CORS mode the renderer blocked →
  MediaError 4 → every track failed (the original "fluttering, no sound" bug). The media handler
  now sends `Access-Control-Allow-Origin: *`, which would *probably* allow Web Audio routing, but
  the engine deliberately still avoids it — do not re-introduce crossOrigin/Web Audio without
  testing actual playback. Volume is `audio.volume` with a perceptual `v*v` curve.
- **music-metadata and chokidar are ESM-only.** Loaded via dynamic `await import()` in main and
  left **external** (not bundled) by `externalizeDepsPlugin`. Don't `require()` them. (The
  chokidar import has a `.watch ?? .default.watch` interop shim.)
- **Codec reality (desktop):** Chromium decodes mp3 / aac(.m4a) / flac / vorbis / opus / wav. It
  does **NOT** decode **ALAC** or **AIFF** (a `.m4a` may be either — distinguished by the parsed
  container codec in `codecs.ts`). Unsupported tracks get a "Can't play" badge; playback
  navigation (`findPlayable`) skips them; engine errors auto-skip to the next track.
- **CSP** is set as an HTTP response header via `session.webRequest.onHeadersReceived` in
  production only; dev relies on the Vite dev server (a strict CSP breaks HMR). Policy allows
  app:/cover:/media: sources explicitly.
- **Symlink asymmetry:** the scanner **follows** symlinks (dirs and files), but the watcher runs
  `followSymlinks: false` — symlinked content appears at launch but changes to it never live-sync.
- **`FOLDERIFY_DEFAULT_ROOT` is not dev-only.** It's honored whenever no saved root exists
  (packaged builds included); it's just never persisted.
- **"Disconnect folder" is not a full reset.** It stops the watcher, clears the in-memory model,
  and nulls the config — `folderify-cache.json`, `thumbs/`, and localStorage survive. Full reset =
  delete the data directory.
- **Sidecar folder art:** when a file has no embedded picture, `metadata.ts` looks for
  `cover|folder|front|album|albumart|albumartsmall` + `.jpg|.jpeg|.png|.webp|.gif` in the file's
  directory (memoized per dir, reset each full build).
- **Dropbox / cloud libraries:** online-only (non-downloaded) files can't be read until synced
  locally; those tracks will skip.
- Shared types are imported into the renderer with `import type` so they erase at build (the
  `shared/` dir lives outside the renderer root; alias `@shared`).
- **iCloud + local codesign:** if the working copy lives in iCloud-managed Documents, local
  `codesign` fails ("detritus not allowed" — FinderInfo xattrs can't be stripped). Build to /tmp
  for local signed builds (`-c.directories.output=/tmp/...`); CI has no iCloud and signs fine.

---

## Commands

```bash
npm run dev            # electron-vite dev (HMR). FOLDERIFY_DEFAULT_ROOT=<dir> opens a folder when
                       # no root is saved (works in packaged builds too; never persisted)
npm run build          # type-safe production bundle into out/
npm run preview        # electron-vite preview of the production bundle
npm run typecheck      # typecheck:node (main/preload/shared) + typecheck:web (renderer)
npm run build:unpack   # build + electron-builder --dir → release/mac-arm64/Folderify.app
                       # (ad-hoc signed by the afterPack hook — NOT unsigned)
npm run build:mac      # build + .dmg (Apple Silicon arm64 ONLY) → release/Folderify-<v>-arm64.dmg
```

Local packaged builds are **ad-hoc signed** (see Shipping) and open normally. They are
**un-notarized**: on a fresh machine Gatekeeper requires System Settings → Privacy & Security →
**Open Anyway** once (macOS 15+), or right-click → Open on older macOS.

---

## Shipping / releases

**Packaging** (`electron-builder.yml`): `publish: null` (CI uploads, not electron-builder),
`mac.identity: null` (skips electron-builder's signing), `afterPack: build/after-pack.js` which
`xattr -cr`s then **ad-hoc signs** (`codesign --force --deep --sign -`) — a fully-unsigned app is
rejected by Apple Silicon Gatekeeper as "damaged"; ad-hoc needs no Developer ID. Single **arm64**
dmg; `artifactName: ${productName}-${version}-${arch}.${ext}` → `Folderify-<version>-arm64.dmg`
(**the updater's asset matcher depends on this name pattern**). `extendInfo` carries the
Music/Documents/Downloads folder + `NSLocalNetworkUsageDescription` (Listen Together) usage strings.

**CI** (`.github/workflows/release.yml`, macos-14 + Node 22; **all actions pinned to commit SHAs**):
on tag push `v*` → npm ci → build → `electron-builder --mac --publish never`
(`CSC_IDENTITY_AUTODISCOVERY=false`) → **`shasum -a 256` each dmg → `<dmg>.sha256` sidecar** (the
updater's SHA-256 gate depends on this step) → upload the dmg as a CI artifact → **only on tags**
create a **draft** GitHub release (dmg + `.sha256`) named after the tag with `body_path:
RELEASE_NOTES.md`. Manual `workflow_dispatch` produces test artifacts without cutting a release.

**Release checklist** (all three versions in lockstep):
1. Bump `package.json` version, `npm install --package-lock-only`, bump iOS `MARKETING_VERSION`
   (both configs in `ios/App/App.xcodeproj/project.pbxproj`).
2. Rewrite `RELEASE_NOTES.md` for the new version (it becomes the release body verbatim).
3. Commit, push main, tag `v<version>`, push the tag.
4. Watch CI; verify the draft has a non-empty body and the arm64 dmg attached (softprops has an
   empty-body quirk — check before publishing).
5. Publish the draft (`gh release edit v<version> --draft=false --latest`) — only then does the
   in-app updater see it.

---

## Config / data location

`~/Library/Application Support/Folderify/` (macOS is case-insensitive, so `folderify`==`Folderify`):
- `folderify-config.json` — the saved root folder (re-stat'd on load; nulled if missing)
- `folderify-cache.json` — metadata cache (path → mtime/size/tags, versioned)
- `updater-check-cache.json` — updater ETag + last release JSON (304-conditional checks)
- `thumbs/` — generated album-art thumbnails (`<id>_<sm|lg>.jpg`)
- `Local Storage/` (Chromium) — `folderify.settings`, `folderify.volume`, `folderify.lastplayed`

Updater logs: `~/Library/Logs/Folderify/update-<ts>.log` (+ `attempts.log`, `main-crash.log`).

Reset via the in-app folder menu → **Disconnect folder** (partial — see gotchas), or delete the
whole directory (full).

---

## Listen Together (LAN peer-to-peer playback) — desktop only

Two Macs on the **same Wi-Fi** pair 1:1 and play in sync; either can pick a track from **their
own** library and it streams to the other (the listener needs none of the files). Full design +
rationale in `docs/listen-together-design.md`. **Zero new dependencies** (uses Node's `dgram`/`net`
+ Chromium WebRTC). The Connect UI entry point is the broadcast icon in the TopBar, left of Rescan.

**Why data-channel file streaming, not `captureStream()`:** research-confirmed that
`captureStream()`/Web Audio on a cross-origin/custom-scheme element only yields non-silent output if
the element sets `crossOrigin` — which is exactly the tainting trap that broke `media://` playback
(see the crossOrigin gotcha). So we stream the **encoded file bytes** over an `RTCDataChannel` and
the receiver plays its own copy, kept in lockstep by a clock-synced control protocol.

- **Discovery** (`src/main/listen/discovery.ts`) — self-rolled UDP **multicast beacon** (group
  `239.255.71.14:50777`, TTL 1). Each instance announces `{id, name, sigPort}` every 2s; peers age
  out after ~6.5s. Simpler than mDNS and both ends are Folderify.
- **Signaling** (`src/main/listen/signaling.ts`) — a `net` TCP relay (newline-delimited JSON). The
  caller connects to the peer's advertised `sigPort`, sends `hello{pin}`; the callee validates the
  PIN against its own advertised code (**the PIN _is_ the pairing approval**), then relays SDP/ICE.
  One active connection at a time.
- **`src/main/listen/index.ts`** — wires the two, owns identity (`randomUUID` id, hostname, 6-digit
  PIN), exposes IPC (`listen:start/connect/disconnect/stop` + `listen:signal`) and pushes
  `listen:peers/connected/signal/error/disconnected`. Registered in `main/index.ts` startup;
  torn down on `before-quit`.
- **WebRTC** lives in the **renderer**: `src/renderer/src/listen/peer.ts` (one `RTCPeerConnection`,
  **one** data channel carrying both JSON control frames and binary audio — string vs ArrayBuffer
  discriminates, so `load` can't race the bytes it describes; `iceServers: []` since host
  candidates connect on a LAN). `main/index.ts` sets `disable-features=WebRtcHideLocalIpsWithMdns`
  so ICE candidates carry real LAN IPs.
- **Protocol brain**: `src/renderer/src/listen/session.ts`. Source `fetch()`es its own `media://`
  bytes → chunks (16KB, backpressure) → peer; receiver reassembles → **Blob URL** →
  `engine.loadRemote()`. Sync = authoritative-source `state{position, atClock}` + ping/pong clock
  offset, drift-corrected past 0.4s. Whoever picks a track becomes the source (two-way handoff);
  receiver play/pause/seek relay to the source. Falls back to a **local simulation** when
  `window.api.listen` is absent (browser harness / non-Electron), so the UI still works.
- **Receiver rendering**: a **synthetic `Track`** (id `remote:*`) is injected into
  `library-store` (`setRemoteTrack`) so NowPlayingBar/SeekBar/tray/MediaSession render the streamed
  track with no other UI changes. `player-store` gains `remote` + `_relay` (transport guards; never
  crosses IPC — `buildSnapshot` uses explicit fields). CSP `media-src` now allows `blob:`.
- **Shared queue**: each side broadcasts its `upNext` (titles only) via a `queue-notice` control
  frame; `listen-store.peerQueue` renders it in the QueuePanel. `player-store.next(auto)` consults a
  `_queueGate` (injected by session.ts): the **source's** queued track wins the next slot, the
  receiver's takes it only when the source has none — so both lockstep engines don't grab the slot
  at once. Whoever's queued track wins becomes source via the normal `becomeSourceFor` handoff.
- **macOS Local Network permission is mandatory.** macOS 15+/26 silently blocks multicast, the
  signaling TCP, AND WebRTC-to-LAN until the user allows the "find devices on your local network"
  prompt. `NSLocalNetworkUsageDescription` (electron-builder.yml `extendInfo`) supplies the prompt
  text. The prompt only fires for a **packaged** ad-hoc-signed app (its Info.plist has the key) —
  **`npm run dev` can't test this** (it runs Electron's own bundle). Test with `build:mac`.
- **Fallbacks so it works when multicast is flaky:** the signaling server binds a **fixed port**
  (`LISTEN_SIG_PORT` 50778, ephemeral only if taken), the idle panel shows this Mac's **LAN IP**,
  and the discovery panel offers **"connect by IP"** (`listen:connect-manual` → unicast TCP, no
  multicast needed). Unicast TCP + WebRTC still need the Local Network allow, but not the (managed,
  un-grantable-ad-hoc) multicast entitlement.
- **Failure is visible, not a hang:** a 15s connect timeout + `RTCPeerConnection` `failed` state
  surface "Couldn't establish a direct connection…" instead of an infinite "Connecting…". `peer.ts`
  buffers ICE candidates until the remote description is set (else a dropped candidate silently
  kills the connection) and ignores transient `disconnected`. `console.info('[listen] …')` traces
  every hop (ICE state, channel open, transfer start/finish) for device debugging.
- **Still needs two-Mac device testing** (can't be exercised in one process) and **no receiver
  cover art yet** (synthetic track `hasArt:false` → placeholder). To be discoverable/connectable a
  Mac must have the Connect panel open.

---

## iOS app (Capacitor) — `ios/`, `src/mobile/`, `vite.mobile.config.ts`

The iPhone app reuses the **same React renderer + stores** inside a WKWebView via Capacitor 8
(SPM-based, no CocoaPods). A separate Vite build (`npm run build:mobile` → `dist-mobile/`) bundles
the mobile shell; `npm run ios:sync` copies it into `ios/App/App/public`; build/run on device from
Xcode. **Phases 1–3 are complete** — Phase 1 (native library plugin: folder pick, persistent
access, on-device scan, artwork, seekable playback), Phase 2 (metadata cache, persisted artwork,
scan progress, iCloud-dataless awareness), and Phase 3 (background audio + native lock-screen /
Control Center / AirPods Now Playing) all work natively.

- **`src/mobile/`** — `MobileApp.tsx` (tab shell reusing SeekBar/TransportControls/etc),
  `native-api.ts` (real `window.api` backed by the Swift plugin), `api-stub.ts` (fake 3-playlist
  library for plain-browser preview), `install-api.ts` (native vs stub via
  `Capacitor.isNativePlatform()`), `mobile.css` (safe-area + touch sizing). The shell drives the
  shared `library-store`/`player-store` unchanged.
- **Native plugin (`ios/App/App/`)** — the only code with disk access, mirroring desktop main:
  - `FolderifyLibraryPlugin.swift` — exactly three methods: `pickFolder`
    (UIDocumentPicker for `.folder`; cancel resolves `{root:null}`), `getLibrary` (scan; resolves
    an EMPTY model — does not reject — when no folder is connected), `forget`. `jsName`
    = `'FolderifyLibrary'`.
  - `LibraryAccess.swift` — security-scoped bookmark persisted in UserDefaults key
    `folderify.rootBookmark.v1`; scope kept open for the session; stale bookmarks re-minted;
    path-safety for `media://`; serves `cover://` bytes from the persisted thumbs (id is
    hex-guarded against traversal). **`forget()` is a FULL reset on iOS** (clears cache + thumbs —
    unlike desktop, users can't reach the data dir).
  - `LibraryCache.swift` — Phase 2 persistence: JSON metadata cache
    (`Application Support/Folderify/library-cache-v1.json`, keyed by path, validated by
    mtime+size, thread-safe) + `thumbs/<id>.jpg` artwork dir. Stale entries and orphaned thumbs
    are pruned after every scan; cache hits skip AVFoundation entirely.
  - `LibraryScanner.swift` — recursive enumeration (skips hidden/package dirs) + AVFoundation
    metadata (batched `load(.duration, .commonMetadata)`, ID3/iTunes artwork fallback), parsed in
    task groups of 8 → the same `LibraryModel` shape. Reports progress via a callback
    (walking every 50 files / parsing every batch / done). `isMaterializedLocally()` gates
    AVFoundation away from dataless iCloud files.
  - `SchemeHandlers.swift` — `media://` (single-Range/206, suffix ranges, 200 full-file
    otherwise) + `cover://` (JPEG, 1y cache) handlers. A `TaskGuard` (NSLock + stopped-set) makes
    callbacks atomic w.r.t. `stop()` — WebKit cancels tasks aggressively on seek and calling a
    dead `WKURLSchemeTask` crashes.
  - `FolderifyNowPlayingPlugin.swift` (Phase 3) — native lock-screen bridge (`jsName`
    `'FolderifyNowPlaying'`). `update(...)`/`clear()` set `MPNowPlayingInfoCenter` (artwork from the
    persisted thumb) **event-driven only** (iOS extrapolates the scrubber from elapsed+rate;
    continuous background writes get dropped). `MPRemoteCommandCenter` handlers (play/pause/toggle/
    next/prev/seek) fire even when backgrounded and forward to JS via
    `notifyListeners('remoteCommand')` → `src/mobile/now-playing.ts` → player store. WebKit still
    does the actual `<audio>` playback; this bridge is used **instead of** the Web MediaSession hook
    on iOS (using both double-handles every command). Background audio needs
    `UIBackgroundModes=audio` (Info.plist) + `AVAudioSession .playback` (set in AppDelegate).
  - `FolderifyBridgeViewController.swift` — registers BOTH plugins (`capacitorDidLoad`) and installs
    the scheme handlers (`webViewConfiguration(for:)`); keeps strong handler references
    (WKWebViewConfiguration does not retain them). Wired via `Main.storyboard` Custom Class.

### iOS vs desktop divergences (know these before "it works on desktop" debugging)

- **Extension set is narrower**: iOS scans 13 extensions (mp3 m4a aac wav flac aiff aif aifc opus
  ogg oga caf alac); desktop's `AUDIO_EXT` has 24. `.m4b .mp4 .wma .wv .ape .mpc .dsf .dff .mka
  .webm` are **invisible** on iOS, not just unplayable.
- **Unsupported flags**: iOS flags `opus/ogg/oga` (WebKit can't play them) — by extension only, no
  container parsing. Conversely ALAC/AIFF/FLAC play fine on iOS.
- **Metadata is shallower**: only title/artist/album/duration/artwork; year/trackNo/discNo always
  null, genre `''`, albumArtist = artist, codec = uppercased extension. Requires **iOS 16+**
  (older iOS → filename titles only).
- **Track ids differ**: desktop = sha1(path) first 16 hex; iOS = full SHA-256 hex. Ids are
  platform-local — never compare across platforms.
- **Artwork is persisted** to `Application Support/Folderify/thumbs/<id>.jpg` (single 640px JPEG;
  the `?s=` size param is ignored). No placeholder image on iOS (desktop serves an SVG); the
  renderer's `<img onError>` hides broken images instead.
- **No live watcher** on iOS — refresh is pull-based: the Settings tab has a **Rescan library**
  button (`rescan` re-runs the scan and re-emits `onLoaded`). The plugin streams native
  `scanProgress` events during scans; the Library header shows "Scanning… N / M".
- **iCloud (dataless) handling**: never-parsed online-only files are listed by filename (no
  metadata, not cached) so the scan never blocks on the network; **playing one triggers its
  download** (`startDownloadingUbiquitousItem` + the blocking materializing read). Files that
  were parsed once and later evicted keep serving cached metadata + art. Rescan after downloads
  to pick up real tags.
- Mini-player bridge, updater, and revealTrack are **no-ops/stubs** on iOS (App Store handles
  updates; `openExternal` = `window.open`).

### iOS gotchas (learned the hard way)

- **App-embedded plugins are NOT auto-discovered.** Register explicitly with
  `bridge?.registerPluginInstance(...)` in `capacitorDidLoad()`; `jsName` must equal the
  `registerPlugin('FolderifyLibrary')` string. Symptom if missed: *"plugin not implemented on ios"*.
- **Inject scheme handlers via `webViewConfiguration(for:)`** (not `webView(with:)`) — it runs
  before the WKWebView is built. `media`/`cover` are custom schemes; WebKit forbids http/https.
- **iOS bookmarks differ from macOS:** create/resolve with **`[]` options** — `.withSecurityScope`
  is macOS-only and throws on iOS. The picker URL is already security-scoped.
- **Strip `crossorigin`** from the built module `<script>` (the `folderify-strip-crossorigin` Vite
  plugin in `vite.mobile.config.ts`) — same custom-scheme/CORS rule as desktop, or the WebView
  shows a black screen.
- **iOS 26 SDK requires UIScene lifecycle** (`SceneDelegate` in AppDelegate.swift +
  `UIApplicationSceneManifest`, TN3187).
- New Swift files must be added to `project.pbxproj` by hand (classic project format, objectVersion
  60 — no auto-synced folder groups).
- **Never use `FileHandle.readData(ofLength:)` / `readDataToEndOfFile()` in Swift.** They are
  Obj-C APIs that raise `NSFileHandleOperationException` on I/O errors — Swift cannot catch
  NSExceptions, so the app hard-crashes. Use the throwing `read(upToCount:)` / `readToEnd()`
  instead. This bit us in `MediaSchemeHandler`: an **iCloud Drive (CloudStorage) library** with
  online-only files failed mid-read ("Stale NFS file handle") and terminated the app. Cloud-backed
  files also parse with null duration/empty tags during scan; playback of an unreadable file now
  returns HTTP 500 → the engine errors → the player auto-skips.

### iOS commands

```bash
npm run build:mobile   # vite build of the mobile shell → dist-mobile/
npm run ios:sync       # build:mobile + cap sync ios (copies web assets, updates SPM)
npm run ios:open       # open the Xcode project (build/run on device from Xcode)
```

---

## Known limitations / future work

**Desktop**
- Un-notarized (ad-hoc signed only) — fresh installs need one Gatekeeper "Open Anyway".
  `build/entitlements.mac.plist` is currently unused; it's staged for a future Developer ID +
  hardened-runtime build.
- Files deleted while the app is **closed** leave orphaned cache entries + thumbnails (the live
  watcher prunes them, a build does not). Harmless; a build-time prune would tidy disk usage.
- Single `<audio>` element — no gapless preloading of the next track.
- Track list uses CSS `content-visibility` for virtualization (no `react-window` yet).
- Search filters the whole library; no per-folder search scope.
- SettingsPanel footer hard-codes "Folderify v1" (the Updates row shows the real version).
- **Listen Together** is built and typechecks/builds, but cross-machine connection is **untested**
  (needs two Macs). No receiver cover art yet, no internet/NAT (LAN only). See its section above.

**iOS (Phase 4 candidates)**
- **Background-audio reliability is WebKit's, not ours.** Audio playback lives in the WKWebView
  `<audio>` element; WebKit keeps it going in the background via a process assertion (iOS 14+) but
  this is historically flaky in Capacitor apps (audio can stop ~15s after backgrounding). The
  native Now Playing bridge keeps the lock-screen UI/commands alive, but a lock-screen play/pause
  round-trips to JS (`notifyListeners` → player store → `<audio>`), which only runs reliably while
  the app isn't fully suspended. The bulletproof fix is **native AVPlayer playback** (drop the
  `<audio>` element on iOS behind a pluggable engine backend) so play/pause/seek act directly on a
  native player — the biggest remaining iOS rework, deferred until device testing shows it's needed.
- No richer tags (year/trackNo/genre), no live folder watching.
- Legacy iCloud world (`Mobile Documents`, pre-FileProvider): evicted files appear as hidden
  `.name.ext.icloud` placeholders — the scanner skips hidden entries, so they're invisible (the
  modern `CloudStorage` dataless model, which real devices use now, is fully handled).
- Concurrent scans aren't serialized like desktop's rebuild queue (worst case: wasted work).
- Downloads triggered by playing an online-only track have no progress UI; metadata appears only
  after a manual rescan.
