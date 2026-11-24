/**
 * Aligned face crops for neural reenactment (LivePortrait framing: eye-levelled, face bounding box x2.3,
 * shifted up by 12.5 % of the crop so the forehead and hair are included).
 * The same function frames the portrait and the live webcam, so their motion is comparable.
 */

export interface FaceCrop {
  /** Crop centre in source pixels. */
  cx: number;
  cy: number;
  /** Side of the square crop in source pixels. */
  size: number;
  /** Rotation of the crop (radians): the angle of the line between the eyes. */
  angle: number;
}

const LEFT_EYE = [33, 133];
const RIGHT_EYE = [362, 263];
export const CROP_SIZE = 256;

type Landmarks = ArrayLike<number> | [number, number, number][];

function point(landmarks: Landmarks, i: number): [number, number] {
  if (Array.isArray(landmarks) && Array.isArray(landmarks[0])) {
    const p = (landmarks as [number, number, number][])[i];
    return [p[0], p[1]];
  }
  const flat = landmarks as ArrayLike<number>;
  return [flat[i * 3], flat[i * 3 + 1]];
}

/** Crop from normalised MediaPipe landmarks (0..1) of an image of the given size. */
export function faceCrop(landmarks: Landmarks, width: number, height: number, scale = 2.3, shiftUp = 0.125): FaceCrop {
  const px = (i: number) => { const [x, y] = point(landmarks, i); return [x * width, y * height] as const; };
  const eye = (ids: number[]) => ids.map(px).reduce((a, b) => [a[0] + b[0] / ids.length, a[1] + b[1] / ids.length], [0, 0]);
  const [lx, ly] = eye(LEFT_EYE);
  const [rx, ry] = eye(RIGHT_EYE);
  // Image-space left eye is the subject's right eye; the angle levels the eye line either way.
  const angle = Math.atan2(ry - ly, rx - lx);
  const cos = Math.cos(-angle), sin = Math.sin(-angle);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 468; i += 1) {
    const [x, y] = px(i);
    const u = x * cos - y * sin, v = x * sin + y * cos; // rotate into the eye-levelled frame
    minX = Math.min(minX, u); maxX = Math.max(maxX, u); minY = Math.min(minY, v); maxY = Math.max(maxY, v);
  }
  const size = Math.max(maxX - minX, maxY - minY) * scale;
  const cu = (minX + maxX) / 2;
  const cv = (minY + maxY) / 2 - shiftUp * size;
  // back to image space
  return { cx: cu * Math.cos(angle) - cv * Math.sin(angle), cy: cu * Math.sin(angle) + cv * Math.cos(angle), size, angle };
}

/** Image-space corners of the crop: top-left, top-right, bottom-left, bottom-right. */
export function cropCorners(crop: FaceCrop): [number, number][] {
  const h = crop.size / 2, c = Math.cos(crop.angle), s = Math.sin(crop.angle);
  return ([[-h, -h], [h, -h], [-h, h], [h, h]] as const).map(([u, v]) => [crop.cx + u * c - v * s, crop.cy + u * s + v * c]);
}

/** Draw the aligned crop of `source` into a 256x256 canvas. */
export function drawCrop(context: OffscreenCanvasRenderingContext2D, source: CanvasImageSource, crop: FaceCrop) {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = '#000';
  context.fillRect(0, 0, CROP_SIZE, CROP_SIZE);
  const k = CROP_SIZE / crop.size;
  context.setTransform(k, 0, 0, k, CROP_SIZE / 2, CROP_SIZE / 2);
  context.rotate(-crop.angle);
  context.translate(-crop.cx, -crop.cy);
  context.drawImage(source, 0, 0);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

export async function cropJpeg(source: CanvasImageSource, crop: FaceCrop, quality = 0.9): Promise<Blob> {
  const canvas = new OffscreenCanvas(CROP_SIZE, CROP_SIZE);
  drawCrop(canvas.getContext('2d')!, source, crop);
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}
