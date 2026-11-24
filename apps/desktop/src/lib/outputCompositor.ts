import type { OutputResolution } from '@/lib/types';

/**
 * The studio's final output frame: the rendered avatar placed in a fixed 16:9 frame (what call apps expect
 * from a webcam), mirrored if requested, with a small "AI-generated" disclosure. The virtual camera and the
 * recorder both consume this one canvas, so they always carry exactly the same picture.
 */

export const OUTPUT_SIZES: Record<OutputResolution, { width: number; height: number }> = {
  '360p': { width: 640, height: 360 },
  '540p': { width: 960, height: 540 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export interface Rect { x: number; y: number; width: number; height: number }

/** Source rectangle with the output's aspect ratio that covers it, centred on `focus` (0..1) and clamped. */
export function coverRect(sourceWidth: number, sourceHeight: number, outWidth: number, outHeight: number, focus = { x: 0.5, y: 0.5 }): Rect {
  const outAspect = outWidth / outHeight;
  let width = sourceWidth;
  let height = width / outAspect;
  if (height > sourceHeight) {
    height = sourceHeight;
    width = height * outAspect;
  }
  const x = Math.min(sourceWidth - width, Math.max(0, focus.x * sourceWidth - width / 2));
  const y = Math.min(sourceHeight - height, Math.max(0, focus.y * sourceHeight - height / 2));
  return { x, y, width, height };
}

/** Destination rectangle that fits the whole source inside the output (letterbox / pillarbox). */
export function containRect(sourceWidth: number, sourceHeight: number, outWidth: number, outHeight: number): Rect {
  const scale = Math.min(outWidth / sourceWidth, outHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (outWidth - width) / 2, y: (outHeight - height) / 2, width, height };
}

export interface ComposeOptions {
  mirrored: boolean;
  framing: 'fill' | 'fit';
  /** Normalised face centre in the source, used to aim the 16:9 crop. */
  focus: { x: number; y: number } | null;
}

export class OutputCompositor {
  readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private lastDraw = 0;
  private frameInterval = 1000 / 30;

  constructor(resolution: OutputResolution, fps: number) {
    const { width, height } = OUTPUT_SIZES[resolution];
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    // GPU-backed: the virtual camera converts and reads frames back on the GPU (see i420Converter.ts).
    const context = this.canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The output canvas could not be created.');
    this.context = context;
    this.setFps(fps);
    this.clear();
  }

  get width() { return this.canvas.width; }
  get height() { return this.canvas.height; }

  setFps(fps: number) {
    this.frameInterval = 1000 / Math.max(10, Math.min(60, fps));
  }

  clear() {
    this.context.fillStyle = '#090C13';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Compose a new output frame if one is due at the configured rate. Returns true when it drew. */
  compose(source: HTMLCanvasElement, options: ComposeOptions, now = performance.now()): boolean {
    // Small tolerance so a 60 Hz display does not alternate between 30 and 20 fps output.
    if (now - this.lastDraw < this.frameInterval - 4) return false;
    this.lastDraw = now;
    const ctx = this.context;
    const { width, height } = this.canvas;
    if (!source.width || !source.height) return false;
    ctx.save();
    if (options.mirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    if (options.framing === 'fill') {
      const focus = options.focus ?? { x: 0.5, y: 0.45 };
      const r = coverRect(source.width, source.height, width, height, focus);
      ctx.drawImage(source, r.x, r.y, r.width, r.height, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#090C13';
      ctx.fillRect(0, 0, width, height);
      const r = containRect(source.width, source.height, width, height);
      ctx.drawImage(source, r.x, r.y, r.width, r.height);
    }
    ctx.restore();
    this.drawDisclosure();
    return true;
  }

  /** Small, unobtrusive disclosure so viewers know the video is AI-generated. */
  private drawDisclosure() {
    const ctx = this.context;
    const scale = this.canvas.height / 720;
    const text = 'AI-generated';
    ctx.font = `600 ${Math.round(15 * scale)}px "Segoe UI", system-ui, sans-serif`;
    const padX = 9 * scale;
    const boxHeight = 24 * scale;
    const boxWidth = ctx.measureText(text).width + padX * 2;
    const x = 14 * scale;
    const y = this.canvas.height - boxHeight - 14 * scale;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxWidth, boxHeight, boxHeight / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + boxHeight / 2 + 0.5);
  }
}
