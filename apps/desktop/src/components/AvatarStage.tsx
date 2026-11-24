import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { segmentPortrait, type PortraitMatte } from '@/hooks/useFaceTracking';
import { AvatarRenderer, type StaticBackground } from '@/lib/avatarRenderer';
import type { EncodeOptions } from '@/lib/i420Encoder';
import type { NeuralFrame } from '@/lib/neuralFace';
import { buildPlate, matteQuality, resample } from '@/lib/backgroundPlate';
import { engine } from '@/lib/engine';
import { trianglesFromEdges } from '@/lib/faceMesh';
import { AvatarRig, type LiveFrame, type Neutral, type SolveParams } from '@/lib/reenactment';
import type { AvatarDetail } from '@/lib/types';

export interface StageDriver {
  /** Called every animation frame; return null to hold the rest pose. */
  pose: () => { frame: LiveFrame; neutral: Neutral; params: SolveParams } | null;
  /** Neural mode: the newest generated face, or null to use the mesh renderer. */
  neural?: () => NeuralFrame | null;
  paused: boolean;
}

/** Per-frame access to the final rendered picture (for the virtual camera and the recorder). */
export interface RenderedFrame {
  canvas: HTMLCanvasElement;
  /** I420 encode of this frame on the GPU; returns an earlier finished frame or null (never blocks). */
  encodeI420: (options: EncodeOptions) => Uint8Array | null;
}

/** How the background is handled for the current avatar. */
export type BackgroundState =
  | { mode: 'pending' }
  | { mode: 'static' }
  | { mode: 'whole'; reason: string };

let cachedTriangles: [number, number, number][] | null = null;
const tessellation = () => (cachedTriangles ??= trianglesFromEdges(FaceLandmarker.FACE_LANDMARKS_TESSELATION));

const PLATE_SIDE = 384;
const matteCache = new Map<string, PortraitMatte | null>();

/** Segment the portrait and build the static background. Returns null (with a reason) when unreliable. */
async function prepareBackground(avatar: AvatarDetail, bitmap: ImageBitmap): Promise<StaticBackground | string> {
  const key = `${avatar.id}:${avatar.updated_at}`;
  let matte = matteCache.get(key);
  if (matte === undefined) {
    matte = await segmentPortrait(bitmap);
    matteCache.set(key, matte);
  }
  if (!matte) return 'The subject could not be separated from the background.';
  const scale = PLATE_SIDE / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(8, Math.round(bitmap.width * Math.min(1, scale)));
  const h = Math.max(8, Math.round(bitmap.height * Math.min(1, scale)));
  const small = resample(matte.matte, matte.width, matte.height, w, h);
  const facePoints = (avatar.landmarks ?? []).slice(0, 468).map(([x, y]) => ({ x, y }));
  const quality = matteQuality(small, w, h, facePoints);
  if (quality.coverage < 0.01) return 'No person was found in the picture.';
  if (quality.coverage > 0.97) return 'The subject fills the whole picture; there is no background to keep.';
  if (facePoints.length && quality.faceCoverage < 0.6) return 'The face was not recognised as part of the subject (common with stylised art).';

  const canvas = new OffscreenCanvas(w, h);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 'The background could not be prepared.';
  context.drawImage(bitmap, 0, 0, w, h);
  const pixels = context.getImageData(0, 0, w, h).data;
  // Yield once so the first animated frames are not held up by the fill.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { matte: matte.matte, matteWidth: matte.width, matteHeight: matte.height, plate: buildPlate(pixels, small, w, h) };
}

