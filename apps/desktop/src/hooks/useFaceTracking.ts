import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { LiveFrame } from '@/lib/reenactment';

export type TrackingState = 'idle' | 'loading' | 'ready' | 'error';
export type TrackingIssue = 'none' | 'no-face' | 'poor-lighting' | 'face-too-small' | 'out-of-frame';

export interface TrackingSummary {
  found: boolean;
  quality: number;
  issue: TrackingIssue;
  yaw: number;
  pitch: number;
  roll: number;
  expressions: { smile: number; frown: number; blink: number; browRaise: number; mouthOpen: number };
}

interface WorkerFrame extends LiveFrame {
  luminance: number;
  euler?: { yaw: number; pitch: number; roll: number };
}

const TRACK_WIDTH = 480;
const HISTORY_MS = 3000;
const emptySummary: TrackingSummary = {
  found: false, quality: 0, issue: 'no-face', yaw: 0, pitch: 0, roll: 0,
  expressions: { smile: 0, frown: 0, blink: 0, browRaise: 0, mouthOpen: 0 },
};

function summarise(frame: WorkerFrame, names: string[]): TrackingSummary {
  if (!frame.found || !frame.landmarks) {
    return { ...emptySummary, issue: frame.luminance < 40 ? 'poor-lighting' : 'no-face' };
  }
  const lm = frame.landmarks;
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (let i = 0; i < 468; i += 1) {
    minX = Math.min(minX, lm[i * 3]); maxX = Math.max(maxX, lm[i * 3]);
    minY = Math.min(minY, lm[i * 3 + 1]); maxY = Math.max(maxY, lm[i * 3 + 1]);
  }
  const faceHeight = maxY - minY;
  const outOfFrame = minX < 0.02 || maxX > 0.98 || minY < 0.02 || maxY > 0.98;
  const quality = Math.round(Math.min(1, faceHeight / 0.32) * (outOfFrame ? 0.6 : 1) * Math.min(1, frame.luminance / 85) * 100);
  const issue: TrackingIssue = frame.luminance < 40 ? 'poor-lighting' : faceHeight < 0.17 ? 'face-too-small' : outOfFrame ? 'out-of-frame' : 'none';
  const b = (name: string) => {
    const index = names.indexOf(name);
    return index >= 0 && frame.blendshapes ? frame.blendshapes[index] : 0;
  };
  return {
    found: true, quality, issue,
    yaw: frame.euler?.yaw ?? 0, pitch: frame.euler?.pitch ?? 0, roll: frame.euler?.roll ?? 0,
    expressions: {
      smile: (b('mouthSmileLeft') + b('mouthSmileRight')) / 2,
      frown: (b('mouthFrownLeft') + b('mouthFrownRight')) / 2,
      blink: (b('eyeBlinkLeft') + b('eyeBlinkRight')) / 2,
      browRaise: Math.max(b('browInnerUp'), (b('browOuterUpLeft') + b('browOuterUpRight')) / 2),
      mouthOpen: b('jawOpen'),
    },
  };
}

// ---------------------------------------------------------------- shared worker
type WorkerMessage = { type: string; [key: string]: unknown };
type Listener = (data: WorkerMessage) => void;

/**
 * One tracking worker for the whole app: the MediaPipe models take seconds to load on slower PCs, so the
 * worker is created once (pre-warmed at launch) and reused for live tracking and portrait analysis.
 */
class Tracker {
  private static instance: Tracker | null = null;
  readonly worker: Worker;
  readonly ready: Promise<'GPU' | 'CPU'>;
  readonly listeners = new Set<Listener>();
  names: string[] = [];

