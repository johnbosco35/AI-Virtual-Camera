import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

type WorkerInput =
  | { type: 'initialize' }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number }
  | { type: 'template'; bitmap: ImageBitmap; templateId: string }
  | { type: 'smoothing'; strength: number };

type Point = { x: number; y: number; z: number };
type TrackingMetrics = {
  faceFound: boolean;
  quality: number;
  issue: 'none' | 'no-face' | 'poor-lighting' | 'face-too-small' | 'out-of-frame';
  yaw: number;
  pitch: number;
  roll: number;
  blinkLeft: number;
  blinkRight: number;
  browRaise: number;
  mouthOpen: number;
  landmarks: Point[];
};

let landmarker: FaceLandmarker | null = null;
let smoothing = 0.55;
let previousMetrics: TrackingMetrics | null = null;
let lastVideoTimestamp = 0;
const lightCanvas = new OffscreenCanvas(32, 18);
const lightContext = lightCanvas.getContext('2d', { willReadFrequently: true });

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const message = event.data;
  if (message.type === 'initialize') {
    void initialize();
  } else if (message.type === 'smoothing') {
    smoothing = message.strength;
  } else if (message.type === 'frame') {
    processFrame(message.bitmap, message.timestamp);
  } else if (message.type === 'template') {
    processTemplate(message.bitmap, message.templateId);
  }
};

async function initialize() {
  try {
    const appRoot = import.meta.env.DEV ? new URL('/', self.location.href) : new URL('../', self.location.href);
    const wasmRoot = new URL('mediapipe/wasm/', appRoot).href;
    const modelPath = new URL('mediapipe/face_landmarker.task', appRoot).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmRoot, true);
    const options = {
      baseOptions: { modelAssetPath: modelPath },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    } as const;
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'GPU' },
      });
    } catch {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { ...options.baseOptions, delegate: 'CPU' },
      });
    }
    const triangles = buildTessellationTriangles(FaceLandmarker.FACE_LANDMARKS_TESSELATION);
    self.postMessage({ type: 'ready', triangles });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown model initialization error';
    self.postMessage({ type: 'error', message });
  }
}

function processTemplate(bitmap: ImageBitmap, templateId: string) {
  try {
    if (!landmarker) throw new Error('Face tracking is not initialized.');
    const timestamp = Math.max(performance.now(), lastVideoTimestamp + 1);
    lastVideoTimestamp = timestamp;
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const landmarks = result.faceLandmarks[0]?.map(({ x, y, z }) => ({ x, y, z })) ?? [];
    self.postMessage({ type: 'template', templateId, landmarks });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown avatar image analysis error';
    self.postMessage({ type: 'template-error', templateId, message });
  } finally {
    bitmap.close();
  }
}

