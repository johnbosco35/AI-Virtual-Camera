import { websocketUrl } from '@/lib/engine';

/**
 * Sends the studio's final output frames to the engine, which writes them into the installed virtual
 * camera driver (see apps/engine/controllers/virtual_camera_controller.py) as I420 converted on the GPU.
 * At most one frame is in flight: when the engine is slower than the renderer, frames are dropped rather
 * than queued, so the camera never falls behind real time.
 */

export interface VirtualCameraInfo {
  backend: string;
  device: string;
  width: number;
  height: number;
  fps: number;
}

export interface VirtualCameraStats {
  inputFps: number;
  outputFps: number;
  dropped: number;
}

export class VirtualCameraLink {
  private socket: WebSocket | null = null;
  private dropped = 0;
  private frameBytes = 0;
  /** True while frames go through the desktop shell's socket channel (faster than the WebSocket). */
  private viaShell = false;
  private inFlight = false;
  onStats: ((stats: VirtualCameraStats) => void) | null = null;
  onClosed: ((error: string | null) => void) | null = null;

  get open() {
    return this.socket?.readyState === WebSocket.OPEN && this.frameBytes > 0;
  }

  async start(options: { width: number; height: number; fps: number; backend: string }): Promise<VirtualCameraInfo> {
    this.stop();
    const socket = new WebSocket(await websocketUrl('/ws/virtual-camera'));
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.dropped = 0;
    return new Promise<VirtualCameraInfo>((resolve, reject) => {
      let settled = false;
      socket.onopen = () => socket.send(JSON.stringify({ type: 'start', format: 'i420', ...options }));
      socket.onmessage = (event) => {
        if (typeof event.data !== 'string') return;
        const message = JSON.parse(event.data);
        if (message.type === 'ready') {
          const frameBytes = (options.width * options.height * 3) / 2;
          const shell = window.avc;
          const finish = (viaShell: boolean) => {
            settled = true;
            this.viaShell = viaShell;
            this.frameBytes = frameBytes;
            resolve(message as VirtualCameraInfo);
          };
          if (shell && message.framePort && message.frameToken) {
            shell.frameConnect({ port: message.framePort, token: message.frameToken, frameBytes }).then(() => finish(true), () => finish(false));
          } else {
            finish(false);
          }
        } else if (message.type === 'stats') {
          this.onStats?.({ inputFps: message.inputFps, outputFps: message.outputFps, dropped: this.dropped });
        } else if (message.type === 'error') {
          if (!settled) {
            settled = true;
            reject(new Error(message.message));
          } else {
            this.onClosed?.(message.message);
          }
        }
      };
      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error('The AI engine could not be reached for the virtual camera.'));
        }
      };
      socket.onclose = () => {
        if (this.socket === socket) {
          this.socket = null;
          this.frameBytes = 0;
          if (settled) this.onClosed?.(null);
        }
        if (!settled) {
          settled = true;
          reject(new Error('The virtual camera connection closed.'));
        }
      };
    });
  }

  /** True when a new frame can be sent now (the previous one has been handed to the engine). */
  get canSend() {
    if (!this.open) return false;
    return this.viaShell ? !this.inFlight : (this.socket?.bufferedAmount ?? 1) === 0;
  }

  /** Send an I420 frame if the previous one has been handed to the engine; otherwise drop it. */
  send(data: Uint8Array) {
    const socket = this.socket;
    if (!socket || !this.open) return false;
    if (this.viaShell) {
      if (this.inFlight || data.byteLength !== this.frameBytes) {
        this.dropped += 1;
        return false;
      }
      this.inFlight = true;
      void window.avc!.frameSend(data).then((ok) => { if (!ok) this.dropped += 1; }, () => { this.dropped += 1; }).finally(() => { this.inFlight = false; });
      return true;
    }
    if (socket.bufferedAmount > 0) {
      this.dropped += 1;
      return false;
    }
    if (data.byteLength !== this.frameBytes) return false;
    socket.send(data);
    return true;
  }

  stop() {
    const socket = this.socket;
    this.socket = null;
    this.frameBytes = 0;
    if (this.viaShell) void window.avc?.frameClose().catch(() => undefined);
    this.viaShell = false;
    this.inFlight = false;
    if (!socket) return;
    socket.onclose = null;
    socket.onmessage = null;
    try {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' }));
    } catch { /* closing */ }
    socket.close();
  }
}
