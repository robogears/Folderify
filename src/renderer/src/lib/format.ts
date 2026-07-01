/** mm:ss or h:mm:ss */
export function formatTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/** "1 hr 23 min" / "23 min" / "45 sec" */
export function formatDurationLong(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return '0 min'
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return `${h} hr ${m} min`
  if (m > 0) return `${m} min`
  return `${total} sec`
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`
}

/** macOS stores filenames as NFD; normalize to NFC for matching/search. */
export function normalizeSearch(s: string): string {
  return s.normalize('NFC').toLowerCase().trim()
}
