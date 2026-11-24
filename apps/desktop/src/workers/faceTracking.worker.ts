/// <reference lib="webworker" />
import { FaceLandmarker, FilesetResolver, ImageSegmenter, type FaceLandmarkerResult } from '@mediapipe/tasks-vision';

/**
 * Face tracking worker (MediaPipe Face Landmarker, fully local).
 *  - VIDEO landmarker: live webcam frames → 478 landmarks, 52 blendshapes, head rotation.
 *  - IMAGE landmarker: portrait analysis for avatars (kept separate so it never disturbs video tracking).
 *  - IMAGE segmenter: person/hair matte of a portrait, so only the subject moves and the background stays put.
 * Landmarks are filtered with a One-Euro filter: steady when still, responsive when moving.
 */

type InMessage =
  | { type: 'init' }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'analyze'; requestId: number; bitmap: ImageBitmap }
  | { type: 'segment'; requestId: number; bitmap: ImageBitmap }
  | { type: 'smoothing'; value: number }
  | { type: 'reset' };

const NUM_POINTS = 478;

let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>> | null = null;
let videoLandmarker: FaceLandmarker | null = null;
let imageLandmarker: FaceLandmarker | null = null;
let segmenter: ImageSegmenter | null = null;
let delegate: 'GPU' | 'CPU' = 'GPU';
let lastTimestamp = 0;
let smoothing = 0.5;
let blendshapeNames: string[] = [];
const lightCanvas = new OffscreenCanvas(24, 16);
const lightContext = lightCanvas.getContext('2d', { willReadFrequently: true });

// ---------------------------------------------------------------- One-Euro filter
class OneEuro {
  private x: Float32Array | null = null;
  private dx: Float32Array | null = null;
  private t = 0;

  filter(values: Float32Array, timestamp: number, minCutoff: number, beta: number): Float32Array {
    if (!this.x || !this.dx || this.x.length !== values.length) {
      this.x = values.slice();
      this.dx = new Float32Array(values.length);
      this.t = timestamp;
      return values;
    }
    const dt = Math.max(1e-3, (timestamp - this.t) / 1000);
    this.t = timestamp;
    const alphaD = alpha(dt, 1.0);
    for (let i = 0; i < values.length; i += 1) {
      const rawDerivative = (values[i] - this.x[i]) / dt;
      this.dx[i] += alphaD * (rawDerivative - this.dx[i]);
      const cutoff = minCutoff + beta * Math.abs(this.dx[i]);
      this.x[i] += alpha(dt, cutoff) * (values[i] - this.x[i]);
    }
    return this.x.slice();
  }

  reset() {
    this.x = null;
    this.dx = null;
  }
}

