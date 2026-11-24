/** MediaPipe Face Landmarker topology helpers (478-point mesh incl. irises). */

export const NUM_LANDMARKS = 478;

/** Face silhouette, ordered around the face. */
export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const LIPS_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
export const LIPS_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
export const EYE_A = [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7];
export const EYE_B = [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249];
export const IRIS_CENTERS = [468, 473];
/** Points that barely move with expressions: forehead, nose bridge, eye corners, temples. */
export const RIGID = [10, 151, 9, 8, 168, 6, 197, 195, 5, 4, 33, 133, 362, 263, 234, 454, 127, 356, 21, 251, 162, 389, 109, 338];

export const UPPER_LIP_CENTER = 13;
export const LOWER_LIP_CENTER = 14;
export const MOUTH_LEFT = 61;
export const MOUTH_RIGHT = 291;
export const FOREHEAD = 10;
export const CHIN = 152;
export const CHEEK_LEFT = 234;
export const CHEEK_RIGHT = 454;

export type Vec2 = { x: number; y: number };

/** Triangles from MediaPipe's tessellation edge list (mutually connected vertex triples). */
export function trianglesFromEdges(connections: { start: number; end: number }[]): [number, number, number][] {
  const adjacency = new Map<number, Set<number>>();
  for (const { start, end } of connections) {
    if (!adjacency.has(start)) adjacency.set(start, new Set());
    if (!adjacency.has(end)) adjacency.set(end, new Set());
    adjacency.get(start)!.add(end);
    adjacency.get(end)!.add(start);
  }
  const triangles: [number, number, number][] = [];
  for (const [a, neighbours] of adjacency) {
    for (const b of neighbours) {
      if (b <= a) continue;
      for (const c of neighbours) {
        if (c > b && adjacency.get(b)?.has(c)) triangles.push([a, b, c]);
      }
    }
  }
  return triangles;
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Bowyer–Watson Delaunay triangulation (small point sets only). */
export function delaunay(points: Vec2[]): [number, number, number][] {
  const n = points.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY) * 20;
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const all = [...points, { x: midX - span, y: midY - span }, { x: midX + span, y: midY - span }, { x: midX, y: midY + span }];
  type Tri = { a: number; b: number; c: number; cx: number; cy: number; r2: number };
  const circum = (a: number, b: number, c: number): Tri => {
    const A = all[a], B = all[b], C = all[c];
    const d = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y)) || 1e-9;
    const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / d;
    const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / d;
    return { a, b, c, cx: ux, cy: uy, r2: (A.x - ux) ** 2 + (A.y - uy) ** 2 };
  };
  let triangles: Tri[] = [circum(n, n + 1, n + 2)];
  for (let i = 0; i < n; i += 1) {
    const p = all[i];
    const bad: Tri[] = [];
    const keep: Tri[] = [];
    for (const t of triangles) ((p.x - t.cx) ** 2 + (p.y - t.cy) ** 2 < t.r2 ? bad : keep).push(t);
    const edges = new Map<string, [number, number]>();
    for (const t of bad) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as [number, number][]) {
        const key = u < v ? `${u}:${v}` : `${v}:${u}`;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [u, v]);
      }
    }
    for (const [u, v] of edges.values()) keep.push(circum(u, v, i));
    triangles = keep;
  }
  return triangles.filter((t) => t.a < n && t.b < n && t.c < n).map((t) => [t.a, t.b, t.c]);
}

/** Compatibility estimate for a portrait from its landmarks (face size, frontal pose, framing). */
export function assessPortrait(landmarks: Float32Array | null, width: number, height: number, euler?: { yaw: number; pitch: number; roll: number }) {
  if (!landmarks) {
    return { score: 0, note: 'No face detected. The picture will move as a whole without facial expressions.' };
  }
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (let i = 0; i < 468; i += 1) {
    minX = Math.min(minX, landmarks[i * 3]); maxX = Math.max(maxX, landmarks[i * 3]);
    minY = Math.min(minY, landmarks[i * 3 + 1]); maxY = Math.max(maxY, landmarks[i * 3 + 1]);
  }
  const faceShare = ((maxY - minY) * height) / Math.max(width, height);
  const facePixels = (maxY - minY) * height;
  const yaw = Math.abs(euler?.yaw ?? 0);
  const pitch = Math.abs(euler?.pitch ?? 0);
  const sizeScore = Math.min(1, faceShare / 0.35) * Math.min(1, facePixels / 220);
  const poseScore = Math.max(0, 1 - Math.max(0, yaw - 8) / 30) * Math.max(0, 1 - Math.max(0, pitch - 12) / 30);
  const edgeScore = minX < 0.02 || maxX > 0.98 || minY < 0.02 || maxY > 0.98 ? 0.7 : 1;
  const score = Math.round(Math.max(0.05, sizeScore * 0.5 + poseScore * 0.4 + 0.1) * edgeScore * 100) / 100;
  const notes: string[] = [];
  if (facePixels < 180) notes.push('face is small — use a closer crop for sharper animation');
  if (yaw > 15) notes.push('head is turned — a front-facing portrait animates best');
  if (pitch > 18) notes.push('head is tilted up/down');
  if (edgeScore < 1) notes.push('face touches the image edge');
  const note = notes.length ? `Animatable; ${notes.join('; ')}.` : 'Great portrait: frontal, well-framed face.';
  return { score, note };
}
