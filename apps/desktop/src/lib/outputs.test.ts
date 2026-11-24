import { describe, expect, it } from 'vitest';
import { pickMimeType } from '@/hooks/useOutputRecorder';
import { looksLikeVirtualCable } from '@/lib/audio';
import { buildPlate, dilate, matteQuality, pushPull, resample } from '@/lib/backgroundPlate';
import { containRect, coverRect } from '@/lib/outputCompositor';

/** Synthetic portrait: left half red, right half blue, with a green "person" disc in the middle. */
function scene(w: number, h: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const matte = new Uint8Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const person = Math.hypot(x - w / 2, y - h / 2) < w / 5;
      rgba.set(person ? [0, 255, 0, 255] : x < w / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
      matte[i] = person ? 255 : 0;
    }
  }
  return { rgba, matte };
}

describe('background plate (static background)', () => {
  it('leaves every background pixel outside the subject untouched', () => {
    const w = 80, h = 60;
    const { rgba, matte } = scene(w, h);
    const plate = buildPlate(rgba, matte, w, h);
    // Where the hole is 0 the renderer shows the original image; the plate also keeps the original there.
    let checked = 0;
    for (let i = 0; i < w * h; i += 1) {
      if (plate.hole[i] === 0) {
        expect(Array.from(plate.fill.slice(i * 4, i * 4 + 3))).toEqual(Array.from(rgba.slice(i * 4, i * 4 + 3)));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(w * h * 0.5);
  });

  it('reconstructs the subject area from the background, without any subject colour', () => {
    const w = 80, h = 60;
    const { rgba, matte } = scene(w, h);
    const plate = buildPlate(rgba, matte, w, h);
    const centre = ((h / 2) * w + w / 2) * 4;
    expect(plate.hole[(h / 2) * w + w / 2]).toBe(255);
    expect(plate.fill[centre + 1]).toBeLessThan(10); // no green from the person
    // Left of centre continues the red background, right of centre the blue one.
    const left = ((h / 2) * w + Math.round(w / 2 - w / 7)) * 4;
    const right = ((h / 2) * w + Math.round(w / 2 + w / 7)) * 4;
    expect(plate.fill[left]).toBeGreaterThan(plate.fill[left + 2]);
    expect(plate.fill[right + 2]).toBeGreaterThan(plate.fill[right]);
  });

  it('push-pull fills holes smoothly and keeps known pixels', () => {
    const w = 16, h = 1;
    const rgba = new Uint8ClampedArray(w * 4);
    const known = new Float32Array(w);
    for (let x = 0; x < w; x += 1) { rgba.set([x * 16, 0, 0, 255], x * 4); known[x] = x < 4 || x > 11 ? 1 : 0; }
    const out = pushPull(rgba, known, w, h);
    expect(out[0]).toBe(0);
    expect(out[15 * 4]).toBe(240);
    for (let x = 4; x <= 11; x += 1) expect(out[x * 4]).toBeGreaterThan(0);
  });

  it('dilates and resamples mattes', () => {
    const m = new Uint8Array(25);
    m[12] = 255;
    expect(Array.from(dilate(m, 5, 5, 1)).filter((v) => v === 255).length).toBe(9);
    const up = resample(new Uint8Array([0, 255]), 2, 1, 4, 1);
    expect(up[0]).toBe(0);
    expect(up[3]).toBe(255);
  });

  it('rejects mattes that miss the face or cover the whole picture', () => {
    const w = 40, h = 40;
    const { matte } = scene(w, h);
    expect(matteQuality(matte, w, h, [{ x: 0.5, y: 0.5 }]).faceCoverage).toBe(1);
    expect(matteQuality(matte, w, h, [{ x: 0.05, y: 0.05 }]).faceCoverage).toBe(0);
    expect(matteQuality(new Uint8Array(w * h).fill(255), w, h, []).coverage).toBe(1);
  });
});

describe('output framing', () => {
  it('crops a portrait picture to 16:9 around the face, inside the image', () => {
    const r = coverRect(1000, 1500, 1280, 720, { x: 0.5, y: 0.3 });
    expect(r.width).toBe(1000);
    expect(r.height).toBeCloseTo(562.5);
    expect(r.y).toBeCloseTo(0.3 * 1500 - 562.5 / 2);
    const clamped = coverRect(1000, 1500, 1280, 720, { x: 0.5, y: 0.01 });
    expect(clamped.y).toBe(0);
  });

  it('fits the whole picture when asked', () => {
    const r = containRect(1000, 1500, 1280, 720);
    expect(r.height).toBe(720);
    expect(r.x).toBeCloseTo((1280 - 480) / 2);
  });
});

describe('recorder format choice', () => {
  it('prefers native MP4 when supported and falls back to WebM', () => {
    expect(pickMimeType('mp4', (t) => t.startsWith('video/mp4;codecs=avc1'))).toMatch(/^video\/mp4/);
    expect(pickMimeType('mp4', (t) => t.startsWith('video/webm'))).toMatch(/^video\/webm/);
    expect(pickMimeType('webm', () => true)).toMatch(/^video\/webm/);
    expect(pickMimeType('webm', () => false)).toBeNull();
  });
});

describe('virtual cable detection', () => {
  it('recognises common virtual audio cables', () => {
    for (const label of ['CABLE Input (VB-Audio Virtual Cable)', 'VoiceMeeter Input (VB-Audio VoiceMeeter VAIO)', 'Line 1 (Virtual Audio Cable)']) expect(looksLikeVirtualCable(label)).toBe(true);
    for (const label of ['Speakers (Realtek(R) Audio)', 'Headphones (USB Audio)']) expect(looksLikeVirtualCable(label)).toBe(false);
  });
});
