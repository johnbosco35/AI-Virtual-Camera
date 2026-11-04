import { useEffect, useRef, useState, type RefObject } from 'react';

export type TrackingIssue = 'none' | 'no-face' | 'poor-lighting' | 'face-too-small' | 'out-of-frame';

export interface TrackingMetrics {
  faceFound: boolean;
  quality: number;
  issue: TrackingIssue;
  yaw: number;
  pitch: number;
  roll: number;
  blinkLeft: number;
  blinkRight: number;
  browRaise: number;
  mouthOpen: number;
  landmarks: { x: number; y: number; z: number }[];
}

type TrackingState = 'idle' | 'loading' | 'ready' | 'error';

type WorkerOutput =
  | { type: 'ready'; triangles: [number, number, number][] }
  | { type: 'error'; message: string }
  | { type: 'metrics'; metrics: TrackingMetrics }
  | { type: 'template'; templateId: string; landmarks: { x: number; y: number; z: number }[] }
  | { type: 'template-error'; templateId: string; message: string };

const initialMetrics: TrackingMetrics = {
  faceFound: false,
  quality: 0,
  issue: 'no-face',
  yaw: 0,
  pitch: 0,
  roll: 0,
  blinkLeft: 0,
  blinkRight: 0,
  browRaise: 0,
  mouthOpen: 0,
  landmarks: [],
};

export function useFaceTracking(
  videoRef: RefObject<HTMLVideoElement>,
  cameraLive: boolean,
  smoothingStrength: number,
  templateBlob: Blob | null = null,
  templateId: string | null = null,
) {
  const workerRef = useRef<Worker | null>(null);
  const smoothingRef = useRef(smoothingStrength);
  const templateIdRef = useRef(templateId);
  const [state, setState] = useState<TrackingState>('idle');
  const [metrics, setMetrics] = useState(initialMetrics);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [templateLandmarks, setTemplateLandmarks] = useState<{ x: number; y: number; z: number }[]>([]);
  const [templateTriangles, setTemplateTriangles] = useState<[number, number, number][]>([]);
  const [templateError, setTemplateError] = useState<string | null>(null);

  useEffect(() => {
    smoothingRef.current = smoothingStrength;
    workerRef.current?.postMessage({ type: 'smoothing', strength: smoothingStrength });
  }, [smoothingStrength]);

  useEffect(() => {
    templateIdRef.current = templateId;
  }, [templateId]);

  useEffect(() => {
    if (!cameraLive) {
      setState('idle');
      setMetrics(initialMetrics);
      setError(null);
      setTemplateLandmarks([]);
      setTemplateTriangles([]);
      setTemplateError(null);
      return;
    }

    let active = true;
    let framePending = false;
    let workerReady = false;
    let workerFailed = false;
    let framesInInterval = 0;
    let intervalStartedAt = performance.now();
    let animationFrame = 0;
    const worker = new Worker(new URL('../workers/faceTracking.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setState('loading');
    setError(null);

    worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
      if (!active) return;
      if (event.data.type === 'ready') {
        workerReady = true;
        setTemplateTriangles(event.data.triangles);
        setState('ready');
      } else if (event.data.type === 'error') {
        workerFailed = true;
        framePending = false;
        setError(event.data.message);
        setState('error');
      } else if (event.data.type === 'metrics') {
        framePending = false;
        setMetrics(event.data.metrics);
        framesInInterval += 1;
        const now = performance.now();
        const elapsed = now - intervalStartedAt;
        if (elapsed >= 1000) {
          setFps(Math.round((framesInInterval * 1000) / elapsed));
          framesInInterval = 0;
          intervalStartedAt = now;
        }
      } else if (event.data.type === 'template') {
        if (event.data.templateId === templateIdRef.current) {
          setTemplateLandmarks(event.data.landmarks);
          setTemplateError(event.data.landmarks.length < 400 ? 'No face could be detected in this image.' : null);
        }
      } else if (event.data.type === 'template-error') {
        if (event.data.templateId === templateIdRef.current) setTemplateError(event.data.message);
      }
    };
    worker.onerror = (event) => {
      if (!active) return;
      workerFailed = true;
      framePending = false;
      setError(event.message || 'The face-tracking worker stopped unexpectedly.');
      setState('error');
    };
    worker.postMessage({ type: 'smoothing', strength: smoothingRef.current });
    worker.postMessage({ type: 'initialize' });

    const captureFrame = () => {
      animationFrame = requestAnimationFrame(captureFrame);
      const video = videoRef.current;
      if (!active || !workerReady || workerFailed || framePending || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      framePending = true;
      void createImageBitmap(video)
        .then((bitmap) => {
          if (!active) {
            bitmap.close();
            return;
          }
          worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
        })
        .catch((cause: unknown) => {
          framePending = false;
          if (!active) return;
          setError(cause instanceof Error ? cause.message : 'Could not read the webcam frame.');
          setState('error');
        });
    };
    animationFrame = requestAnimationFrame(captureFrame);

    return () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      worker.terminate();
      workerRef.current = null;
    };
  }, [cameraLive, videoRef]);

  useEffect(() => {
    if (!cameraLive || state !== 'ready' || !templateBlob || !templateId || !templateTriangles.length) {
      setTemplateLandmarks([]);
      setTemplateError(null);
      return;
    }

    let active = true;
    const worker = workerRef.current;
    setTemplateLandmarks([]);
    setTemplateError(null);
    void createImageBitmap(templateBlob)
      .then((bitmap) => {
        if (!active || workerRef.current !== worker) {
          bitmap.close();
          return;
        }
        worker?.postMessage({ type: 'template', templateId, bitmap }, [bitmap]);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setTemplateError(cause instanceof Error ? cause.message : 'The selected avatar image could not be analyzed.');
      });

    return () => { active = false; };
  }, [cameraLive, state, templateBlob, templateId, templateTriangles.length]);

  return { state, metrics, fps, error, templateLandmarks, templateTriangles, templateError };
}
