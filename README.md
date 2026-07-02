<div align="center">

# Folderify

**Your folders, played like Spotify.**

A macOS music player where the folder you pick is your library, and every subfolder inside it is a playlist — automatically. A strict, read-only mirror of your filesystem: nothing is ever moved, renamed, or deleted.

</div>

---

## The idea

- **Library** = every audio file found recursively under the folder you choose.
- **Playlist** = each immediate subfolder. Drop a folder into your music folder and it shows up as a playlist instantly.
- **Read-only.** Folderify only ever reads your files and writes to its own data directory (config, metadata cache, thumbnails). Your music folder is the single source of truth — scanned at launch and watched live while running.

## Features

- 🎵 Rich metadata + embedded album art (with folder-image and filename fallbacks)
- ▶️ Full playback: play/pause, seek, volume, next/prev, shuffle, repeat, resume-on-launch
- 🗂️ Folders → playlists, live-synced from disk (add/remove in Finder, see it immediately)
- 🎨 Five layouts — Default, Compact, Cover, **Clean 01** (light) and **Clean 02** (dark "listening room")
- 🔊 A menu-bar mini-player (art, seek bar, transport, volume) synced with the app
- 🔄 An in-app updater — one click downloads the new version and installs itself
- 📱 An iPhone app is in the works (same UI, native folder access via Capacitor — in this repo under `ios/`)

Plays MP3, AAC (.m4a), FLAC, OGG/Vorbis, Opus, and WAV. ALAC and AIFF can't be decoded by the underlying engine and are flagged rather than played.

## Install

Grab the latest `Folderify-<version>-arm64.dmg` from [Releases](https://github.com/robogears/Folderify/releases) (Apple Silicon), open it, and drag Folderify to Applications.

Builds are ad-hoc signed but not notarized, so macOS holds the app back on first launch — once only:
- **macOS 15+**: try to open it, then **System Settings → Privacy & Security → Open Anyway**.
- Older macOS: right-click the app → **Open**.

After that, updates install themselves from inside the app — no dmg needed.

## Build from source

```bash
npm install
npm run dev          # run in development (HMR)
npm run build:unpack # produce release/mac-arm64/Folderify.app (ad-hoc signed)
npm run build:mac    # produce the arm64 .dmg
```

Requires Node 20.19+ / 22+ and an Apple Silicon Mac for packaged builds.

## Tech

Electron + React + TypeScript, built with electron-vite. No native modules (metadata via `music-metadata`, thumbnails via Electron's `nativeImage`, cache as JSON). Audio streams from disk through a custom `media://` protocol with HTTP Range support. The iPhone app reuses the same React UI inside a WKWebView via Capacitor 8, with a small Swift plugin for folder access and scanning. See [CLAUDE.md](CLAUDE.md) for the full architecture.

## Data location

`~/Library/Application Support/Folderify/` — the saved root folder, metadata cache, and thumbnails. Delete it to reset.

## License

[MIT](LICENSE)
