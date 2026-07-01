// The set of audio file extensions Folderify recognizes as "tracks".
// Lowercased, including the leading dot. Used by both the recursive scanner
// and the chokidar watcher's ignore filter.
export const AUDIO_EXTENSIONS = [
  '.mp3',
  '.m4a',
  '.m4b',
  '.aac',
  '.mp4',
  '.flac',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.wave',
  '.aif',
  '.aiff',
  '.aifc',
  '.wma',
  '.wv',
  '.ape',
  '.mpc',
  '.dsf',
  '.dff',
  '.alac',
  '.caf',
  '.mka',
  '.webm'
] as const

export const AUDIO_EXT = new Set<string>(AUDIO_EXTENSIONS)

// Containers/codecs Chromium (and therefore Electron) cannot decode. We still
// list these files, but mark them non-playable so the UI can show why.
// Note: a `.m4a` may be AAC (playable) or ALAC (not) — that distinction is made
// from the parsed container codec during metadata extraction, not the extension.
export const UNSUPPORTED_EXT = new Set<string>(['.aif', '.aiff', '.aifc', '.wma', '.ape', '.mpc', '.dsf', '.dff', '.wv', '.alac'])

export function isAudioFile(filename: string): boolean {
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXT.has(filename.slice(dot).toLowerCase())
}
