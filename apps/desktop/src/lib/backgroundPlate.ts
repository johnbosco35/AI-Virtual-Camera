/**
 * Static background ("clean plate") for a portrait.
 *
 * The animated subject is drawn over this plate, so the original background never moves. Pixels outside the
 * subject are the untouched original (the renderer samples the full-resolution image there). Only where the
 * subject itself was — which becomes visible when the head turns or the mouth moves — the plate is
 * reconstructed from the surrounding background with a push-pull (pyramid) fill.
 *
 * Everything here runs once per avatar on a small working copy (default 384 px on the long side).
 */

export interface Plate {
  width: number;
  height: number;
  /** RGBA: background reconstructed inside the subject region (original elsewhere). */
  fill: Uint8ClampedArray;
  /** 0–255: where the renderer should use `fill` instead of the original image (dilated, feathered subject). */
  hole: Uint8Array;
}

export interface MatteQuality {
  /** Fraction of the picture covered by the subject. */
  coverage: number;
  /** Mean matte value at the given face points (1 = the face is clearly foreground). */
  faceCoverage: number;
}

/** Bilinear resample of an 8-bit single-channel image. */
export function resample(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  const sx = sw / dw;
  const sy = sh / dh;
  for (let y = 0; y < dh; y += 1) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < dw; x += 1) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const top = src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx;
      const bottom = src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx;
      out[y * dw + x] = Math.round(top * (1 - ty) + bottom * ty);
    }
  }
  return out;
}

/** Separable square max filter (morphological dilation) of radius r. */
export function dilate(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) m = Math.max(m, src[y * w + k]);
      tmp[y * w + x] = m;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) m = Math.max(m, tmp[k * w + x]);
      out[y * w + x] = m;
    }
  }
  return out;
}

/** Separable box blur of radius r (used to feather the hole edge). */
export function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Float32Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0, n = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k += 1) { s += src[y * w + k]; n += 1; }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0, n = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k += 1) { s += tmp[k * w + x]; n += 1; }
      out[y * w + x] = Math.round(s / n);
    }
  }
  return out;
}

/**
 * Push-pull hole filling. `known[i]` in 0..1 is the confidence of pixel i; unknown pixels are filled with a
 * smooth continuation of the known colours around them.
 */
export function pushPull(rgba: Uint8ClampedArray, known: Float32Array, w: number, h: number): Uint8ClampedArray {
  interface Level { w: number; h: number; c: Float32Array; a: Float32Array }
  const base: Level = { w, h, c: new Float32Array(w * h * 3), a: known.slice() };
  for (let i = 0; i < w * h; i += 1) {
    base.c[i * 3] = rgba[i * 4];
    base.c[i * 3 + 1] = rgba[i * 4 + 1];
    base.c[i * 3 + 2] = rgba[i * 4 + 2];
  }
  const levels: Level[] = [base];
  // Pull: weighted 2x2 averages until 1x1.
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const prev = levels[levels.length - 1];
    const nw = Math.max(1, Math.ceil(prev.w / 2));
    const nh = Math.max(1, Math.ceil(prev.h / 2));
    const next: Level = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), a: new Float32Array(nw * nh) };
    for (let y = 0; y < nh; y += 1) {
      for (let x = 0; x < nw; x += 1) {
        let sa = 0, sr = 0, sg = 0, sb = 0;
        for (let dy = 0; dy < 2; dy += 1) {
          for (let dx = 0; dx < 2; dx += 1) {
            const px = Math.min(prev.w - 1, x * 2 + dx);
            const py = Math.min(prev.h - 1, y * 2 + dy);
            const j = py * prev.w + px;
            const a = prev.a[j];
            sa += a;
            sr += prev.c[j * 3] * a;
            sg += prev.c[j * 3 + 1] * a;
            sb += prev.c[j * 3 + 2] * a;
          }
        }
        const i = y * nw + x;
        if (sa > 1e-6) {
          next.c[i * 3] = sr / sa;
          next.c[i * 3 + 1] = sg / sa;
          next.c[i * 3 + 2] = sb / sa;
        }
        next.a[i] = Math.min(1, sa);
      }
    }
    levels.push(next);
  }
  // Push: blend each level's uncertain pixels with the (bilinearly upsampled) coarser level.
  for (let l = levels.length - 2; l >= 0; l -= 1) {
    const fine = levels[l];
    const coarse = levels[l + 1];
    for (let y = 0; y < fine.h; y += 1) {
      const cy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(cy), y1 = Math.min(coarse.h - 1, y0 + 1), ty = cy - y0;
      for (let x = 0; x < fine.w; x += 1) {
        const i = y * fine.w + x;
        const a = fine.a[i];
        if (a >= 1) continue;
        const cx = Math.min(coarse.w - 1, Math.max(0, (x + 0.5) / 2 - 0.5));
        const x0 = Math.floor(cx), x1 = Math.min(coarse.w - 1, x0 + 1), tx = cx - x0;
        for (let ch = 0; ch < 3; ch += 1) {
          const v00 = coarse.c[(y0 * coarse.w + x0) * 3 + ch], v01 = coarse.c[(y0 * coarse.w + x1) * 3 + ch];
          const v10 = coarse.c[(y1 * coarse.w + x0) * 3 + ch], v11 = coarse.c[(y1 * coarse.w + x1) * 3 + ch];
          const up = (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty;
          fine.c[i * 3 + ch] = fine.c[i * 3 + ch] * a + up * (1 - a);
        }
        fine.a[i] = 1;
      }
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    out[i * 4] = base.c[i * 3];
    out[i * 4 + 1] = base.c[i * 3 + 1];
    out[i * 4 + 2] = base.c[i * 3 + 2];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Build the plate from a small RGBA copy of the portrait and the subject matte at the same size.
 * The hole is the subject grown by ~2.5 % of the long side (covers matte edge error and soft hair edges).
 */
export function buildPlate(rgba: Uint8ClampedArray, matte: Uint8Array, w: number, h: number): Plate {
  const binary = new Uint8Array(w * h);
  for (let i = 0; i < binary.length; i += 1) binary[i] = matte[i] > 40 ? 255 : 0;
  const grow = Math.max(1, Math.round(Math.max(w, h) * 0.025));
  const grown = dilate(binary, w, h, grow);
  const known = new Float32Array(w * h);
  for (let i = 0; i < known.length; i += 1) known[i] = grown[i] > 0 ? 0 : 1;
  const fill = pushPull(rgba, known, w, h);
  // Feather inward from the grown edge so the seam between original and reconstruction is invisible.
  const hole = boxBlur(grown, w, h, Math.max(1, Math.round(grow / 2)));
  return { width: w, height: h, fill, hole };
}

/** How much of the picture (and of the face) the matte claims; used to reject unreliable mattes. */
export function matteQuality(matte: Uint8Array, w: number, h: number, facePoints: { x: number; y: number }[]): MatteQuality {
  let sum = 0;
  for (let i = 0; i < matte.length; i += 1) sum += matte[i];
  let face = 0;
  for (const p of facePoints) {
    const x = Math.min(w - 1, Math.max(0, Math.round(p.x * w)));
    const y = Math.min(h - 1, Math.max(0, Math.round(p.y * h)));
    face += matte[y * w + x];
  }
  return { coverage: sum / (255 * matte.length), faceCoverage: facePoints.length ? face / (255 * facePoints.length) : 0 };
}
