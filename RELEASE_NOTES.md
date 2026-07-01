# What's new in v0.1.1

Folderify's first public build — a macOS music player where **your folders are your playlists**. Point it at a folder and every subfolder becomes a playlist, live-synced from disk. It's strictly read-only: it never moves, renames, or changes your files.

## Library & playback
- Your chosen folder is your library; each immediate subfolder is a playlist, built by scanning the tree recursively and watched live so changes on disk appear instantly.
- Reads embedded tags and album art (title / artist / album / artwork), with graceful fallback to filenames when tags are missing.
- Full player: play/pause, seek, volume, next/previous, shuffle, repeat, and a persistent now-playing bar. Plays MP3, AAC (.m4a), FLAC, OGG/Vorbis, Opus, and WAV; formats Chromium can't decode (ALAC, AIFF) are flagged "Can't play" and skipped.

## Layouts & settings
- Five layouts in Settings: **Default**, **Compact**, **Cover**, **Clean 01** (a bright, airy light theme), and **Clean 02** (a dark "listening room" with a slim icon rail and a large right-hand now-playing art panel).
- Collapsible sidebar, and a "resume last track on launch" option.

## Menu-bar mini player
- A menu-bar icon opens a popover with album art, transport controls, a seek bar, and volume — kept in sync with the main window.

---

# Install

- **macOS (Apple Silicon)**: download `Folderify-0.1.1-arm64.dmg`, open it, and drag Folderify to Applications.
- **macOS (Intel)**: download `Folderify-0.1.1-x64.dmg`.

This build is unsigned and un-notarized, so on first launch macOS Gatekeeper will refuse to open it — **right-click the app → Open**, then confirm. You only need to do this once.

Your settings, metadata cache, and album-art thumbnails live in `~/Library/Application Support/Folderify/`.

## Requirements

- macOS 11 (Big Sur) or later.
- No account, API key, or subscription — Folderify only reads local audio files. Cloud files that aren't downloaded locally (e.g. Dropbox online-only) must be synced to disk before they can play.

---

**Full Changelog**: https://github.com/robogears/Folderify/commits/v0.1.1
