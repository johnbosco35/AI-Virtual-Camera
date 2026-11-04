import type { AppInfo, DeviceFingerprint, PerformanceMetrics, VirtualCameraStatus } from '@shared/schemas';

/** Thin wrapper so the UI also runs in a plain browser (for screenshots and tests). */
export const native = {
  async getAppInfo(): Promise<AppInfo> {
    return window.avc?.getAppInfo() ?? { name: 'AI Virtual Camera', version: 'dev', platform: 'web' };
  },
  async getDeviceFingerprint(): Promise<DeviceFingerprint> {
    return window.avc?.getDeviceFingerprint() ?? { fingerprint: '0'.repeat(64) };
  },
  async getVirtualCameraStatus(): Promise<VirtualCameraStatus> {
    return (
      window.avc?.getVirtualCameraStatus() ?? {
        state: 'unsupported',
        detail: 'Running outside the desktop app.',
      }
    );
  },
  async getPerformanceMetrics(): Promise<PerformanceMetrics | null> {
    return window.avc?.getPerformanceMetrics() ?? null;
  },
};
