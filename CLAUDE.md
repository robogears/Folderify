# Folderify — CLAUDE.md

A macOS music player (Spotify-style) where **your folders are your playlists**. The app is a
strict **read-only mirror** of the filesystem: pick a root folder = your library; each immediate
subfolder = a playlist. Nothing is ever created/moved/renamed/deleted by the app — the filesystem
is the single source of truth, scanned at launch and watched live while running.

---

## Core model (the one rule that matters)

- **Library** = every audio file found **recursively** under the chosen root folder.
- **Playlist** = the **first path segment** under the root. A file at `<root>/Techno/Artist/x.mp3`
  belongs to playlist `Techno`. A playlist contains every audio file recursively inside its subfolder.
- **Loose Tracks** = files sitting directly in the root (no subfolder). Reserved id `__root__`
  (`LOOSE_PLAYLIST_ID` in `src/shared/models.ts`), shown last in the sidebar.
- The UI never mutates the music folder. The only writes anywhere are to the app's own data dir
  (config, metadata cache, thumbnails).

## Refresh / sync behavior

- **Every launch** runs a full rescan (`runRebuild` in `src/main/index.ts`): re-walks the tree,
  re-`stat`s every file, picks up additions/removals/changes.
- The **metadata cache** (`src/main/cache.ts`) is keyed by **path + mtime + size**. Unchanged files
  are served from cache with no re-parse and no thumbnail regen — so relaunch scans are cheap.
- While running, **chokidar** (`src/main/library/watcher.ts`) watches the root and emits debounced
  deltas, so changes appear live without relaunch.

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
| zustand | ^5 | renderer state |
| music-metadata | ^11.13 | **ESM-only** → dynamic `import()` in main |
| chokidar | ^5 | **ESM-only** → dynamic `import()` in main |
| electron-builder | ^26.15 | packaging |

> Running `npm install <x>@latest` for electron / vite / typescript will pull
> electron 43+ / vite 8 / TS 6 and **break the build**. Keep the pins above.

**No native modules by design.** We deliberately avoid `better-sqlite3` and `sharp` so there's
no `electron-rebuild` step and no `NODE_MODULE_VERSION` crashes. Instead:
- metadata cache = a JSON file (`cache.ts`)
- thumbnails = Electron's built-in **`nativeImage`** (`thumbnails.ts`)

These are the documented scale-up swap-ins for 10k+ track libraries (plus worker threads and
`react-window` virtualization), but not needed for v1.

---

## Architecture

Three processes, strict security posture (`contextIsolation: true, sandbox: true,
nodeIntegration: false`).

- **Main** (`src/main/`) — the only process with disk access. Owns the JSON cache, the chokidar
  watcher, the recursive scanner, the metadata/thumbnail pipeline, the filesystem→model builder,
  and the custom protocol handlers. Validates every path stays under the root.
