// Thin wrapper over a single RTCPeerConnection with ONE data channel that carries
// both JSON control messages (strings) and binary audio chunks (ArrayBuffers). Using
// one channel means WebRTC's in-order guarantee covers control ↔ media ordering, so a
// `load` message can never arrive after the bytes it describes. Every binary frame is
// TAGGED with a 4-byte LE transferId header so a live track and background prefetches
// can interleave on the same channel. SDP/ICE flow through the `sendSignal` callback
// (relayed by main to the peer); DTLS encrypts everything.

import { LISTEN_CHUNK_SIZE, LISTEN_FRAME_HEADER, type SignalPayload } from '@shared/listen'

export interface PeerHandlers {
  onControl: (msg: unknown) => void
  /** A demuxed binary frame: which transfer it belongs to + the payload bytes. */
  onBytes: (transferId: number, buf: ArrayBuffer) => void
  onOpen: () => void
  /** reason: 'failed' | 'closed' | 'channel-closed' — surfaced to the user. */
  onClose: (reason?: string) => void
}

const BUFFER_HIGH = 8 * 1024 * 1024
const BUFFER_LOW = 1 * 1024 * 1024

export class ListenPeerConn {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private closed = false
  private remoteDescSet = false
  private pendingIce: RTCIceCandidateInit[] = []

  constructor(
    private role: 'caller' | 'callee',
    private sendSignal: (p: SignalPayload) => void,
    private handlers: PeerHandlers
  ) {
    // No STUN/TURN: on a LAN, host ICE candidates connect directly.
    this.pc = new RTCPeerConnection({ iceServers: [] })
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({
          kind: 'ice',
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex
        })
      }
    }
    this.pc.oniceconnectionstatechange = () => {
      console.info('[listen] ICE state:', this.pc.iceConnectionState)
    }
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState
      console.info('[listen] connection state:', st)
      // 'disconnected' is often transient (ICE can recover) — only give up on a hard
      // failure or an explicit close.
      if (st === 'failed') this.handleClose('failed')
      else if (st === 'closed') this.handleClose('closed')
    }
    // Callee receives the channel the caller created.
    this.pc.ondatachannel = (e) => this.bindChannel(e.channel)
  }

  async start(): Promise<void> {
    if (this.role !== 'caller') return // callee waits for the offer via handleSignal
    const dc = this.pc.createDataChannel('folderify', { ordered: true })
    this.bindChannel(dc)
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.sendSignal({ kind: 'sdp', type: 'offer', sdp: offer.sdp ?? '' })
  }

  private bindChannel(dc: RTCDataChannel): void {
    this.dc = dc
    dc.binaryType = 'arraybuffer'
    dc.bufferedAmountLowThreshold = BUFFER_LOW
    dc.onopen = () => {
      console.info('[listen] data channel open')
      this.handlers.onOpen()
    }
    dc.onclose = () => this.handleClose('channel-closed')
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          this.handlers.onControl(JSON.parse(e.data))
        } catch {
          /* ignore malformed control frame */
        }
      } else if (e.data instanceof ArrayBuffer) {
        // Demux: 4-byte LE transferId header, then the payload.
        if (e.data.byteLength <= LISTEN_FRAME_HEADER) return
        const id = new DataView(e.data).getUint32(0, true)
        this.handlers.onBytes(id, e.data.slice(LISTEN_FRAME_HEADER))
      }
    }
  }

  async handleSignal(p: SignalPayload): Promise<void> {
    try {
      if (p.kind === 'sdp') {
        await this.pc.setRemoteDescription({ type: p.type, sdp: p.sdp })
        this.remoteDescSet = true
        // Flush any ICE candidates that arrived before the remote description.
        const queued = this.pendingIce.splice(0)
        for (const c of queued) {
          try {
            await this.pc.addIceCandidate(c)
          } catch (err) {
            console.error('[listen] queued ICE add failed:', err)
          }
        }
        if (p.type === 'offer') {
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          this.sendSignal({ kind: 'sdp', type: 'answer', sdp: answer.sdp ?? '' })
        }
      } else if (p.kind === 'ice') {
        const cand: RTCIceCandidateInit = {
          candidate: p.candidate,
          sdpMid: p.sdpMid,
          sdpMLineIndex: p.sdpMLineIndex
        }
        // addIceCandidate throws if called before setRemoteDescription — queue instead,
        // or a dropped candidate can silently prevent the connection.
        if (!this.remoteDescSet) {
          this.pendingIce.push(cand)
          return
        }
        await this.pc.addIceCandidate(cand)
      }
    } catch (err) {
      console.error('[listen] signal handling error:', err)
    }
  }

  /** Send a JSON control message. */
  send(msg: unknown): void {
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(msg))
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * Send binary bytes for one transfer, split into SCTP-safe framed chunks with
   * backpressure. `shouldAbort` is checked between chunks so a background prefetch
   * can be preempted mid-stream by a user-picked track.
   * Returns 'sent' | 'aborted' | 'closed'.
   */
  async sendBytes(
    transferId: number,
    data: Uint8Array,
    shouldAbort?: () => boolean
  ): Promise<'sent' | 'aborted' | 'closed'> {
    for (let off = 0; off < data.byteLength; off += LISTEN_CHUNK_SIZE) {
      if (shouldAbort?.()) return 'aborted'
      if (!this.dc || this.dc.readyState !== 'open') return 'closed'
      if (this.dc.bufferedAmount > BUFFER_HIGH) await this.waitForDrain()
      if (shouldAbort?.()) return 'aborted'
      if (!this.dc || this.dc.readyState !== 'open') return 'closed'
      const end = Math.min(off + LISTEN_CHUNK_SIZE, data.byteLength)
      const frame = new Uint8Array(LISTEN_FRAME_HEADER + (end - off))
      new DataView(frame.buffer).setUint32(0, transferId, true)
      frame.set(data.subarray(off, end), LISTEN_FRAME_HEADER)
      try {
        this.dc.send(frame)
      } catch {
        return 'closed'
      }
    }
    return 'sent'
  }

  private waitForDrain(): Promise<void> {
    return new Promise((resolve) => {
      const dc = this.dc
      // Already gone/closed → resolve now; sendBytes re-checks readyState after us.
      if (!dc || dc.readyState !== 'open') return resolve()
      // Resolve on drain OR channel close — otherwise a peer that disconnects while the
      // buffer is full leaves this promise (and the source's stream loop) hung forever.
      const done = (): void => {
        dc.removeEventListener('bufferedamountlow', done)
        dc.removeEventListener('close', done)
        resolve()
      }
      dc.addEventListener('bufferedamountlow', done)
      dc.addEventListener('close', done)
    })
  }

  private handleClose(reason?: string): void {
    if (this.closed) return
    this.closed = true
    this.handlers.onClose(reason)
  }

  close(): void {
    this.closed = true
    try {
      this.dc?.close()
    } catch {
      /* ignore */
    }
    try {
      this.pc.close()
    } catch {
      /* ignore */
    }
  }
}
