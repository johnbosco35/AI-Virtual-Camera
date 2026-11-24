import {
  CHEEK_LEFT,
  CHEEK_RIGHT,
  CHIN,
  EYE_A,
  EYE_B,
  FACE_OVAL,
  FOREHEAD,
  IRIS_CENTERS,
  LIPS_INNER,
  LOWER_LIP_CENTER,
  MOUTH_LEFT,
  MOUTH_RIGHT,
  NUM_LANDMARKS,
  RIGID,
  UPPER_LIP_CENTER,
  delaunay,
  pointInPolygon,
  type Vec2,
} from '@/lib/faceMesh';

/**
 * Landmark-driven 2D face reenactment.
 *
 * Each frame: (1) solve the user's head pose against a captured neutral pose with Horn's quaternion
 * method on rigid landmarks; (2) transfer the remaining *expression* deltas onto the avatar's own
 * landmarks, scaled to its proportions; (3) rotate the avatar's 3D landmarks around a head pivot (gives
 * parallax when turning); (4) add audio-driven mouth shapes. Outer rings carry hair/neck with the head.
 */

export interface LiveFrame {
  timestamp: number;
  found: boolean;
  width: number;
  height: number;
  landmarks?: Float32Array; // 478 * 3, normalised
  blendshapes?: Float32Array;
}

export interface Visemes {
  jaw: number;
  round: number;
  wide: number;
  energy: number;
}

export interface SolveParams {
  expressionGain: number;
  headGain: number;
  lipSyncMode: 'webcam' | 'audio' | 'hybrid';
  visemes: Visemes | null; // null when no converted voice is playing
  webcamJawOpen: number;
}

export interface MouthFrame {
  origin: Vec2;
  axisX: Vec2;
  axisY: Vec2;
  halfWidth: number;
  open: number;
  interiorMix: number;
}

export interface Neutral {
  points: Float32Array; // pixel space
  centroid: [number, number, number];
  centered: Float32Array; // rigid points minus centroid
  norm: number;
  width: number;
  height: number;
  roll: number;
}

type Quat = [number, number, number, number];
const MAX_HEAD_ANGLE = (32 * Math.PI) / 180;
const LOWER_LIP = new Set([324, 318, 402, 317, 14, 87, 178, 88, 95, 375, 321, 405, 314, 17, 84, 181, 91, 146]);
const UPPER_LIP = new Set([191, 80, 81, 82, 13, 312, 311, 310, 415, 185, 40, 39, 37, 0, 267, 269, 270, 409]);
const CORNERS = new Set([61, 291, 78, 308]);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function quatToMatrix([w, x, y, z]: Quat): number[] {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y),
  ];
}

