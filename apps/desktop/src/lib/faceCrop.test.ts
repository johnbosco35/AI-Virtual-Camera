import { describe, expect, it } from 'vitest';
import { cropCorners, faceCrop } from '@/lib/faceCrop';

/** Synthetic 468-point face: an ellipse of points, eyes at the MediaPipe indices, optionally rolled. */
function face(cx: number, cy: number, w: number, h: number, roll = 0) {
  const pts = new Float32Array(478 * 3);
  const put = (i: number, x: number, y: number) => {
    const c = Math.cos(roll), s = Math.sin(roll);
    pts[i * 3] = cx + x * c - y * s;
    pts[i * 3 + 1] = cy + x * s + y * c;
  };
  for (let i = 0; i < 468; i += 1) {
    const a = (i / 468) * Math.PI * 2;
    put(i, (Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2);
  }
  for (const i of [33, 133]) put(i, -w * 0.2, -h * 0.1);
  for (const i of [362, 263]) put(i, w * 0.2, -h * 0.1);
  return pts;
}

describe('face crop for neural reenactment', () => {
  it('frames the face at 2.3x its size, shifted up, eye-levelled', () => {
    const crop = faceCrop(face(0.5, 0.5, 0.2, 0.3), 1000, 1000);
    expect(crop.angle).toBeCloseTo(0, 5);
    expect(crop.size).toBeCloseTo(300 * 2.3, 0);
    expect(crop.cx).toBeCloseTo(500, 0);
    expect(crop.cy).toBeCloseTo(500 - 0.125 * crop.size, 0);
  });

  it('follows head roll and keeps the same framing', () => {
    const level = faceCrop(face(0.5, 0.5, 0.2, 0.3), 1000, 1000);
    const rolled = faceCrop(face(0.5, 0.5, 0.2, 0.3, 0.3), 1000, 1000);
    expect(rolled.angle).toBeCloseTo(0.3, 3);
    expect(rolled.size).toBeCloseTo(level.size, 0);
    const corners = cropCorners(rolled);
    const mid = corners.reduce((a, [x, y]) => [a[0] + x / 4, a[1] + y / 4], [0, 0]);
    expect(mid[0]).toBeCloseTo(rolled.cx, 3);
    expect(mid[1]).toBeCloseTo(rolled.cy, 3);
    expect(Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1])).toBeCloseTo(rolled.size, 3);
  });
});
