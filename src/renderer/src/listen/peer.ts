// Thin wrapper over a single RTCPeerConnection with ONE data channel that carries
// both JSON control messages (strings) and binary audio chunks (ArrayBuffers). Using
// one channel means WebRTC's in-order guarantee covers control ↔ media ordering, so a
// `load` message can never arrive after the bytes it describes. SDP/ICE flow through
// the `sendSignal` callback (relayed by main to the peer); DTLS encrypts everything.

import { LISTEN_CHUNK_SIZE, type SignalPayload } from '@shared/listen'

export interface PeerHandlers {
  onControl: (msg: unknown) => void
  onBytes: (buf: ArrayBuffer) => void
  onOpen: () => void
  onClose: () => void
}

const BUFFER_HIGH = 8 * 1024 * 1024
const BUFFER_LOW = 1 * 1024 * 1024

export class ListenPeerConn {
  private pc: RTCPeerConnection
  private dc: RTCDataChannel | null = null
  private closed = false

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
    this.pc.onconnectionstatechange = () => {
      const st = this.pc.connectionState
      if (st === 'failed' || st === 'disconnected' || st === 'closed') this.handleClose()
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
    dc.onopen = () => this.handlers.onOpen()
    dc.onclose = () => this.handleClose()
    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        try {
          this.handlers.onControl(JSON.parse(e.data))
        } catch {
          /* ignore malformed control frame */
        }
      } else if (e.data instanceof ArrayBuffer) {
        this.handlers.onBytes(e.data)
      }
    }
  }

  async handleSignal(p: SignalPayload): Promise<void> {
    try {
      if (p.kind === 'sdp') {
        await this.pc.setRemoteDescription({ type: p.type, sdp: p.sdp })
        if (p.type === 'offer') {
          const answer = await this.pc.createAnswer()
          await this.pc.setLocalDescription(answer)
          this.sendSignal({ kind: 'sdp', type: 'answer', sdp: answer.sdp ?? '' })
        }
      } else if (p.kind === 'ice') {
        await this.pc.addIceCandidate({
          candidate: p.candidate,
          sdpMid: p.sdpMid,
          sdpMLineIndex: p.sdpMLineIndex
        })
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

  /** Send binary audio, split into SCTP-safe chunks with backpressure. */
  async sendBytes(data: Uint8Array): Promise<void> {
    for (let off = 0; off < data.byteLength; off += LISTEN_CHUNK_SIZE) {
      if (!this.dc || this.dc.readyState !== 'open') return
      if (this.dc.bufferedAmount > BUFFER_HIGH) await this.waitForDrain()
      if (!this.dc || this.dc.readyState !== 'open') return
      const end = Math.min(off + LISTEN_CHUNK_SIZE, data.byteLength)
      try {
        this.dc.send(data.slice(off, end))
      } catch {
        return
      }
    }
  }

  private waitForDrain(): Promise<void> {
    return new Promise((resolve) => {
      const dc = this.dc
      if (!dc) return resolve()
      const onLow = (): void => {
        dc.removeEventListener('bufferedamountlow', onLow)
        resolve()
      }
      dc.addEventListener('bufferedamountlow', onLow)
    })
  }

  private handleClose(): void {
    if (this.closed) return
    this.closed = true
    this.handlers.onClose()
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