/** Horn's method: rotation that maps centred point set `a` onto `b` (largest eigenvector by power iteration). */
function hornRotation(a: Float32Array, b: Float32Array, previous: Quat): Quat {
  let sxx = 0, sxy = 0, sxz = 0, syx = 0, syy = 0, syz = 0, szx = 0, szy = 0, szz = 0;
  for (let i = 0; i < a.length; i += 3) {
    const ax = a[i], ay = a[i + 1], az = a[i + 2], bx = b[i], by = b[i + 1], bz = b[i + 2];
    sxx += ax * bx; sxy += ax * by; sxz += ax * bz;
    syx += ay * bx; syy += ay * by; syz += ay * bz;
    szx += az * bx; szy += az * by; szz += az * bz;
  }
  const n = [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
  const shift = Math.abs(sxx) + Math.abs(syy) + Math.abs(szz) + Math.abs(sxy) + Math.abs(syx) + Math.abs(sxz) + Math.abs(szx) + Math.abs(syz) + Math.abs(szy);
  for (let i = 0; i < 4; i += 1) n[i][i] += shift;
  let q: Quat = [...previous];
  for (let iter = 0; iter < 24; iter += 1) {
    const next: Quat = [0, 0, 0, 0];
    for (let r = 0; r < 4; r += 1) next[r] = n[r][0] * q[0] + n[r][1] * q[1] + n[r][2] * q[2] + n[r][3] * q[3];
    const len = Math.hypot(...next) || 1;
    q = [next[0] / len, next[1] / len, next[2] / len, next[3] / len];
  }
  return q[0] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}

function scaleRotation([w, x, y, z]: Quat, gain: number, maxAngle: number): Quat {
  const angle = 2 * Math.acos(clamp(w, -1, 1));
  const axisLen = Math.hypot(x, y, z);
  if (axisLen < 1e-6) return [1, 0, 0, 0];
  const scaled = Math.min(angle * gain, maxAngle);
  const s = Math.sin(scaled / 2) / axisLen;
  return [Math.cos(scaled / 2), x * s, y * s, z * s];
}

export function toPixels(landmarks: Float32Array, width: number, height: number) {
  const out = new Float32Array(NUM_LANDMARKS * 3);
  for (let i = 0; i < NUM_LANDMARKS; i += 1) {
    out[i * 3] = landmarks[i * 3] * width;
    out[i * 3 + 1] = landmarks[i * 3 + 1] * height;
    out[i * 3 + 2] = landmarks[i * 3 + 2] * width;
  }
  return out;
}

function dist(p: Float32Array, i: number, j: number) {
  return Math.hypot(p[i * 3] - p[j * 3], p[i * 3 + 1] - p[j * 3 + 1]);
}

function rollOf(p: Float32Array) {
  return Math.atan2(p[263 * 3 + 1] - p[33 * 3 + 1], p[263 * 3] - p[33 * 3]);
}

function rigidCentroid(p: Float32Array): [number, number, number] {
  let x = 0, y = 0, z = 0;
  for (const i of RIGID) { x += p[i * 3]; y += p[i * 3 + 1]; z += p[i * 3 + 2]; }
  return [x / RIGID.length, y / RIGID.length, z / RIGID.length];
}

function rigidCentered(p: Float32Array, c: [number, number, number]) {
  const out = new Float32Array(RIGID.length * 3);
  RIGID.forEach((i, k) => {
    out[k * 3] = p[i * 3] - c[0];
    out[k * 3 + 1] = p[i * 3 + 1] - c[1];
    out[k * 3 + 2] = p[i * 3 + 2] - c[2];
  });
  return out;
}

/** Averages the first frames into the neutral reference ("Reset avatar position" recaptures it). */
export class NeutralCapture {
  private sum: Float32Array | null = null;
  private count = 0;

  constructor(private readonly framesNeeded = 12) {}

  reset() {
    this.sum = null;
    this.count = 0;
  }

  add(frame: LiveFrame): Neutral | null {
    if (!frame.found || !frame.landmarks) return null;
    const px = toPixels(frame.landmarks, frame.width, frame.height);
    this.sum ??= new Float32Array(px.length);
    for (let i = 0; i < px.length; i += 1) this.sum[i] += px[i];
    this.count += 1;
    if (this.count < this.framesNeeded) return null;
    const points = this.sum.map((v) => v / this.count);
    this.reset();
    const centroid = rigidCentroid(points);
    const centered = rigidCentered(points, centroid);
    let norm = 0;
    for (const v of centered) norm += v * v;
    return { points, centroid, centered, norm, width: dist(points, CHEEK_LEFT, CHEEK_RIGHT), height: dist(points, FOREHEAD, CHIN), roll: rollOf(points) };
  }

  get progress() {
    return this.count / this.framesNeeded;
  }
}

/** Mesh + solver for one avatar portrait. Vertex positions are in image pixels. */
export class AvatarRig {
  readonly vertexCount: number;
  readonly uvs: Float32Array;
  readonly rest: Float32Array;
  readonly outerTriangles: Uint16Array;
  readonly eyeTriangles: Uint16Array;
  readonly mouthTriangles: Uint16Array;
  readonly faceTriangles: Uint16Array;
  readonly zRange: [number, number];
  readonly hasFace: boolean;

  private readonly avatar: Float32Array;
  private readonly pivot: [number, number, number];
  private readonly width: number;
  private readonly height: number;
  private readonly faceWidth: number;
  private readonly faceHeight: number;
  private readonly roll: number;
  private readonly jawWeight: Float32Array;
  private readonly lipWeight: Float32Array;
  private readonly mouthMask: Float32Array;
  private readonly mouthU: Float32Array;
  private readonly down: Vec2;
  private readonly across: Vec2;
  private readonly mouthHalfWidth: number;
  private readonly restOpen: number;
  private readonly ring1Start: number;
  private readonly ring2Start: number;
  private readonly borderStart: number;
  private readonly mouthCenter = NUM_LANDMARKS;
  private readonly irisCenters: number[];
  private readonly exprDx = new Float32Array(NUM_LANDMARKS);
  private readonly exprDy = new Float32Array(NUM_LANDMARKS);
  private readonly ringWeight: Float32Array;
  private readonly positions: Float32Array;
  private q: Quat = [1, 0, 0, 0];

  constructor(landmarks: number[][] | null, imageWidth: number, imageHeight: number, faceTriangles: [number, number, number][]) {
    this.width = imageWidth;
    this.height = imageHeight;
    this.hasFace = !!landmarks && landmarks.length >= 468;
    const avatar = new Float32Array(NUM_LANDMARKS * 3);
    if (this.hasFace && landmarks) {
      for (let i = 0; i < NUM_LANDMARKS; i += 1) {
        const p = landmarks[Math.min(i, landmarks.length - 1)];
        avatar[i * 3] = p[0] * imageWidth;
        avatar[i * 3 + 1] = p[1] * imageHeight;
        avatar[i * 3 + 2] = p[2] * imageWidth;
      }
    }
    this.avatar = avatar;
    this.irisCenters = landmarks && landmarks.length >= 478 ? IRIS_CENTERS : [];

    // ---- geometry of the avatar face
    const centre = this.hasFace ? rigidCentroid(avatar) : ([imageWidth / 2, imageHeight * 0.42, 0] as [number, number, number]);
    this.faceWidth = this.hasFace ? dist(avatar, CHEEK_LEFT, CHEEK_RIGHT) : imageWidth * 0.4;
    this.faceHeight = this.hasFace ? dist(avatar, FOREHEAD, CHIN) : imageHeight * 0.45;
    this.roll = this.hasFace ? rollOf(avatar) : 0;
    let meanZ = 0;
    for (let i = 0; i < 468; i += 1) meanZ += avatar[i * 3 + 2];
    meanZ /= 468;
    this.pivot = [centre[0], centre[1] + this.faceHeight * 0.1, meanZ + this.faceWidth * 0.55];

    const downRaw = this.hasFace ? { x: avatar[CHIN * 3] - avatar[FOREHEAD * 3], y: avatar[CHIN * 3 + 1] - avatar[FOREHEAD * 3 + 1] } : { x: 0, y: 1 };
    const dl = Math.hypot(downRaw.x, downRaw.y) || 1;
    this.down = { x: downRaw.x / dl, y: downRaw.y / dl };
    const acrossRaw = this.hasFace ? { x: avatar[MOUTH_RIGHT * 3] - avatar[MOUTH_LEFT * 3], y: avatar[MOUTH_RIGHT * 3 + 1] - avatar[MOUTH_LEFT * 3 + 1] } : { x: 1, y: 0 };
    const al = Math.hypot(acrossRaw.x, acrossRaw.y) || 1;
    this.across = { x: acrossRaw.x / al, y: acrossRaw.y / al };
    this.mouthHalfWidth = this.hasFace ? al / 2 : imageWidth * 0.08;
    this.restOpen = this.hasFace ? dist(avatar, UPPER_LIP_CENTER, LOWER_LIP_CENTER) : 0;

    // ---- per-landmark mouth fields (jaw opening, lip spread/round, mouth mask)
    this.jawWeight = new Float32Array(NUM_LANDMARKS);
    this.lipWeight = new Float32Array(NUM_LANDMARKS);
    this.mouthMask = new Float32Array(NUM_LANDMARKS);
    this.mouthU = new Float32Array(NUM_LANDMARKS);
    if (this.hasFace) {
      const mx = (avatar[UPPER_LIP_CENTER * 3] + avatar[LOWER_LIP_CENTER * 3]) / 2;
      const my = (avatar[UPPER_LIP_CENTER * 3 + 1] + avatar[LOWER_LIP_CENTER * 3 + 1]) / 2;
      for (let i = 0; i < NUM_LANDMARKS; i += 1) {
        const dx = avatar[i * 3] - mx;
        const dy = avatar[i * 3 + 1] - my;
        const u = (dx * this.across.x + dy * this.across.y) / this.mouthHalfWidth;
        const v = (dx * this.down.x + dy * this.down.y) / this.faceHeight;
        const horizontal = 1 - smoothstep(1.2, 3.0, Math.abs(u));
        let jaw = smoothstep(-0.004, 0.014, v) * horizontal;
        if (LOWER_LIP.has(i)) jaw = 1;
        else if (UPPER_LIP.has(i)) jaw = 0;
        else if (CORNERS.has(i)) jaw = 0.35;
        this.jawWeight[i] = jaw;
        const lips = (1 - smoothstep(1.05, 1.7, Math.abs(u))) * (1 - smoothstep(0.05, 0.11, Math.abs(v)));
        this.lipWeight[i] = lips;
        this.mouthU[i] = clamp(u, -1.3, 1.3);
        this.mouthMask[i] = Math.max(jaw * (1 - smoothstep(0.2, 0.42, v)), lips);
      }
    }

    // ---- outer rings and image border (carry hair, ears and neck with the head)
    const extra: Vec2[] = [];
    const ovalCentre = { x: 0, y: 0 };
    if (this.hasFace) {
      for (const i of FACE_OVAL) { ovalCentre.x += avatar[i * 3]; ovalCentre.y += avatar[i * 3 + 1]; }
      ovalCentre.x /= FACE_OVAL.length;
      ovalCentre.y /= FACE_OVAL.length;
    }
    const ring = (scale: number) =>
      FACE_OVAL.map((i) => ({
        x: clamp(ovalCentre.x + (avatar[i * 3] - ovalCentre.x) * scale, -imageWidth * 0.02, imageWidth * 1.02),
        y: clamp(ovalCentre.y + (avatar[i * 3 + 1] - ovalCentre.y) * scale, -imageHeight * 0.02, imageHeight * 1.02),
      }));
    const border: Vec2[] = [];
    const steps = 4;
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      border.push({ x: t * imageWidth, y: 0 }, { x: imageWidth, y: t * imageHeight }, { x: (1 - t) * imageWidth, y: imageHeight }, { x: 0, y: (1 - t) * imageHeight });
    }
    const ring1 = this.hasFace ? ring(1.22) : [];
    const ring2 = this.hasFace ? ring(2.1) : [];
    // Outer-ring points near the image border stay put so the frame edge never opens a gap.
    const edgeMargin = Math.min(imageWidth, imageHeight) * 0.1;
    this.ringWeight = Float32Array.from(ring2, (p) => 0.5 * smoothstep(0, edgeMargin, Math.min(p.x, p.y, imageWidth - p.x, imageHeight - p.y)));
    this.ring1Start = NUM_LANDMARKS + 1;
    this.ring2Start = this.ring1Start + ring1.length;
    this.borderStart = this.ring2Start + ring2.length;
    extra.push(...ring1, ...ring2, ...border);
    if (!this.hasFace) {
      // No face: a coarse grid so the whole picture can still follow head motion.
      for (let gy = 1; gy < 6; gy += 1) for (let gx = 1; gx < 6; gx += 1) extra.push({ x: (gx / 6) * imageWidth, y: (gy / 6) * imageHeight });
    }

    this.vertexCount = this.ring1Start + extra.length;
    const rest = new Float32Array(this.vertexCount * 3);
    rest.set(avatar);
    rest[this.mouthCenter * 3] = (avatar[UPPER_LIP_CENTER * 3] + avatar[LOWER_LIP_CENTER * 3]) / 2;
    rest[this.mouthCenter * 3 + 1] = (avatar[UPPER_LIP_CENTER * 3 + 1] + avatar[LOWER_LIP_CENTER * 3 + 1]) / 2;
    rest[this.mouthCenter * 3 + 2] = (avatar[UPPER_LIP_CENTER * 3 + 2] + avatar[LOWER_LIP_CENTER * 3 + 2]) / 2 + this.faceWidth * 0.04;
    const ovalZ = this.hasFace ? FACE_OVAL.map((i) => avatar[i * 3 + 2]) : [];
    extra.forEach((p, k) => {
      const v = this.ring1Start + k;
      rest[v * 3] = p.x;
      rest[v * 3 + 1] = p.y;
      const ringIndex = k % Math.max(1, FACE_OVAL.length);
      rest[v * 3 + 2] = k < ring1.length + ring2.length ? (ovalZ[ringIndex] ?? meanZ) : meanZ + this.faceWidth; // same depth as the face edge: no folding when turning
    });
    this.rest = rest;
    this.positions = rest.slice();
    this.uvs = new Float32Array(this.vertexCount * 2);
    for (let v = 0; v < this.vertexCount; v += 1) {
      this.uvs[v * 2] = rest[v * 3] / imageWidth;
      this.uvs[v * 2 + 1] = rest[v * 3 + 1] / imageHeight;
    }
    let zMin = Infinity, zMax = -Infinity;
    for (let v = 0; v < this.vertexCount; v += 1) { zMin = Math.min(zMin, rest[v * 3 + 2]); zMax = Math.max(zMax, rest[v * 3 + 2]); }
    const margin = this.faceWidth * 0.6;
    this.zRange = [zMin - margin, zMax + margin];

    // ---- triangles
    const allPoints: Vec2[] = [];
    for (let v = 0; v < this.vertexCount; v += 1) allPoints.push({ x: rest[v * 3], y: rest[v * 3 + 1] });
    const outerIds = this.hasFace ? [...FACE_OVAL, ...extra.map((_, k) => this.ring1Start + k)] : extra.map((_, k) => this.ring1Start + k);
    const outerLocal = delaunay(outerIds.map((id) => allPoints[id]));
    const ovalPolygon = FACE_OVAL.map((i) => allPoints[i]);
    const outer: number[] = [];
    for (const [a, b, c] of outerLocal) {
      const ia = outerIds[a], ib = outerIds[b], ic = outerIds[c];
      const centroid = { x: (allPoints[ia].x + allPoints[ib].x + allPoints[ic].x) / 3, y: (allPoints[ia].y + allPoints[ib].y + allPoints[ic].y) / 3 };
      if (this.hasFace && pointInPolygon(centroid, ovalPolygon)) continue;
      outer.push(ia, ib, ic);
    }
    this.outerTriangles = new Uint16Array(outer);

    const eyes: number[] = [];
    const mouth: number[] = [];
    const face: number[] = [];
    if (this.hasFace) {
      for (const contour of [EYE_A, EYE_B]) {
        let centre = -1;
        if (this.irisCenters.length) {
          // Pick the iris centre nearest to this eye contour.
          const cx = contour.reduce((s, i) => s + avatar[i * 3], 0) / contour.length;
          const cy = contour.reduce((s, i) => s + avatar[i * 3 + 1], 0) / contour.length;
          centre = this.irisCenters.reduce((best, i) => (Math.hypot(avatar[i * 3] - cx, avatar[i * 3 + 1] - cy) < Math.hypot(avatar[best * 3] - cx, avatar[best * 3 + 1] - cy) ? i : best), this.irisCenters[0]);
        }
        for (let k = 0; k < contour.length; k += 1) {
          const a = contour[k];
          const b = contour[(k + 1) % contour.length];
          if (centre >= 0) eyes.push(centre, a, b);
          else if (k > 0 && k < contour.length - 1) eyes.push(contour[0], a, b);
        }
      }
      for (let k = 0; k < LIPS_INNER.length; k += 1) mouth.push(this.mouthCenter, LIPS_INNER[k], LIPS_INNER[(k + 1) % LIPS_INNER.length]);
      const inner = new Set(LIPS_INNER);
      for (const [a, b, c] of faceTriangles) {
        if (inner.has(a) && inner.has(b) && inner.has(c)) continue; // would span the mouth opening
        face.push(a, b, c);
      }
    }
    this.eyeTriangles = new Uint16Array(eyes);
    this.mouthTriangles = new Uint16Array(mouth);
    this.faceTriangles = new Uint16Array(face);
  }

  get imageSize() {
    return { width: this.width, height: this.height };
  }

  /** Rest pose (used before tracking starts or when paused without a pose). */
  restPositions() {
    this.positions.set(this.rest);
    return this.positions;
  }

  restMouth(): MouthFrame {
    return this.mouthFrame(this.rest, 0);
  }

  solve(frame: LiveFrame, neutral: Neutral, params: SolveParams): { positions: Float32Array; mouth: MouthFrame } {
    if (!frame.found || !frame.landmarks) return { positions: this.positions, mouth: this.mouthFrame(this.positions, 0) };
    const live = toPixels(frame.landmarks, frame.width, frame.height);

    // 1. rigid head pose relative to neutral
    const c = rigidCentroid(live);
    const centred = rigidCentered(live, c);
    let norm = 0;
    for (const v of centred) norm += v * v;
    const scale = Math.sqrt(norm / Math.max(1e-6, neutral.norm));
    this.q = hornRotation(neutral.centered, centred, this.q);
    const R = quatToMatrix(this.q);
    const head = quatToMatrix(scaleRotation(this.q, params.headGain, MAX_HEAD_ANGLE));

    // 2. expression deltas in the neutral frame, mapped into avatar proportions
    const kx = this.faceWidth / Math.max(1, neutral.width);
    const ky = this.faceHeight / Math.max(1, neutral.height);
    const dRoll = this.roll - neutral.roll;
    const cr = Math.cos(dRoll), sr = Math.sin(dRoll);
    const maxDelta = this.faceHeight * 0.16;
    const gain = params.expressionGain;

    // mouth sources
    const v = params.visemes;
    let audioJaw = 0, audioWide = 0, audioRound = 0, webcamMouthScale = 1;
    if (v && params.lipSyncMode !== 'webcam') {
      if (params.lipSyncMode === 'audio') {
        webcamMouthScale = 0.15;
        audioJaw = v.jaw;
        audioWide = v.wide;
        audioRound = v.round;
      } else {
        audioJaw = Math.max(0, v.jaw - params.webcamJawOpen);
        audioWide = v.wide * 0.6;
        audioRound = v.round * 0.6;
      }
    }
    const jawPixels = audioJaw * this.faceHeight * 0.11;
    const spread = (0.17 * audioWide - 0.24 * audioRound) * this.mouthHalfWidth;

    const out = this.positions;
    const [px, py, pz] = this.pivot;
    const headScale = clamp(1 + (scale - 1) * 0.6, 0.85, 1.18);
    const tx = clamp((c[0] - neutral.centroid[0]) * kx * params.headGain * 0.7, -this.faceWidth * 0.3, this.faceWidth * 0.3);
    const ty = clamp((c[1] - neutral.centroid[1]) * ky * params.headGain * 0.7, -this.faceHeight * 0.25, this.faceHeight * 0.25);
    const a = this.avatar;
    const n = neutral.points;

    const place = (index: number, x: number, y: number, z: number) => {
      const lx = x - px, ly = y - py, lz = z - pz;
      out[index * 3] = px + headScale * (head[0] * lx + head[1] * ly + head[2] * lz) + tx;
      out[index * 3 + 1] = py + headScale * (head[3] * lx + head[4] * ly + head[5] * lz) + ty;
      out[index * 3 + 2] = pz + headScale * (head[6] * lx + head[7] * ly + head[8] * lz);
    };

    for (let i = 0; i < NUM_LANDMARKS; i += 1) {
      const lx = live[i * 3] - c[0], ly = live[i * 3 + 1] - c[1], lz = live[i * 3 + 2] - c[2];
      // R^T * (live - c) / scale  − (neutral − c0)
      let ex = (R[0] * lx + R[3] * ly + R[6] * lz) / scale - (n[i * 3] - neutral.centroid[0]);
      let ey = (R[1] * lx + R[4] * ly + R[7] * lz) / scale - (n[i * 3 + 1] - neutral.centroid[1]);
      let ez = (R[2] * lx + R[5] * ly + R[8] * lz) / scale - (n[i * 3 + 2] - neutral.centroid[2]);
      const rx = ex * cr - ey * sr;
      const ry = ex * sr + ey * cr;
      ex = rx * kx * gain;
      ey = ry * ky * gain;
      ez = ez * kx * gain;
      const mouthScale = 1 - (1 - webcamMouthScale) * this.mouthMask[i];
      ex *= mouthScale;
      ey *= mouthScale;
      const len = Math.hypot(ex, ey);
      if (len > maxDelta) { ex *= maxDelta / len; ey *= maxDelta / len; }
      // audio-driven mouth shape
      const jaw = this.jawWeight[i] * jawPixels;
      const lip = this.lipWeight[i] * this.mouthU[i] * spread;
      const dx = ex + this.down.x * jaw + this.across.x * lip;
      const dy = ey + this.down.y * jaw + this.across.y * lip;
      this.exprDx[i] = dx;
      this.exprDy[i] = dy;
      place(i, a[i * 3] + dx, a[i * 3 + 1] + dy, a[i * 3 + 2] + ez);
    }

    // synthetic mouth centre (behind the lips)
    const mc = this.mouthCenter;
    out[mc * 3] = (out[UPPER_LIP_CENTER * 3] + out[LOWER_LIP_CENTER * 3]) / 2;
    out[mc * 3 + 1] = (out[UPPER_LIP_CENTER * 3 + 1] + out[LOWER_LIP_CENTER * 3 + 1]) / 2;
    out[mc * 3 + 2] = (out[UPPER_LIP_CENTER * 3 + 2] + out[LOWER_LIP_CENTER * 3 + 2]) / 2 + this.faceWidth * 0.04;

    // Rings carry hair, ears and neck: ring 1 follows the face edge (head pose + most of its expression,
    // so an opening jaw stretches the neck instead of sliding over it); ring 2 follows partially and is
    // pinned near the image border; the border itself stays fixed.
    const rest = this.rest;
    for (let v2 = this.ring1Start; v2 < this.borderStart; v2 += 1) {
      const inner = v2 < this.ring2Start;
      const oval = FACE_OVAL[(v2 - this.ring1Start) % FACE_OVAL.length];
      const follow = inner ? 0.85 : 0.3;
      place(v2, rest[v2 * 3] + this.exprDx[oval] * follow, rest[v2 * 3 + 1] + this.exprDy[oval] * follow, rest[v2 * 3 + 2]);
      if (!inner) {
        const w = this.ringWeight[v2 - this.ring2Start];
        out[v2 * 3] = rest[v2 * 3] + (out[v2 * 3] - rest[v2 * 3]) * w;
        out[v2 * 3 + 1] = rest[v2 * 3 + 1] + (out[v2 * 3 + 1] - rest[v2 * 3 + 1]) * w;
      }
    }
    for (let v2 = this.borderStart; v2 < this.vertexCount; v2 += 1) {
      out[v2 * 3] = rest[v2 * 3];
      out[v2 * 3 + 1] = rest[v2 * 3 + 1];
      out[v2 * 3 + 2] = rest[v2 * 3 + 2];
    }
    if (!this.hasFace) {
      // Grid-only rig: everything except the border follows the head with falloff.
      for (let v2 = this.ring1Start; v2 < this.vertexCount; v2 += 1) {
        const isBorder = v2 < this.ring1Start + 16;
        if (isBorder) continue;
        place(v2, rest[v2 * 3], rest[v2 * 3 + 1], rest[v2 * 3 + 2]);
      }
    }
    return { positions: out, mouth: this.mouthFrame(out, 1) };
  }

  private mouthFrame(p: Float32Array, active: number): MouthFrame {
    if (!this.hasFace) return { origin: { x: 0, y: 0 }, axisX: { x: 1, y: 0 }, axisY: { x: 0, y: 1 }, halfWidth: 1, open: 0, interiorMix: 0 };
    const ox = p[UPPER_LIP_CENTER * 3], oy = p[UPPER_LIP_CENTER * 3 + 1];
    let ax = p[MOUTH_RIGHT * 3] - p[MOUTH_LEFT * 3];
    let ay = p[MOUTH_RIGHT * 3 + 1] - p[MOUTH_LEFT * 3 + 1];
    const width = Math.hypot(ax, ay) || 1;
    ax /= width;
    ay /= width;
    let nx = -ay, ny = ax;
    const lx = p[LOWER_LIP_CENTER * 3] - ox, ly = p[LOWER_LIP_CENTER * 3 + 1] - oy;
    if (nx * lx + ny * ly < 0) { nx = -nx; ny = -ny; }
    const open = Math.max(0, nx * lx + ny * ly);
    const interiorMix = active * smoothstep(this.restOpen * 1.15 + this.faceHeight * 0.004, this.restOpen * 1.15 + this.faceHeight * 0.03, open);
    return { origin: { x: ox, y: oy }, axisX: { x: ax, y: ay }, axisY: { x: nx, y: ny }, halfWidth: width / 2, open, interiorMix };
  }
}
