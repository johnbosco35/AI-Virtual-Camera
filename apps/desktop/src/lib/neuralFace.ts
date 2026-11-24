import { websocketUrl } from '@/lib/engine';
import type { FaceCrop } from '@/lib/faceCrop';

/**
 * Client for the engine's neural reenactment stream (/ws/face, LivePortrait). Sends the portrait crop once,
 * the user's neutral crop, then live crops; keeps the newest animated face for the renderer.
 * At most one live frame is in flight, so the face never lags behind by more than one inference.
 */

const TAG_SOURCE = 1, TAG_NEUTRAL = 2, TAG_FRAME = 3;

export interface NeuralFrame {
  bitmap: ImageBitmap;
  /** Where the face goes in the portrait (the portrait's own crop). */
  crop: FaceCrop;
  seq: number;
}

export class NeuralFaceClient {
  private socket: WebSocket | null = null;
  private seq = 0;
  private inFlight = false;
  private sourceCrop: FaceCrop | null = null;
  private hasNeutral = false;
  latest: NeuralFrame | null = null;
  device: string | null = null;
  stats = { fps: 0, ms: null as number | null };
  error: string | null = null;
  onChange: (() => void) | null = null;

  get ready() {
    return this.socket?.readyState === WebSocket.OPEN && this.device !== null && this.sourceCrop !== null && this.hasNeutral;
  }

  async connect(gains: { expression: number; head: number }) {
    this.close();
    const socket = new WebSocket(await websocketUrl('/ws/face'));
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => socket.send(JSON.stringify({ type: 'start', expressionGain: gains.expression, headGain: gains.head }));
      socket.onerror = () => reject(new Error('The AI engine could not be reached for neural animation.'));
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.type === 'ready') { this.device = message.device; resolve(); }
          else if (message.type === 'stats') this.stats = { fps: message.fps, ms: message.ms };
          else if (message.type === 'error') { this.error = message.message; if (!this.device) reject(new Error(message.message)); }
          this.onChange?.();
          return;
        }
        const data = new Uint8Array(event.data as ArrayBuffer);
        if (data[0] !== TAG_FRAME || !this.sourceCrop) return;
        const seq = new DataView(data.buffer, 1, 4).getUint32(0, true);
        const crop = this.sourceCrop;
        this.inFlight = false;
        void createImageBitmap(new Blob([data.subarray(5)], { type: 'image/jpeg' })).then((bitmap) => {
          if (this.latest && this.latest.seq > seq) { bitmap.close(); return; }
          this.latest?.bitmap.close();
          this.latest = { bitmap, crop, seq };
        });
      };
      socket.onclose = () => { if (this.socket === socket) { this.socket = null; this.device = null; this.onChange?.(); } };
    });
  }

  private sendTagged(tag: number, jpeg: ArrayBuffer, seq?: number) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    const head = seq === undefined ? 1 : 5;
    const out = new Uint8Array(head + jpeg.byteLength);
    out[0] = tag;
    if (seq !== undefined) new DataView(out.buffer).setUint32(1, seq, true);
    out.set(new Uint8Array(jpeg), head);
    socket.send(out);
    return true;
  }

  async setSource(jpeg: Blob, crop: FaceCrop) {
    if (this.sendTagged(TAG_SOURCE, await jpeg.arrayBuffer())) this.sourceCrop = crop;
  }

  async setNeutral(jpeg: Blob) {
    if (this.sendTagged(TAG_NEUTRAL, await jpeg.arrayBuffer())) this.hasNeutral = true;
  }

  /** True when a new live frame would be accepted now. */
  get canSend() {
    return this.ready && !this.inFlight;
  }

  async sendFrame(jpeg: Blob) {
    if (!this.canSend) return;
    this.inFlight = true;
    this.seq += 1;
    if (!this.sendTagged(TAG_FRAME, await jpeg.arrayBuffer(), this.seq)) this.inFlight = false;
  }

  setGains(gains: { expression: number; head: number }) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'gains', expressionGain: gains.expression, headGain: gains.head }));
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.device = null;
    this.inFlight = false;
    this.hasNeutral = false;
    this.latest?.bitmap.close();
    this.latest = null;
    if (socket) {
      socket.onclose = null;
      try { socket.send(JSON.stringify({ type: 'stop' })); } catch { /* closing */ }
      socket.close();
    }
  }
}
