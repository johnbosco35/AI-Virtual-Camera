import { describe, expect, it } from 'vitest';
import fixture from '@/lib/__fixtures__/portrait-landmarks.json';
import { assessPortrait, delaunay, EYE_A } from '@/lib/faceMesh';
import { AvatarRig, NeutralCapture, type LiveFrame, type Neutral, type SolveParams } from '@/lib/reenactment';

const W = fixture.width;
const H = fixture.height;
const base = fixture.landmarks as number[][];
const params: SolveParams = { expressionGain: 1, headGain: 1, lipSyncMode: 'webcam', visemes: null, webcamJawOpen: 0 };

function frameOf(points: number[][]): LiveFrame {
  return { timestamp: 0, found: true, width: W, height: H, landmarks: Float32Array.from(points.flat()) };
}

function neutralOf(points: number[][]): Neutral {
  const capture = new NeutralCapture(1);
  const neutral = capture.add(frameOf(points));
  if (!neutral) throw new Error('neutral not captured');
  return neutral;
}

const rig = () => new AvatarRig(base, W, H, []);
const px = (p: Float32Array, i: number) => ({ x: p[i * 3], y: p[i * 3 + 1] });
const dist = (p: Float32Array, i: number, j: number) => Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1]);
const faceHeight = (base[152][1] - base[10][1]) * H;

describe('AvatarRig', () => {
  it('keeps the avatar at rest when the user matches the neutral pose', () => {
    const r = rig();
    const { positions } = r.solve(frameOf(base), neutralOf(base), params);
    for (let i = 0; i < 478; i += 1) {
      expect(Math.abs(positions[i * 3] - r.rest[i * 3])).toBeLessThan(0.75);
      expect(Math.abs(positions[i * 3 + 1] - r.rest[i * 3 + 1])).toBeLessThan(0.75);
    }
  });

  it('turns the head without inventing expressions (rigid yaw is not mistaken for mouth motion)', () => {
    const r = rig();
    const angle = (15 * Math.PI) / 180;
    const cx = base.reduce((s, p) => s + p[0], 0) / base.length;
    const cz = base.reduce((s, p) => s + p[2], 0) / base.length;
    // Rotate the user's face about the vertical axis (pixel space, z scaled like x).
    const turned = base.map(([x, y, z]) => {
      const dx = (x - cx) * W, dz = (z - cz) * W;
      return [cx + (dx * Math.cos(angle) + dz * Math.sin(angle)) / W, y, cz + (-dx * Math.sin(angle) + dz * Math.cos(angle)) / W];
    });
    const { positions } = r.solve(frameOf(turned), neutralOf(base), params);
    const noseShift = px(positions, 1).x - r.rest[1 * 3];
    const liveNoseShift = (turned[1][0] - base[1][0]) * W;
    expect(Math.sign(noseShift)).toBe(Math.sign(liveNoseShift));
    expect(Math.abs(noseShift)).toBeGreaterThan(faceHeight * 0.03);
    // The mouth stays closed: lip gap changes by under 1% of the face height.
    expect(Math.abs(dist(positions, 13, 14) - dist(r.rest, 13, 14))).toBeLessThan(faceHeight * 0.01);
  });

  it('opens the avatar mouth when the user opens their jaw', () => {
    const r = rig();
    const drop = 0.05 * (base[152][1] - base[10][1]);
    const lowerFace = new Set([14, 87, 178, 88, 95, 317, 402, 318, 324, 17, 84, 181, 91, 146, 314, 405, 321, 375, 152, 148, 176, 149, 377, 400, 378, 175, 199, 200, 18, 83, 313, 421, 201]);
    const open = base.map(([x, y, z], i) => [x, lowerFace.has(i) ? y + drop : y, z]);
    const { positions, mouth } = r.solve(frameOf(open), neutralOf(base), params);
    expect(dist(positions, 13, 14) - dist(r.rest, 13, 14)).toBeGreaterThan(drop * H * 0.6);
    expect(Math.abs(px(positions, 13).y - r.rest[13 * 3 + 1])).toBeLessThan(faceHeight * 0.01);
    expect(mouth.interiorMix).toBeGreaterThan(0.5);
  });

  it('closes the avatar eye when the user blinks', () => {
    const r = rig();
    // Move the upper lid of EYE_A onto the lower lid (contour halves mirror each other).
    const upper = EYE_A.slice(1, 8);
    const lower = EYE_A.slice(9).reverse();
    const blink = base.map((p) => [...p]);
    upper.forEach((u, k) => { blink[u][1] = base[lower[k]][1]; });
    const { positions } = r.solve(frameOf(blink), neutralOf(base), params);
    const restOpening = dist(r.rest, 159, 145);
    expect(dist(positions, 159, 145)).toBeLessThan(restOpening * 0.4);
  });

  it('drives the mouth from converted-voice visemes in audio lip-sync mode', () => {
    const r = rig();
    const { positions, mouth } = r.solve(frameOf(base), neutralOf(base), { ...params, lipSyncMode: 'audio', visemes: { jaw: 1, round: 0, wide: 0, energy: 1 } });
    expect(dist(positions, 13, 14) - dist(r.rest, 13, 14)).toBeGreaterThan(faceHeight * 0.08);
    expect(mouth.interiorMix).toBeGreaterThan(0.5);
    const rounded = r.solve(frameOf(base), neutralOf(base), { ...params, lipSyncMode: 'audio', visemes: { jaw: 0.2, round: 1, wide: 0, energy: 1 } });
    expect(dist(rounded.positions, 61, 291)).toBeLessThan(dist(r.rest, 61, 291));
  });

  it('animates pictures without a detectable face as a whole (no NaNs)', () => {
    const r = new AvatarRig(null, 800, 600, []);
    const { positions } = r.solve(frameOf(base), neutralOf(base), params);
    expect(positions.every(Number.isFinite)).toBe(true);
    expect(r.outerTriangles.length).toBeGreaterThan(0);
  });

  it('covers the whole image: outer mesh triangles exist and reference valid vertices', () => {
    const r = rig();
    expect(r.outerTriangles.length / 3).toBeGreaterThan(80);
    for (const index of [...r.outerTriangles, ...r.eyeTriangles, ...r.mouthTriangles]) expect(index).toBeLessThan(r.vertexCount);
  });
});

describe('faceMesh helpers', () => {
  it('delaunay triangulates a grid', () => {
    const points = [];
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) points.push({ x: x + y * 0.001, y });
    expect(delaunay(points)).toHaveLength(2 * 3 * 3);
  });

  it('scores a frontal portrait highly and a missing face as zero', () => {
    expect(assessPortrait(Float32Array.from(base.flat()), W, H, { yaw: 2, pitch: 3, roll: 0 }).score).toBeGreaterThan(0.7);
    expect(assessPortrait(null, W, H).score).toBe(0);
  });
});
