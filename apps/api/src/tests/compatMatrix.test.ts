import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const row = z.object({
  id: z.string(),
  targetApplication: z.string(),
  applicationVersion: z.string().nullable(),
  windowsVersion: z.string().nullable(),
  browserVersion: z.string().nullable(),
  virtualCameraImplementation: z.string().nullable(),
  appearsInDeviceList: z.boolean().nullable(),
  selectable: z.boolean().nullable(),
  livePreview: z.boolean().nullable(),
  animatedOutputCorrect: z.boolean().nullable(),
  stable15Minutes: z.boolean().nullable(),
  cameraSwitchReconnectSafe: z.boolean().nullable(),
  audioVideoNotes: z.string().nullable(),
  testDate: z.string().nullable(),
  result: z.enum(['NOT_TESTED', 'PASS', 'PARTIAL', 'FAIL']),
  notes: z.string(),
  reproSteps: z.string(),
});

const file = path.resolve(process.cwd(), '../../docs/compatibility-matrix.json');
const rows = z.array(row).parse(JSON.parse(fs.readFileSync(file, 'utf8')).platforms);

describe('compatibility matrix integrity', () => {
  it('covers every platform required by the spec', () => {
    const ids = rows.map((r) => r.id);
    for (const required of ['whatsapp', 'telegram', 'zoom', 'google-meet-chrome', 'google-meet-edge', 'wechat', 'teams', 'discord', 'skype']) {
      expect(ids).toContain(required);
    }
  });

  it('only allows PASS with complete evidence (detected-but-blank is never a pass)', () => {
    for (const r of rows.filter((x) => x.result === 'PASS')) {
      expect(r.applicationVersion, `${r.id} version`).toBeTruthy();
      expect(r.windowsVersion, `${r.id} windows`).toBeTruthy();
      expect(r.virtualCameraImplementation, `${r.id} vcam`).toBeTruthy();
      expect(r.testDate, `${r.id} date`).toBeTruthy();
      for (const k of ['appearsInDeviceList', 'selectable', 'livePreview', 'animatedOutputCorrect', 'stable15Minutes', 'cameraSwitchReconnectSafe'] as const) {
        expect(r[k], `${r.id} ${k}`).toBe(true);
      }
      expect(r.reproSteps.length, `${r.id} steps`).toBeGreaterThan(10);
    }
  });

  it('requires an explanation for PARTIAL and FAIL results', () => {
    for (const r of rows.filter((x) => x.result === 'PARTIAL' || x.result === 'FAIL')) {
      expect(r.notes.length, `${r.id} notes`).toBeGreaterThan(10);
      expect(r.testDate, `${r.id} date`).toBeTruthy();
    }
  });
});
