import { contextBridge, ipcRenderer } from 'electron';
import {
  AppInfoSchema,
  Channels,
  DeviceFingerprintSchema,
  PerformanceMetricsSchema,
  VirtualCameraStatusSchema,
  type AppInfo,
  type DeviceFingerprint,
  type PerformanceMetrics,
  type VirtualCameraStatus,
} from './ipc/schemas';

/** The only surface the renderer can touch. Responses are validated again here. */
const api = {
  getAppInfo: async (): Promise<AppInfo> =>
    AppInfoSchema.parse(await ipcRenderer.invoke(Channels.getAppInfo)),
  getDeviceFingerprint: async (): Promise<DeviceFingerprint> =>
    DeviceFingerprintSchema.parse(await ipcRenderer.invoke(Channels.getDeviceFingerprint)),
  getVirtualCameraStatus: async (): Promise<VirtualCameraStatus> =>
    VirtualCameraStatusSchema.parse(await ipcRenderer.invoke(Channels.getVirtualCameraStatus)),
  getPerformanceMetrics: async (): Promise<PerformanceMetrics> =>
    PerformanceMetricsSchema.parse(await ipcRenderer.invoke(Channels.getPerformanceMetrics)),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(Channels.openExternal, { url }),
};

contextBridge.exposeInMainWorld('avc', api);
export type AvcApi = typeof api;