- **Preload** (`src/preload/index.ts`) — sandboxed; exposes a single typed `window.api` via
  `contextBridge`. Never exposes raw `ipcRenderer`. **Must stay CommonJS** (sandboxed preloads
  can't be ESM).
- **Renderer** (`src/renderer/`) — React UI. No filesystem logic. Gets the model over IPC, drives a
  plain `<audio>` element, and references all bytes through custom protocols.

### Custom protocols (`src/main/protocols.ts`)

Registered privileged **before** `app.ready` (`registerSchemes`), handled after ready
(`registerProtocolHandlers`).

| Scheme | Purpose |
|---|---|
| `media://` | Streams seekable audio from disk via `fs.createReadStream` with manual HTTP **Range** (206) support. Self-contained — does **not** use `net.fetch`. |
| `cover://` | Serves a JPEG thumbnail for a track id from `userData/thumbs`, or a generated placeholder SVG if none. |
| `app://` | Serves the built renderer in production (never `file://`). Dev loads the Vite dev server. |

URL helpers live in `src/shared/ipc.ts`: `mediaUrl(absPath)`, `coverUrl(trackId, 'sm'|'lg')`.

### IPC contract (`src/shared/ipc.ts`, implemented in `src/main/ipc.ts` + `src/preload/index.ts`)

Request/response (`invoke`): `library:choose-folder`, `library:get`, `library:rescan`,
`library:forget`, `track:reveal`.
Push (main→renderer): `library:loaded` (full model after a build), `library:changed` (incremental
delta), `library:scan-progress`.

> Load race: the renderer attaches all three listeners **before** the first `getLibrary()` call
> (`library-store.init`), so a `library:loaded` push can't be missed.

---

## Directory map

```
src/
  shared/                  types/consts imported by BOTH processes (use `import type` in renderer)
    models.ts              Track, Playlist, LibraryModel, FsDelta, ScanProgress, LOOSE_PLAYLIST_ID
    ipc.ts                 IpcInvokeMap, IpcEventMap, PROTOCOL, mediaUrl(), coverUrl()
    api.ts                 FolderifyApi (the window.api surface)
    audio-extensions.ts    AUDIO_EXT set, UNSUPPORTED_EXT, isAudioFile()
  main/
    index.ts               app lifecycle, BrowserWindow, CSP, rebuild queue + scanning flag
    protocols.ts           registerSchemes (pre-ready) + media/cover/app handlers
    path-safety.ts         safeResolveUnder() — traversal guard for media://
    ipc.ts                 ipcMain.handle registrations
    cache.ts               MetaCache (JSON), trackIdForPath() (sha1), TrackMeta
    thumbnails.ts          nativeImage resize → userData/thumbs/<id>_<sm|lg>.jpg
    codecs.ts              isUnsupportedCodec() — flags ALAC/AIFF/etc.
    library/
      root-store.ts        loadRoot/saveRoot config + chooseFolder() dialog
      scanner.ts           scanAudioFiles() recursive opendir walker (bounded concurrency)
      metadata.ts          parseTrack() = cache → music-metadata → thumbnails; mapWithConcurrency()
      model.ts             Library class: tracks Map, playlist derivation, build/upsert/remove
      watcher.ts           LibraryWatcher: chokidar + debounced batched deltas
  preload/index.ts         contextBridge.exposeInMainWorld('api', …)
  renderer/
    index.html
    src/
      main.tsx, App.tsx, env.d.ts
      audio/engine.ts      HTMLAudioElement wrapper — NO Web Audio, NO crossOrigin (see gotchas)
      state/library-store.ts  zustand: model + selection + search; init() wires IPC
      state/player-store.ts    zustand: queue/shuffle/repeat/volume; bridges engine events
      lib/format.ts        time/duration/pluralize/NFC-normalize helpers
      styles/               tokens.css (design system), global.css, keyframes.css, app.css
      components/           Sidebar, TopBar, FolderHero, TrackList/TrackRow, AlbumGrid,
                            NowPlayingBar, SeekBar, VolumeSlider, TransportControls,
                            EmptyState, Cover, PlayingIndicator, Icons
```

---

## ⚠️ Gotchas / landmines (learned the hard way)

- **Never set `crossOrigin` on media loaded from a custom scheme, and don't route it through the
  Web Audio API.** Custom schemes (`media://`) can't satisfy CORS; `audio.crossOrigin='anonymous'`
  forces a CORS request the renderer blocks → MediaError 4 → every track fails. This caused the
  original "fluttering, no sound" bug. Volume is controlled directly via `audio.volume` (perceptual
  `v*v` curve) in `src/renderer/src/audio/engine.ts`.
- **music-metadata and chokidar are ESM-only.** They're loaded via dynamic `await import()` in the
  main process and left **external** (not bundled) by `externalizeDepsPlugin`. Don't `require()` them.
- **Codec reality:** Chromium decodes mp3 / aac(.m4a) / flac / vorbis / opus / wav. It does **NOT**
  decode **ALAC** or **AIFF** (a `.m4a` may be either — distinguished by the parsed container codec).
  Unsupported tracks are flagged `unsupported` (`codecs.ts`) and shown with a "Can't play" badge;
  playback navigation skips them.
- **CSP** is set as an HTTP response header via `session.webRequest.onHeadersReceived` in production
  only; dev relies on the Vite dev server (a strict CSP breaks HMR).
- **Dropbox / cloud libraries:** online-only (non-downloaded) files can't be read until synced
  locally; those tracks will skip.
- Shared types are imported into the renderer with `import type` so they erase at build (the
  `shared/` dir lives outside the renderer root; alias `@shared`).

---

## Commands

```bash
npm run dev          # electron-vite dev (HMR). FOLDERIFY_DEFAULT_ROOT=<dir> launches into a folder (dev only)
npm run build        # type-safe production bundle into out/
npm run typecheck    # tsc on node (main/preload) + web (renderer) projects
npm run build:unpack # build + electron-builder --dir → release/mac-arm64/Folderify.app (unsigned)
npm run build:mac    # build + .dmg (arm64 + x64); needs Developer ID + notarize env for distribution
```

Unsigned local builds open on double-click (no quarantine). For distribution, sign + notarize
(entitlements in `build/entitlements.mac.plist`).

## Config / data location

`~/Library/Application Support/Folderify/` (macOS is case-insensitive, so `folderify`==`Folderify`):
- `folderify-config.json` — the saved root folder
- `folderify-cache.json` — metadata cache (path → mtime/size/tags)
- `thumbs/` — generated album-art thumbnails

Reset via the in-app folder menu → **Disconnect folder**, or delete that directory.

---

## iOS app (Capacitor) — `ios/`, `src/mobile/`, `vite.mobile.config.ts`

The iPhone app reuses the **same React renderer + stores** inside a WKWebView via Capacitor 8
(SPM-based, no CocoaPods). A separate Vite build (`npm run build:mobile` → `dist-mobile/`) bundles a
mobile shell; `npm run ios:sync` copies it into `ios/App/App/public` and `npm run ios:open` opens
Xcode. Build/run on device from Xcode (see the iOS launch notes below).

- **`src/mobile/`** — `MobileApp.tsx` (native-feeling tab shell reusing SeekBar/TransportControls/etc),
  `native-api.ts` (real `window.api` backed by the Swift plugin), `api-stub.ts` (browser fallback),
  `install-api.ts` (picks native vs stub via `Capacitor.isNativePlatform()`). The shell drives the
  shared `library-store`/`player-store` unchanged.
- **Native plugin (`ios/App/App/`)** — the only code with disk access, mirroring the desktop main process:
  - `FolderifyLibraryPlugin.swift` — `pickFolder` (folder picker), `getLibrary` (scan), `forget`.
  - `LibraryAccess.swift` — persists a **security-scoped bookmark** for the picked folder; keeps the
    scope open for the session; path-safety for `media://`; the id→JPEG artwork cache for `cover://`.
  - `LibraryScanner.swift` — recursive audio enumeration + AVFoundation metadata/artwork → the same
    `LibraryModel` (playlists = first path segment; Loose Tracks = `__root__`).
  - `SchemeHandlers.swift` — `media://` (seekable, HTTP **Range**/206) + `cover://` (thumbnail) URL
    scheme handlers, so `mediaUrl()`/`coverUrl()` from `@shared/ipc` resolve exactly as on desktop.
  - `FolderifyBridgeViewController.swift` — a `CAPBridgeViewController` subclass that registers the
    plugin and installs the scheme handlers (wired via `Main.storyboard` Custom Class = `App` module).

### iOS gotchas (learned the hard way)

- **App-embedded plugins are NOT auto-discovered.** Register explicitly with
  `bridge?.registerPluginInstance(...)` in `capacitorDidLoad()`; `jsName` must equal the
  `registerPlugin('FolderifyLibrary')` string. Symptom if missed: *"plugin not implemented on ios"*.
- **Inject scheme handlers via `webViewConfiguration(for:)`** (not `webView(with:)`) — it runs before
  the WKWebView is built. `media`/`cover` are custom schemes; WebKit forbids reusing http/https.
- **iOS bookmarks differ from macOS:** create/resolve with **`[]` options** — `.withSecurityScope` is
  macOS-only and throws on iOS. The picker URL is already security-scoped.
- **Strip `crossorigin`** from the built module `<script>` (the `folderify-strip-crossorigin` Vite
  plugin) — same custom-scheme/CORS rule as desktop, or the WebView shows a black screen.
- **iOS 26 SDK requires UIScene lifecycle** (`SceneDelegate` + `UIApplicationSceneManifest`, TN3187).
- Codec reality is broader than desktop: WebKit on iOS plays ALAC/AIFF/FLAC; only **opus/ogg** are
  flagged `unsupported`.

### iOS commands

```bash
npm run build:mobile   # vite build of the mobile shell → dist-mobile/
npm run ios:sync       # build:mobile + cap sync ios (copies web assets, updates SPM)
npm run ios:open       # open the Xcode project
```

## Known limitations / future work

- Files deleted while the app is **closed** leave orphaned cache entries + thumbnails (the live
  watcher prunes them, a build does not). Harmless; a build-time prune would tidy disk usage.
- Single `<audio>` element — no gapless preloading of the next track.
- Track list uses CSS `content-visibility` for virtualization (no `react-window` yet).
- No custom app icon; unsigned/un-notarized; universal dmg needs per-arch handling.
- Search filters the whole library; no per-folder search scope.
