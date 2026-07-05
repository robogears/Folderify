// Low-level audio engine: a single HTMLAudioElement streaming compressed bytes
// from the media:// protocol, so memory stays flat regardless of track length.
//
// NOTE: we deliberately do NOT use the Web Audio API (createMediaElementSource)
// or set crossOrigin. Custom schemes like media:// cannot do CORS, and routing
// cross-origin media through a Web Audio graph would taint it to silence. Volume
// is controlled directly on the element with a perceptual curve.

export interface EngineHandlers {
  onTime: (seconds: number) => void
  onDuration: (seconds: number) => void
  onEnded: () => void
  onPlay: () => void
  onPause: () => void
  onError: (message: string) => void
}

class AudioEngine {
  private audio: HTMLAudioElement
  private handlers: Partial<EngineHandlers> = {}
  private durationFixTried = false
  private rafId = 0
  private lastEmit = 0

  constructor() {
    this.audio = new Audio()
    this.audio.preload = 'auto'

    this.audio.addEventListener('durationchange', () => this.handleDuration())
    this.audio.addEventListener('loadedmetadata', () => this.handleDuration())
    this.audio.addEventListener('ended', () => this.handlers.onEnded?.())
    this.audio.addEventListener('play', () => {
      this.handlers.onPlay?.()
      this.startRaf()
    })
    this.audio.addEventListener('pause', () => {
      this.handlers.onPause?.()
      this.stopRaf()
    })
    this.audio.addEventListener('error', () => {
      this.stopRaf()
      const code = this.audio.error?.code
      this.handlers.onError?.(`Could not play this track (code ${code ?? '?'})`)
    })
  }

  setHandlers(h: Partial<EngineHandlers>): void {
    this.handlers = h
  }

  private handleDuration(): void {
    const d = this.audio.duration
    if (Number.isFinite(d) && d > 0) {
      this.handlers.onDuration?.(d)
    } else if (d === Infinity && !this.durationFixTried) {
      // Some VBR streams report Infinity until you seek to the end once.
      this.durationFixTried = true
      const onSeeked = (): void => {
        this.audio.removeEventListener('seeked', onSeeked)
        this.audio.currentTime = 0
        const real = this.audio.duration
        if (Number.isFinite(real) && real > 0) this.handlers.onDuration?.(real)
      }
      this.audio.addEventListener('seeked', onSeeked)
      try {
        this.audio.currentTime = 1e101
      } catch {
        /* ignore */
      }
    }
  }

  load(url: string): void {
    this.durationFixTried = false
    this.audio.src = url
    this.audio.load()
  }

  /**
   * Play audio from a blob:/object URL (Listen Together receiver mode) instead of a
   * media:// path — the bytes arrived over the network, not from local disk. Seeks to
   * startTime and optionally autoplays once metadata is ready.
   */
  loadRemote(url: string, startTime: number, autoplay: boolean): void {
    this.durationFixTried = false
    this.audio.src = url
    this.audio.load()
    const onMeta = (): void => {
      this.audio.removeEventListener('loadedmetadata', onMeta)
      if (startTime > 0) {
        try {
          this.audio.currentTime = startTime
        } catch {
          /* ignore */
        }
      }
      if (autoplay) void this.play()
    }
    this.audio.addEventListener('loadedmetadata', onMeta)
  }

  /** Load a track WITHOUT playing, seeking to startTime once metadata is ready. */
  prepare(url: string, startTime: number): void {
    this.durationFixTried = false
    this.audio.src = url
    this.audio.load()
    if (startTime > 0) {
      const onMeta = (): void => {
        this.audio.removeEventListener('loadedmetadata', onMeta)
        try {
          this.audio.currentTime = startTime
          this.handlers.onTime?.(this.audio.currentTime)
        } catch {
          /* ignore */
        }
      }
      this.audio.addEventListener('loadedmetadata', onMeta)
    }
  }

  async play(): Promise<void> {
    try {
      await this.audio.play()
    } catch {
      // Autoplay rejection or load error — surface as a pause.
      this.handlers.onPause?.()
    }
  }

  pause(): void {
    this.audio.pause()
  }

  seek(seconds: number): void {
    if (Number.isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, seconds)
      this.handlers.onTime?.(this.audio.currentTime)
    }
  }

  /** Set volume from a 0..1 linear slider value, applying a perceptual curve. */
  setVolume(linear: number): void {
    const clamped = Math.max(0, Math.min(1, linear))
    this.audio.volume = clamped * clamped
  }

  get currentTime(): number {
    return this.audio.currentTime
  }

  private startRaf(): void {
    this.stopRaf()
    const tick = (): void => {
      const now = performance.now()
      if (now - this.lastEmit > 33) {
        this.lastEmit = now
        this.handlers.onTime?.(this.audio.currentTime)
      }
      this.rafId = requestAnimationFrame(tick)
    }
    this.rafId = requestAnimationFrame(tick)
  }

  private stopRaf(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = 0
    }
  }
}

export const engine = new AudioEngine()
