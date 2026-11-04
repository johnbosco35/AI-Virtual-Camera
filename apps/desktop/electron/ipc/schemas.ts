import { z } from 'zod';

/**
 * Single source of truth for every IPC channel.
 * The main process validates all input with these schemas; the preload
 * exposes one narrow function per channel and nothing else.
 */
export const Channels = {
  getAppInfo: 'app:get-info',
  getDeviceFingerprint: 'device:get-fingerprint',
  getVirtualCameraStatus: 'vcam:get-status',
  getPerformanceMetrics: 'app:get-performance-metrics',
  openExternal: 'shell:open-external',
} as const;

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

/** Hash only. The raw machine id never leaves the main process. */
export const DeviceFingerprintSchema = z.object({
  fingerprint: z.string().length(64),
});
export type DeviceFingerprint = z.infer<typeof DeviceFingerprintSchema>;

export const VirtualCameraStatusSchema = z.object({
  state: z.enum(['unsupported', 'not-installed', 'installed', 'running']),
  detail: z.string(),
});
export type VirtualCameraStatus = z.infer<typeof VirtualCameraStatusSchema>;

export const PerformanceMetricsSchema = z.object({
  cpuPercent: z.number().finite().nonnegative(),
  sampledAt: z.number().int().nonnegative(),
});
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

export const OpenExternalInputSchema = z.object({
  url: z.string().url().max(2048),
});

/** Hosts the app may open in the user's browser. Extend deliberately. */
export const EXTERNAL_HOST_ALLOWLIST = ['example.com'];