function alpha(dt: number, cutoff: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

const landmarkFilter = new OneEuro();
const scalarFilter = new OneEuro();

// ---------------------------------------------------------------- setup
function assetRoot() {
  return import.meta.env.DEV ? new URL('/', self.location.href) : new URL('../', self.location.href);
}

async function createLandmarker(mode: 'VIDEO' | 'IMAGE') {
  if (!fileset) {
    fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm/', assetRoot()).href, true);
  }
  const options = {
    baseOptions: { modelAssetPath: new URL('mediapipe/face_landmarker.task', assetRoot()).href, delegate },
    runningMode: mode,
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: mode === 'IMAGE' ? 0.3 : 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  } as const;
  try {
    return await FaceLandmarker.createFromOptions(fileset, options);
  } catch (error) {
    if (delegate === 'CPU') throw error;
    delegate = 'CPU'; // integrated GPUs without the needed WebGL features fall back to WASM
    return FaceLandmarker.createFromOptions(fileset, { ...options, baseOptions: { ...options.baseOptions, delegate } });
  }
}

let initialising: Promise<void> | null = null;
function init() {
  initialising ??= doInit();
  return initialising;
}

async function doInit() {
  try {
    videoLandmarker ??= await createLandmarker('VIDEO');
    // The first inference compiles GPU shaders / allocates buffers; do it now on a blank frame so the
    // studio shows tracking as soon as the camera delivers its first frames.
    try {
      const warm = new OffscreenCanvas(256, 192);
      warm.getContext('2d')?.fillRect(0, 0, 256, 192);
      lastTimestamp = Math.max(performance.now(), lastTimestamp + 1);
      videoLandmarker.detectForVideo(warm, lastTimestamp);
    } catch { /* warm-up is best effort */ }
    self.postMessage({ type: 'ready', delegate });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Face tracking model failed to load.' });
  }
}

// ---------------------------------------------------------------- helpers
function rotationFrom(result: FaceLandmarkerResult): Float32Array {
  const m = result.facialTransformationMatrixes?.[0]?.data;
  const rotation = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  if (!m) return rotation;
  // Column-major 4x4 → row-major 3x3, with scale removed from each column.
  for (let col = 0; col < 3; col += 1) {
    const sx = m[col * 4], sy = m[col * 4 + 1], sz = m[col * 4 + 2];
    const norm = Math.hypot(sx, sy, sz) || 1;
    rotation[col] = sx / norm;
    rotation[3 + col] = sy / norm;
    rotation[6 + col] = sz / norm;
  }
  return rotation;
}

function eulerDegrees(r: Float32Array) {
  const toDeg = 180 / Math.PI;
  return {
    yaw: Math.asin(Math.max(-1, Math.min(1, -r[6]))) * toDeg,
    pitch: Math.atan2(r[7], r[8]) * toDeg,
    roll: Math.atan2(r[3], r[0]) * toDeg,
  };
}

function luminanceOf(bitmap: ImageBitmap) {
  if (!lightContext) return 128;
  lightContext.drawImage(bitmap, 0, 0, lightCanvas.width, lightCanvas.height);
  const pixels = lightContext.getImageData(0, 0, lightCanvas.width, lightCanvas.height).data;
  let sum = 0;
  for (let i = 0; i < pixels.length; i += 4) sum += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
  return sum / (pixels.length / 4);
}

function packLandmarks(result: FaceLandmarkerResult): Float32Array | null {
  const points = result.faceLandmarks[0];
  if (!points || points.length < 468) return null;
  const packed = new Float32Array(NUM_POINTS * 3);
  for (let i = 0; i < Math.min(points.length, NUM_POINTS); i += 1) {
    packed[i * 3] = points[i].x;
    packed[i * 3 + 1] = points[i].y;
    packed[i * 3 + 2] = points[i].z;
  }
  return packed;
}

// ---------------------------------------------------------------- live frames
function processFrame(bitmap: ImageBitmap, timestamp: number) {
  try {
    if (!videoLandmarker) return;
    const width = bitmap.width;
    const height = bitmap.height;
    const luminance = luminanceOf(bitmap);
    const ts = Math.max(timestamp, lastTimestamp + 1);
    lastTimestamp = ts;
    const result = videoLandmarker.detectForVideo(bitmap, ts);
    const raw = packLandmarks(result);
    if (!raw) {
      landmarkFilter.reset();
      scalarFilter.reset();
      self.postMessage({ type: 'frame', timestamp, found: false, luminance, width, height });
      return;
    }
    const categories = result.faceBlendshapes[0]?.categories ?? [];
    if (blendshapeNames.length !== categories.length) {
      blendshapeNames = categories.map((c) => c.categoryName);
      self.postMessage({ type: 'blendshape-names', names: blendshapeNames });
    }
    const rawScalars = new Float32Array(categories.length + 9);
    categories.forEach((c, i) => { rawScalars[i] = c.score; });
    rawScalars.set(rotationFrom(result), categories.length);

    // smoothing 0 → very responsive, 1 → very steady
    const minCutoff = 0.4 + (1 - smoothing) * 3.6;
    const landmarks = landmarkFilter.filter(raw, timestamp, minCutoff, 8 + (1 - smoothing) * 30);
    const scalars = scalarFilter.filter(rawScalars, timestamp, minCutoff * 1.5, 0.6);
    const blendshapes = scalars.slice(0, categories.length);
    const rotation = scalars.slice(categories.length);
    self.postMessage(
      { type: 'frame', timestamp, found: true, luminance, width, height, landmarks, blendshapes, rotation, euler: eulerDegrees(rotation) },
      [landmarks.buffer, blendshapes.buffer, rotation.buffer],
    );
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Face tracking failed.' });
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------- portrait analysis
async function analyze(requestId: number, bitmap: ImageBitmap) {
  try {
    imageLandmarker ??= await createLandmarker('IMAGE');
    const result = imageLandmarker.detect(bitmap);
    const landmarks = packLandmarks(result);
    const rotation = rotationFrom(result);
    self.postMessage({ type: 'analysis', requestId, width: bitmap.width, height: bitmap.height, landmarks, euler: eulerDegrees(rotation) });
  } catch (error) {
    self.postMessage({ type: 'analysis', requestId, landmarks: null, error: error instanceof Error ? error.message : 'Analysis failed.' });
  } finally {
    bitmap.close();
  }
}

// ---------------------------------------------------------------- portrait segmentation
/**
 * selfie_multiclass_256x256 classes: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 accessories.
 * Foreground = 1 - P(background), returned as an 8-bit matte at the mask's resolution.
 */
async function segment(requestId: number, bitmap: ImageBitmap) {
  try {
    if (!fileset) fileset = await FilesetResolver.forVisionTasks(new URL('mediapipe/wasm/', assetRoot()).href, true);
    // CPU on purpose: a one-off per portrait, and it must not compete with the live tracker for the GPU context.
    segmenter ??= await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: new URL('mediapipe/selfie_multiclass_256x256.tflite', assetRoot()).href, delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    const result = segmenter.segment(bitmap);
    const background = result.confidenceMasks?.[0];
    if (!background) throw new Error('The segmenter returned no mask.');
    const width = background.width;
    const height = background.height;
    const probabilities = background.getAsFloat32Array();
    const matte = new Uint8Array(width * height);
    for (let i = 0; i < matte.length; i += 1) matte[i] = Math.round(Math.max(0, Math.min(1, 1 - probabilities[i])) * 255);
    result.close();
    self.postMessage({ type: 'segmentation', requestId, width, height, matte }, [matte.buffer]);
  } catch (error) {
    self.postMessage({ type: 'segmentation', requestId, matte: null, error: error instanceof Error ? error.message : 'Segmentation failed.' });
  } finally {
    bitmap.close();
  }
}

self.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (message.type === 'init') void init();
  else if (message.type === 'frame') processFrame(message.bitmap, message.timestamp);
  else if (message.type === 'analyze') void analyze(message.requestId, message.bitmap);
  else if (message.type === 'segment') void segment(message.requestId, message.bitmap);
  else if (message.type === 'smoothing') smoothing = Math.max(0, Math.min(1, message.value));
  else if (message.type === 'reset') { landmarkFilter.reset(); scalarFilter.reset(); }
};