function processFrame(bitmap: ImageBitmap, timestamp: number) {
  try {
    if (!landmarker || !lightContext) throw new Error('Face tracking is not initialized.');
    lightContext.drawImage(bitmap, 0, 0, lightCanvas.width, lightCanvas.height);
    const pixels = lightContext.getImageData(0, 0, lightCanvas.width, lightCanvas.height).data;
    let luminance = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      luminance += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722;
    }
    luminance /= pixels.length / 4;

    const poorLighting = luminance < 45;
    const monotonicTimestamp = Math.max(timestamp, lastVideoTimestamp + 1);
    lastVideoTimestamp = monotonicTimestamp;
    const result = landmarker.detectForVideo(bitmap, monotonicTimestamp);
    const landmarks = result.faceLandmarks[0];
    if (!landmarks) {
      postMetrics({
        faceFound: false,
        quality: 0,
        issue: poorLighting ? 'poor-lighting' : 'no-face',
        yaw: 0,
        pitch: 0,
        roll: 0,
        blinkLeft: 0,
        blinkRight: 0,
        browRaise: 0,
        mouthOpen: 0,
        landmarks: [],
      });
      return;
    }

    const xs = landmarks.map(({ x }) => x);
    const ys = landmarks.map(({ y }) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const faceHeight = maxY - minY;
    const outOfFrame = minX < 0.025 || maxX > 0.975 || minY < 0.025 || maxY > 0.975;
    const tooSmall = faceHeight < 0.18;
    const framingQuality = Math.min(1, faceHeight / 0.3) * (outOfFrame ? 0.55 : 1);
    const lightingQuality = Math.min(1, luminance / 90);
    const quality = Math.round(framingQuality * lightingQuality * 100);
    const issue = poorLighting
      ? 'poor-lighting'
      : tooSmall
        ? 'face-too-small'
        : outOfFrame
          ? 'out-of-frame'
          : 'none';

    const categories = result.faceBlendshapes[0]?.categories ?? [];
    const blendshape = (name: string) => categories.find((category) => category.categoryName === name)?.score ?? 0;
    const matrix = result.facialTransformationMatrixes[0]?.data;
    const metrics: TrackingMetrics = {
      faceFound: true,
      quality,
      issue,
      yaw: matrix ? radiansToDegrees(Math.asin(clamp(-matrix[8], -1, 1))) : 0,
      pitch: matrix ? radiansToDegrees(Math.atan2(matrix[9], matrix[10])) : 0,
      roll: matrix ? radiansToDegrees(Math.atan2(matrix[4], matrix[0])) : 0,
      blinkLeft: blendshape('eyeBlinkLeft'),
      blinkRight: blendshape('eyeBlinkRight'),
      browRaise: Math.max(blendshape('browInnerUp'), blendshape('browOuterUpLeft'), blendshape('browOuterUpRight')),
      mouthOpen: blendshape('jawOpen'),
      landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
    };
    postMetrics(metrics);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown face tracking error';
    self.postMessage({ type: 'error', message });
  } finally {
    bitmap.close();
  }
}

function postMetrics(metrics: TrackingMetrics) {
  if (previousMetrics && metrics.faceFound && previousMetrics.faceFound) {
    const currentWeight = 1 - smoothing * 0.85;
    metrics = {
      ...metrics,
      landmarks: metrics.landmarks.map((point, index) => {
        const previousPoint = previousMetrics!.landmarks[index];
        return previousPoint
          ? {
              x: smooth(previousPoint.x, point.x, currentWeight),
              y: smooth(previousPoint.y, point.y, currentWeight),
              z: smooth(previousPoint.z, point.z, currentWeight),
            }
          : point;
      }),
      yaw: smooth(previousMetrics.yaw, metrics.yaw, currentWeight),
      pitch: smooth(previousMetrics.pitch, metrics.pitch, currentWeight),
      roll: smooth(previousMetrics.roll, metrics.roll, currentWeight),
      blinkLeft: smooth(previousMetrics.blinkLeft, metrics.blinkLeft, currentWeight),
      blinkRight: smooth(previousMetrics.blinkRight, metrics.blinkRight, currentWeight),
      browRaise: smooth(previousMetrics.browRaise, metrics.browRaise, currentWeight),
      mouthOpen: smooth(previousMetrics.mouthOpen, metrics.mouthOpen, currentWeight),
    };
  }
  previousMetrics = metrics;
  self.postMessage({ type: 'metrics', metrics });
}

function buildTessellationTriangles(connections: { start: number; end: number }[]) {
  const adjacency = new Map<number, Set<number>>();
  for (const { start, end } of connections) {
    if (!adjacency.has(start)) adjacency.set(start, new Set());
    if (!adjacency.has(end)) adjacency.set(end, new Set());
    adjacency.get(start)!.add(end);
    adjacency.get(end)!.add(start);
  }
  const triangles: [number, number, number][] = [];
  for (const [first, neighbors] of adjacency) {
    for (const second of neighbors) {
      if (second <= first) continue;
      for (const third of neighbors) {
        if (third > second && adjacency.get(second)?.has(third)) {
          triangles.push([first, second, third]);
        }
      }
    }
  }
  return triangles;
}

function smooth(previous: number, current: number, weight: number) {
  return previous + (current - previous) * weight;
}

function radiansToDegrees(value: number) {
  return value * (180 / Math.PI);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
