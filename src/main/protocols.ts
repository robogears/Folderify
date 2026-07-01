import { protocol } from 'electron'
import { promises as fs, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { join, extname } from 'node:path'
import { PROTOCOL } from '../shared/ipc'
import { safeResolveUnder } from './path-safety'
import { thumbPath, type ThumbSize } from './thumbnails'

/** Must run BEFORE app 'ready'. */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: PROTOCOL.MEDIA,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    },
    {
      scheme: PROTOCOL.COVER,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    },
    {
      scheme: PROTOCOL.APP,
      privileges: { standard: true, secure: true, supportFetchAPI: true }
    }
  ])
}

interface HandlerDeps {
  getRoot: () => string | null
  rendererDist: string
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json'
}

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.m4b': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.aifc': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.webm': 'audio/webm',
  '.weba': 'audio/webm',
  '.caf': 'audio/x-caf',
  '.mka': 'audio/x-matroska'
}

function audioMime(filePath: string): string {
  return AUDIO_MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function placeholderResponse(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#272338"/>
      <stop offset="1" stop-color="#14121d"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#g)"/>
  <g fill="#5a5470" opacity="0.85">
    <path d="M150 70v74.4a26 26 0 1 0 12 21.9V104l34 9.4V92.2L150 70z"/>
  </g>
</svg>`
  return new Response(svg, {
    headers: { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' }
  })
}

export function registerProtocolHandlers({ getRoot, rendererDist }: HandlerDeps): void {
  // media:// — stream seekable audio bytes from a path inside the library root.
  // We read from disk directly (not net.fetch) and implement HTTP Range ourselves
  // so seeking works and only the requested bytes are read. CORS headers make the
  // stream "clean" so it can be routed through the Web Audio graph for volume.
  protocol.handle(PROTOCOL.MEDIA, async (request) => {
    const root = getRoot()
    if (!root) return new Response('No library', { status: 404 })

    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      return new Response('Bad URL', { status: 400 })
    }
    const filePath = safeResolveUnder(root, pathname)
    if (!filePath) return new Response('Forbidden', { status: 403 })

    let size: number
    try {
      const st = await fs.stat(filePath)
      if (!st.isFile()) return new Response('Not a file', { status: 404 })
      size = st.size
    } catch {
      return new Response('Not found', { status: 404 })
    }

    const type = audioMime(filePath)
    const baseHeaders: Record<string, string> = {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    }

    const rangeHeader = request.headers.get('range')
    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
      let start = match && match[1] ? parseInt(match[1], 10) : 0
      let end = match && match[2] ? parseInt(match[2], 10) : size - 1
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= size) end = size - 1
      if (start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${size}` }
        })
      }
      const nodeStream = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
        status: 206,
        headers: {
          ...baseHeaders,
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1)
        }
      })
    }

    const nodeStream = createReadStream(filePath)
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 200,
      headers: { ...baseHeaders, 'Content-Length': String(size) }
    })
  })

  // cover:// — serve a thumbnail, or a generated placeholder.
  protocol.handle(PROTOCOL.COVER, async (request) => {
    const url = new URL(request.url)
    const id = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const size: ThumbSize = url.searchParams.get('s') === 'lg' ? 'lg' : 'sm'
    if (id && id !== 'placeholder') {
      try {
        const buf = await fs.readFile(thumbPath(id, size))
        return new Response(buf, {
          headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000, immutable' }
        })
      } catch {
        // No thumbnail on disk — fall through to placeholder.
      }
    }
    return placeholderResponse()
  })

  // app:// — serve the built renderer in production (never file://).
  protocol.handle(PROTOCOL.APP, async (request) => {
    let pathname = decodeURIComponent(new URL(request.url).pathname)
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const safe = safeResolveUnder(rendererDist, join(rendererDist, pathname))
    if (!safe) return new Response('Forbidden', { status: 403 })
    try {
      const buf = await fs.readFile(safe)
      const type = CONTENT_TYPES[extname(safe).toLowerCase()] ?? 'application/octet-stream'
      return new Response(buf, { headers: { 'content-type': type } })
    } catch {
      try {
        const buf = await fs.readFile(join(rendererDist, 'index.html'))
        return new Response(buf, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    }
  })
}
