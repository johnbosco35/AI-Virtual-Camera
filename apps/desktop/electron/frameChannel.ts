import net from 'node:net';

/**
 * Main-process side of the virtual-camera frame path: renderer → (IPC) → here → (local TCP) → engine.
 * The engine's asyncio WebSocket stack is too slow for raw video on low-end CPUs; a plain socket is not.
 * One connection at a time, to 127.0.0.1 only, authenticated with the per-output token from the engine.
 */
export class FrameChannel {
  private socket: net.Socket | null = null;
  private frameBytes = 0;
  private connecting: Promise<void> | null = null;

  async connect(port: number, tokenHex: string, frameBytes: number) {
    this.close();
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setNoDelay(true);
    this.socket = socket;
    this.frameBytes = frameBytes;
    this.connecting = new Promise<void>((resolve, reject) => {
      socket.once('connect', () => {
        socket.write(Buffer.from(tokenHex, 'hex'));
        resolve();
      });
      socket.once('error', reject);
    });
    socket.on('error', () => this.close());
    socket.on('close', () => { if (this.socket === socket) this.socket = null; });
    await this.connecting;
  }

  /** Write one frame. Resolves true once it is handed to the OS, false if dropped (busy or closed). */
  send(frame: Uint8Array): Promise<boolean> {
    const socket = this.socket;
    if (!socket || socket.destroyed || frame.byteLength !== this.frameBytes) return Promise.resolve(false);
    if (socket.writableLength > 0) return Promise.resolve(false); // previous frame still in flight: drop
    const header = Buffer.alloc(4);
    header.writeUInt32LE(frame.byteLength, 0);
    socket.write(header);
    return new Promise((resolve) => socket.write(frame, (error) => resolve(!error)));
  }

  close() {
    this.socket?.destroy();
    this.socket = null;
    this.frameBytes = 0;
  }
}