/** WebGL portrait renderer driven by live tracking (see lib/reenactment.ts). */
export function AvatarStage({
  avatar, driver, mirrored, preserveBackground, onRenderFps, onFrame, onBackground,
}: {
  avatar: AvatarDetail | null;
  driver: MutableRefObject<StageDriver>;
  mirrored: boolean;
  /** Keep the original background static and move only the subject. */
  preserveBackground: boolean;
  onRenderFps?: (fps: number) => void;
  /** Called after every rendered frame (virtual camera, recording). */
  onFrame?: (frame: RenderedFrame) => void;
  onBackground?: (state: BackgroundState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const callbacks = useRef({ onRenderFps, onFrame, onBackground });
  callbacks.current = { onRenderFps, onFrame, onBackground };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !avatar) return;
    let disposed = false;
    let frameHandle = 0;
    let watchdog = 0;
    let renderer: AvatarRenderer | null = null;
    let bitmap: ImageBitmap | null = null;
    setError(null);
    setLoading(true);

    void (async () => {
      try {
        const url = await engine.avatarImageUrl(avatar);
        const response = await fetch(url);
        if (!response.ok) throw new Error('The avatar image could not be loaded.');
        bitmap = await createImageBitmap(await response.blob());
        if (disposed) return;
        const rig = new AvatarRig(avatar.landmarks, bitmap.width, bitmap.height, tessellation());
        renderer = new AvatarRenderer(canvas);
        renderer.setAvatar(rig, bitmap);
        setLoading(false);

        if (preserveBackground) {
          callbacks.current.onBackground?.({ mode: 'pending' });
          prepareBackground(avatar, bitmap)
            .then((result) => {
              if (disposed || !renderer) return;
              if (typeof result === 'string') {
                callbacks.current.onBackground?.({ mode: 'whole', reason: result });
              } else {
                renderer.setBackground(result);
                callbacks.current.onBackground?.({ mode: 'static' });
              }
            })
            .catch((cause: unknown) => {
              if (!disposed) callbacks.current.onBackground?.({ mode: 'whole', reason: cause instanceof Error ? cause.message : 'Segmentation failed.' });
            });
        } else {
          callbacks.current.onBackground?.({ mode: 'whole', reason: 'Turned off in Settings.' });
        }

        const active = renderer;
        const frame: RenderedFrame = { canvas, encodeI420: (options) => active.encodeI420(options) };
        let frames = 0;
        let windowStart = performance.now();
        let lastTick = 0;
        let last = rig.restPositions();
        let lastMouth = rig.restMouth();
        const tick = () => {
          if (disposed) return;
          lastTick = performance.now();
          const d = driver.current;
          const neuralFace = d.paused ? null : d.neural?.() ?? null;
          if (neuralFace) {
            renderer!.renderNeural(neuralFace);
            callbacks.current.onFrame?.(frame);
            frames += 1;
            return;
          }
          if (!d.paused) {
            const pose = d.pose();
            if (pose) {
              const solved = rig.solve(pose.frame, pose.neutral, pose.params);
              last = solved.positions;
              lastMouth = solved.mouth;
            } else {
              last = rig.restPositions();
              lastMouth = rig.restMouth();
            }
          }
          renderer!.render(last, lastMouth);
          callbacks.current.onFrame?.(frame);
          frames += 1;
          const now = performance.now();
          if (now - windowStart > 1000) {
            callbacks.current.onRenderFps?.(Math.round((frames * 1000) / (now - windowStart)));
            frames = 0;
            windowStart = now;
          }
        };
        const loop = () => {
          tick();
          if (!disposed) frameHandle = requestAnimationFrame(loop);
        };
        frameHandle = requestAnimationFrame(loop);
        // Chromium can stop animation frames for a minimised or fully covered window. The virtual camera
        // and recorder must keep running during a call, so a timer takes over whenever frames stall.
        watchdog = window.setInterval(() => {
          if (!disposed && performance.now() - lastTick > 80) tick();
        }, 33);
      } catch (cause) {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : 'The avatar renderer could not start.');
          setLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      window.clearInterval(watchdog);
      renderer?.dispose();
      bitmap?.close();
    };
  }, [avatar, driver, preserveBackground]);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={avatar ? `Animated avatar: ${avatar.name}` : 'No avatar selected'}
        className={`max-h-full max-w-full object-contain transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        style={{ transform: mirrored ? 'scaleX(-1)' : undefined }}
      />
      {loading && <div className="absolute h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="Loading avatar" />}
      {error && <p role="alert" className="absolute inset-x-6 bottom-6 rounded-lg bg-bad/15 p-3 text-center text-sm text-bad">{error}</p>}
    </div>
  );
}