  private constructor() {
    this.worker = new Worker(new URL('../workers/faceTracking.worker.ts', import.meta.url), { type: 'module' });
    this.ready = new Promise((resolve, reject) => {
      this.worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
        const data = event.data;
        if (data.type === 'ready') resolve(data.delegate as 'GPU' | 'CPU');
        else if (data.type === 'error' && !this.listeners.size) reject(new Error(String(data.message)));
        else if (data.type === 'blendshape-names') this.names = data.names as string[];
        for (const listener of this.listeners) listener(data);
      });
      this.worker.addEventListener('error', (event) => reject(new Error(event.message || 'The face tracking worker stopped.')));
    });
    this.ready.catch(() => {
      Tracker.instance = null;
      this.worker.terminate();
    });
    this.worker.postMessage({ type: 'init' });
  }

  static get() {
    Tracker.instance ??= new Tracker();
    return Tracker.instance;
  }
}

/** Start loading the tracking models in the background so the studio opens instantly. */
export function prewarmTracker() {
  try {
    Tracker.get();
  } catch {
    /* reported when the studio opens */
  }
}

/** Live webcam face tracking in a worker. Frames are exposed by ref (no React re-render per frame). */
export function useFaceTracking(videoRef: RefObject<HTMLVideoElement>, active: boolean, smoothing: number) {
  const historyRef = useRef<WorkerFrame[]>([]);
  const latestRef = useRef<WorkerFrame | null>(null);
  const fpsSamplesRef = useRef<number[]>([]);
  const smoothingRef = useRef(smoothing);
  smoothingRef.current = smoothing;
  const [state, setState] = useState<TrackingState>('idle');
  const [delegate, setDelegate] = useState<'GPU' | 'CPU' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<TrackingSummary>(emptySummary);
  const [fps, setFps] = useState(0);

  useEffect(() => {
    if (active) Tracker.get().worker.postMessage({ type: 'smoothing', value: smoothing });
  }, [active, smoothing]);

  useEffect(() => {
    if (!active) {
      setState('idle');
      setSummary(emptySummary);
      setFps(0);
      latestRef.current = null;
      historyRef.current = [];
      return;
    }
    let disposed = false;
    let ready = false;
    let pending = false;
    let frameHandle = 0;
    let frameCount = 0;
    let windowStart = performance.now();
    const tracker = Tracker.get();
    const worker = tracker.worker;
    setState('loading');
    setError(null);

    const listener: Listener = (data) => {
      if (disposed) return;
      if (data.type === 'error') {
        pending = false;
        setError(String(data.message));
        setState('error');
      } else if (data.type === 'frame') {
        pending = false;
        const frame = data as unknown as WorkerFrame;
        latestRef.current = frame;
        const history = historyRef.current;
        history.push(frame);
        while (history.length && history[0].timestamp < frame.timestamp - HISTORY_MS) history.shift();
        frameCount += 1;
        const now = performance.now();
        if (now - windowStart >= 500) {
          const value = Math.round((frameCount * 1000) / (now - windowStart));
          setFps(value);
          fpsSamplesRef.current.push(value);
          if (fpsSamplesRef.current.length > 600) fpsSamplesRef.current.shift();
          setSummary(summarise(frame, tracker.names));
          frameCount = 0;
          windowStart = now;
        }
      }
    };
    tracker.listeners.add(listener);
    worker.postMessage({ type: 'smoothing', value: smoothingRef.current });
    worker.postMessage({ type: 'reset' });
    tracker.ready
      .then((d) => {
        if (disposed) return;
        ready = true;
        setDelegate(d);
        setState('ready');
      })
      .catch((cause: Error) => {
        if (disposed) return;
        setError(cause.message);
        setState('error');
      });

    const submit = () => {
      const video = videoRef.current;
      if (disposed || !ready || pending || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
      pending = true;
      const scale = Math.min(1, TRACK_WIDTH / video.videoWidth);
      const captured = performance.now();
      createImageBitmap(video, { resizeWidth: Math.round(video.videoWidth * scale), resizeHeight: Math.round(video.videoHeight * scale), resizeQuality: 'low' })
        .then((bitmap) => {
          if (disposed) {
            bitmap.close();
            pending = false;
            return;
          }
          worker.postMessage({ type: 'frame', bitmap, timestamp: captured }, [bitmap]);
        })
        .catch(() => {
          pending = false;
        });
    };

    // Only process genuinely new camera frames when the runtime supports it.
    const video = videoRef.current as (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number; cancelVideoFrameCallback?: (id: number) => void }) | null;
    const useVideoCallback = !!video?.requestVideoFrameCallback;
    const loop = () => {
      submit();
      if (disposed) return;
      frameHandle = useVideoCallback && video ? video.requestVideoFrameCallback!(loop) : requestAnimationFrame(loop);
    };
    frameHandle = useVideoCallback && video ? video.requestVideoFrameCallback!(loop) : requestAnimationFrame(loop);

    return () => {
      disposed = true;
      tracker.listeners.delete(listener);
      if (useVideoCallback && video?.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frameHandle);
      else cancelAnimationFrame(frameHandle);
    };
  }, [active, videoRef]);

  /** Newest frame captured at or before `time` (performance.now() clock) — used for voice sync delay. */
  const frameAt = useCallback((time: number): WorkerFrame | null => {
    const history = historyRef.current;
    for (let i = history.length - 1; i >= 0; i -= 1) if (history[i].timestamp <= time) return history[i];
    return history[0] ?? latestRef.current;
  }, []);

  const blendshape = useCallback((frame: LiveFrame | null, name: string) => {
    const index = Tracker.get().names.indexOf(name);
    return index >= 0 && frame?.blendshapes ? frame.blendshapes[index] : 0;
  }, []);

  const averageFps = useCallback(() => {
    const samples = fpsSamplesRef.current;
    return samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null;
  }, []);

  return { state, delegate, error, summary, fps, latestRef, frameAt, blendshape, averageFps };
}

