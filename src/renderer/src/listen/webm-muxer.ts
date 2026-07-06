// Minimal audio-only WebM (Matroska/EBML) muxer for Opus — just enough for
// Chromium's <audio> and MSE ('audio/webm; codecs="opus"'). Zero dependencies, by
// design (no ffmpeg / native modules in this app). Verified by actually playing the
// output in the harness — if you touch this, re-run that test.
//
// Layout: EBML header → Segment( Info, Tracks, Cluster* ). Sizes are computed (no
// unknown-size elements) since we always mux a complete in-memory track.

/** Encoded Opus frame with its timestamp (µs), as WebCodecs hands them out. */
export interface OpusFrame {
  timestampUs: number
  data: Uint8Array
}

// ── EBML primitives ──────────────────────────────────────────────────────────
function vintSize(n: number): number {
  // Size of the length field needed to encode n (data-size VINT).
  for (let bytes = 1; bytes <= 8; bytes++) {
    if (n < 2 ** (7 * bytes) - 1) return bytes
  }
  return 8
}

function writeVint(n: number): Uint8Array {
  const bytes = vintSize(n)
  const out = new Uint8Array(bytes)
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = n & 0xff
    n = Math.floor(n / 256)
  }
  out[0] |= 0x80 >> (bytes - 1) // length marker bit
  return out
}

function writeId(id: number): Uint8Array {
  // Element IDs are stored verbatim (they carry their own length marker).
  const bytes: number[] = []
  let v = id
  while (v > 0) {
    bytes.unshift(v & 0xff)
    v = Math.floor(v / 256)
  }
  return new Uint8Array(bytes)
}

function element(id: number, payload: Uint8Array): Uint8Array {
  const idB = writeId(id)
  const sizeB = writeVint(payload.byteLength)
  const out = new Uint8Array(idB.byteLength + sizeB.byteLength + payload.byteLength)
  out.set(idB, 0)
  out.set(sizeB, idB.byteLength)
  out.set(payload, idB.byteLength + sizeB.byteLength)
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.byteLength
  }
  return out
}

function uintPayload(n: number): Uint8Array {
  const bytes: number[] = []
  do {
    bytes.unshift(n & 0xff)
    n = Math.floor(n / 256)
  } while (n > 0)
  return new Uint8Array(bytes)
}

function floatPayload(n: number): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setFloat64(0, n)
  return new Uint8Array(buf)
}

function stringPayload(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// ── Element IDs (Matroska spec) ──────────────────────────────────────────────
const ID = {
  EBML: 0x1a45dfa3,
  EBMLVersion: 0x4286,
  EBMLReadVersion: 0x42f7,
  EBMLMaxIDLength: 0x42f2,
  EBMLMaxSizeLength: 0x42f3,
  DocType: 0x4282,
  DocTypeVersion: 0x4287,
  DocTypeReadVersion: 0x4285,
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  MuxingApp: 0x4d80,
  WritingApp: 0x5741,
  Duration: 0x4489,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  FlagLacing: 0x9c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  CodecDelay: 0x56aa,
  SeekPreRoll: 0x56bb,
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3
} as const

const CLUSTER_SPAN_MS = 5000

/**
 * Mux encoded Opus frames into a complete WebM file.
 * `codecPrivate` is WebCodecs' decoderConfig.description (the OpusHead) when
 * available — Chromium wants it as CodecPrivate; a standard one is synthesized if
 * the encoder didn't provide it.
 */
export function muxOpusWebm(
  frames: OpusFrame[],
  codecPrivate: Uint8Array | null,
  channels: number,
  durationMs: number
): Uint8Array {
  // OpusHead (RFC 7845 §5.1) fallback: 'OpusHead', v1, ch, preSkip 312, 48kHz, gain 0, family 0.
  let head = codecPrivate
  if (!head || head.byteLength < 19) {
    head = new Uint8Array(19)
    head.set(stringPayload('OpusHead'), 0)
    head[8] = 1
    head[9] = channels
    new DataView(head.buffer).setUint16(10, 312, true) // preSkip
    new DataView(head.buffer).setUint32(12, 48000, true)
  }
  const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true)
  const codecDelayNs = Math.round((preSkip / 48000) * 1e9)

  const ebmlHeader = element(
    ID.EBML,
    concat([
      element(ID.EBMLVersion, uintPayload(1)),
      element(ID.EBMLReadVersion, uintPayload(1)),
      element(ID.EBMLMaxIDLength, uintPayload(4)),
      element(ID.EBMLMaxSizeLength, uintPayload(8)),
      element(ID.DocType, stringPayload('webm')),
      element(ID.DocTypeVersion, uintPayload(4)),
      element(ID.DocTypeReadVersion, uintPayload(2))
    ])
  )

  const info = element(
    ID.Info,
    concat([
      element(ID.TimecodeScale, uintPayload(1_000_000)), // 1ms ticks
      element(ID.MuxingApp, stringPayload('Folderify')),
      element(ID.WritingApp, stringPayload('Folderify')),
      element(ID.Duration, floatPayload(Math.max(durationMs, 1)))
    ])
  )

  const tracks = element(
    ID.Tracks,
    element(
      ID.TrackEntry,
      concat([
        element(ID.TrackNumber, uintPayload(1)),
        element(ID.TrackUID, uintPayload(1)),
        element(ID.TrackType, uintPayload(2)), // audio
        element(ID.FlagLacing, uintPayload(0)),
        element(ID.CodecID, stringPayload('A_OPUS')),
        element(ID.CodecDelay, uintPayload(codecDelayNs)),
        element(ID.SeekPreRoll, uintPayload(80_000_000)),
        element(ID.CodecPrivate, head),
        element(
          ID.Audio,
          concat([
            element(ID.SamplingFrequency, floatPayload(48000)),
            element(ID.Channels, uintPayload(channels))
          ])
        )
      ])
    )
  )

  // Clusters of SimpleBlocks. Block timecodes are int16 ms relative to the cluster.
  const clusters: Uint8Array[] = []
  let clusterStartMs = -1
  let clusterBlocks: Uint8Array[] = []
  const flushCluster = (): void => {
    if (clusterStartMs < 0 || clusterBlocks.length === 0) return
    clusters.push(
      element(
        ID.Cluster,
        concat([element(ID.Timecode, uintPayload(clusterStartMs)), ...clusterBlocks])
      )
    )
    clusterBlocks = []
  }
  for (const f of frames) {
    const tMs = Math.round(f.timestampUs / 1000)
    if (clusterStartMs < 0 || tMs - clusterStartMs > CLUSTER_SPAN_MS) {
      flushCluster()
      clusterStartMs = tMs
    }
    const rel = tMs - clusterStartMs
    const blockPayload = new Uint8Array(4 + f.data.byteLength)
    blockPayload[0] = 0x81 // track number 1 (VINT)
    new DataView(blockPayload.buffer).setInt16(1, rel)
    blockPayload[3] = 0x80 // keyframe flag (every Opus frame is one)
    blockPayload.set(f.data, 4)
    clusterBlocks.push(element(ID.SimpleBlock, blockPayload))
  }
  flushCluster()

  const segment = element(ID.Segment, concat([info, tracks, ...clusters]))
  return concat([ebmlHeader, segment])
}
