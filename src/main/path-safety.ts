import { resolve, relative, isAbsolute } from 'node:path'

/** True if `target` is the same as, or nested under, `root`. */
export function isInside(root: string, target: string): boolean {
  const r = resolve(root)
  const t = resolve(target)
  if (t === r) return true
  const rel = relative(r, t)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Resolve a caller-supplied absolute path and assert it stays under `root`.
 * Returns the normalized absolute path, or null if it escapes the root
 * (path-traversal guard for the media:// protocol).
 */
export function safeResolveUnder(root: string, candidateAbsPath: string): string | null {
  const resolved = resolve(candidateAbsPath)
  return isInside(root, resolved) ? resolved : null
}
