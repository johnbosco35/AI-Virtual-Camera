import { z } from 'zod';

/**
 * Single source of truth for every IPC channel.
 * The main process validates all input with these schemas; the preload
 * exposes one narrow function per channel and nothing else.
 */
export const Channels = {
  getAppInfo: 'app:get-info',
  getEngineConfig: 'engine:get-config',
  getPerformanceMetrics: 'app:get-performance-metrics',
  openExternal: 'shell:open-external',
  saveRecording: 'recordings:save-as',
  showRecording: 'recordings:show-in-folder',
  frameConnect: 'vcam:frame-connect',
  frameSend: 'vcam:frame-send',
  frameClose: 'vcam:frame-close',
} as const;

/** Largest virtual-camera frame: 1920x1080 RGBA. */
export const MAX_FRAME_BYTES = 1920 * 1080 * 4;

export const FrameConnectInputSchema = z.object({
  port: z.number().int().min(1024).max(65535),
  token: z.string().regex(/^[0-9a-f]{32}$/),
  frameBytes: z.number().int().positive().max(MAX_FRAME_BYTES),
});
export type FrameConnectInput = z.infer<typeof FrameConnectInputSchema>;

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  dataDir: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

/** Where the local AI engine listens and the per-launch token it accepts. */
export const EngineConfigSchema = z.object({
  baseUrl: z.string().url(),
  token: z.string(),
});
export type EngineConfig = z.infer<typeof EngineConfigSchema>;

export const PerformanceMetricsSchema = z.object({
  cpuPercent: z.number().finite().nonnegative(),
  sampledAt: z.number().int().nonnegative(),
});
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

/** Recordings are addressed by id + container only; the main process builds the path itself. */
export const RecordingFileInputSchema = z.object({
  id: z.string().uuid(),
  format: z.enum(['mp4', 'webm']),
  suggestedName: z.string().max(120).optional(),
});
export type RecordingFileInput = z.infer<typeof RecordingFileInputSchema>;

export const SaveResultSchema = z.object({ saved: z.boolean(), path: z.string().optional() });
export type SaveResult = z.infer<typeof SaveResultSchema>;

export const OpenExternalInputSchema = z.object({
  url: z.string().url().max(2048),
});

/** Hosts the app may open in the user's browser. Extend deliberately. */
export const EXTERNAL_HOST_ALLOWLIST = ['github.com', 'huggingface.co', 'obsproject.com', 'vb-audio.com'];