// ---------------------------------------------------------------- portrait analysis (outside the studio)
let requestCounter = 0;

export interface PortraitAnalysis {
  landmarks: Float32Array | null;
  width: number;
  height: number;
  euler?: { yaw: number; pitch: number; roll: number };
  error?: string;
}

/** Detect the face in a portrait image (MediaPipe IMAGE mode) for animation. */
export async function analyzePortrait(source: Blob | HTMLImageElement): Promise<PortraitAnalysis> {
  const tracker = Tracker.get();
  const bitmap = await createImageBitmap(source);
  const requestId = ++requestCounter;
  return new Promise((resolve) => {
    const listener: Listener = (data) => {
      if (data.type === 'analysis' && data.requestId === requestId) {
        tracker.listeners.delete(listener);
        resolve(data as unknown as PortraitAnalysis);
      }
    };
    tracker.listeners.add(listener);
    tracker.worker.postMessage({ type: 'analyze', requestId, bitmap }, [bitmap]);
  });
}

export interface PortraitMatte {
  /** Foreground (person + hair) coverage, 0–255, row-major. */
  matte: Uint8Array;
  width: number;
  height: number;
}

/**
 * Person/hair matte of a portrait (MediaPipe multiclass selfie segmenter, local). Null when it fails.
 * Runs in its own short-lived worker: MediaPipe cannot create a second task type in the worker that already
 * hosts the face landmarker ("ModuleFactory not set"), and this is a one-off per portrait anyway.
 */
export async function segmentPortrait(source: ImageBitmap, timeoutMs = 60000): Promise<PortraitMatte | null> {
  const worker = new Worker(new URL('../workers/faceTracking.worker.ts', import.meta.url), { type: 'module' });
  const bitmap = await createImageBitmap(source);
  try {
    return await new Promise<PortraitMatte | null>((resolve) => {
      const timer = window.setTimeout(() => resolve(null), timeoutMs);
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type !== 'segmentation') return;
        window.clearTimeout(timer);
        resolve(event.data.matte ? (event.data as unknown as PortraitMatte) : null);
      };
      worker.onerror = () => { window.clearTimeout(timer); resolve(null); };
      worker.postMessage({ type: 'segment', requestId: 1, bitmap }, [bitmap]);
    });
  } finally {
    worker.terminate();
  }
}
