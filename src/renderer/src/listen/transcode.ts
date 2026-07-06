// Transfer transcoding for Listen Together: re-encode LOSSLESS tracks (flac/wav) to
// Opus ~192 kbps in a WebM container before streaming to the peer — 8-10× smaller on
// the wire AND MSE-streamable ('audio/webm; codecs="opus"'), so playback starts after
// ~1s of buffer instead of after the whole file. Runs entirely in memory on the SOURCE
// (the library file is never touched — read-only invariant). Already-lossy formats
// (mp3/aac/ogg) pass through untouched: re-encoding them costs quality for ~no size win.
//
// Pipeline: decodeAudioData (any Chromium-supported container → PCM; no media element,
// so the crossOrigin/tainting gotcha does NOT apply) → WebCodecs AudioEncoder (Opus,
// built into Chromium, faster than realtime) → hand-rolled WebM muxer (webm-muxer.ts).
// Every step feature-checked; ANY failure returns null and the caller falls back to
// sending the original bytes.

import { muxOpusWebm, type OpusFrame } from './webm-muxer'

const OPUS_BITRATE = 192_000
const SAMPLE_RATE = 48_000 // Opus native; decodeAudioData resamples to the context rate
/** Feed the encoder in ~1s slices to bound peak AudioData allocations. */
const SLICE_FRAMES = 48_000

/** Extensions worth transcoding: lossless, large, and decodable by Chromium. */
export function shouldTranscode(ext: string): boolean {
  return ext === 'flac' || ext === 'wav' || ext === 'wave'
}

export async function transcodeToOpusWebm(input: ArrayBuffer): Promise<Uint8Array | null> {
  try {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') return null

    // Decode to PCM at 48kHz. decodeAudioData detaches the buffer — pass a copy.
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: SAMPLE_RATE })
    const decoded = await ctx.decodeAudioData(input.slice(0))
    const channels = Math.min(decoded.numberOfChannels, 2)
    const totalFrames = decoded.length
    if (totalFrames === 0) return null

    const config: AudioEncoderConfig = {
      codec: 'opus',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: channels,
      bitrate: OPUS_BITRATE
    }
    const support = await AudioEncoder.isConfigSupported(config)
    if (!support.supported) return null

    const frames: OpusFrame[] = []
    let codecPrivate: Uint8Array | null = null
    let encodeError: unknown = null
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        const desc = meta?.decoderConfig?.description
        if (desc && !codecPrivate) {
          // `description` is AllowSharedBufferSource (ArrayBuffer(Like) | ArrayBufferView).
          // Narrow via ArrayBuffer.isView so the copy works for both, and cast the
          // possibly-shared backing buffer to ArrayBuffer for the Uint8Array ctor.
          if (ArrayBuffer.isView(desc)) {
            codecPrivate = new Uint8Array(
              desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength) as ArrayBuffer
            )
          } else {
            codecPrivate = new Uint8Array((desc as ArrayBufferLike).slice(0) as ArrayBuffer)
          }
        }
        const data = new Uint8Array(chunk.byteLength)
        chunk.copyTo(data)
        frames.push({ timestampUs: chunk.timestamp, data })
      },
      error: (e) => {
        encodeError = e
      }
    })
    encoder.configure(config)

    // Feed planar f32 slices with real timestamps (µs).
    const channelData: Float32Array[] = []
    for (let c = 0; c < channels; c++) channelData.push(decoded.getChannelData(c))
    for (let off = 0; off < totalFrames; off += SLICE_FRAMES) {
      const n = Math.min(SLICE_FRAMES, totalFrames - off)
      const planar = new Float32Array(n * channels)
      for (let c = 0; c < channels; c++) planar.set(channelData[c].subarray(off, off + n), c * n)
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: SAMPLE_RATE,
        numberOfFrames: n,
        numberOfChannels: channels,
        timestamp: Math.round((off / SAMPLE_RATE) * 1e6),
        data: planar
      })
      encoder.encode(ad)
      ad.close()
      if (encodeError) break
    }
    await encoder.flush()
    encoder.close()
    if (encodeError || frames.length === 0) return null

    const durationMs = Math.round((totalFrames / SAMPLE_RATE) * 1000)
    return muxOpusWebm(frames, codecPrivate, channels, durationMs)
  } catch (err) {
    console.warn('[listen] transcode failed, sending original bytes:', err)
    return null
  }
}
