import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { createHash } from 'node:crypto';
import { machineIdSync } from 'node-machine-id';
import {
  Channels,
  EXTERNAL_HOST_ALLOWLIST,
  OpenExternalInputSchema,
  type AppInfo,
  type DeviceFingerprint,
  type PerformanceMetrics,
  type VirtualCameraStatus,
} from './schemas';

/** Reject IPC calls that do not come from our own top-level window. */
function assertTrustedSender(event: IpcMainInvokeEvent, trustedOrigins: string[]) {
  const url = event.senderFrame?.url ?? '';
  const ok = trustedOrigins.some((origin) => url.startsWith(origin));
  if (!ok) throw new Error('Untrusted IPC sender');
}

export function registerIpcHandlers(trustedOrigins: string[]) {
  ipcMain.handle(Channels.getAppInfo, (event): AppInfo => {
    assertTrustedSender(event, trustedOrigins);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(Channels.getDeviceFingerprint, (event): DeviceFingerprint => {
    assertTrustedSender(event, trustedOrigins);
    // Salted hash of the OS machine id. The backend (Section 2) must treat this
    // as a client-supplied hint and combine it with server-side checks.
    const raw = machineIdSync(true);
    const fingerprint = createHash('sha256').update(`avc:v1:${raw}`).digest('hex');
    return { fingerprint };
  });

  ipcMain.handle(Channels.getVirtualCameraStatus, (event): VirtualCameraStatus => {
    assertTrustedSender(event, trustedOrigins);
    // TODO(native): query the native virtual camera component over its control pipe.
    if (process.platform !== 'win32') {
      return { state: 'unsupported', detail: 'The virtual camera is available on Windows only.' };
    }
    return { state: 'not-installed', detail: 'Native virtual camera component is not connected yet.' };
  });

  ipcMain.handle(Channels.getPerformanceMetrics, (event): PerformanceMetrics => {
    assertTrustedSender(event, trustedOrigins);
    const rendererPid = event.sender.getOSProcessId();
    const renderer = app.getAppMetrics().find((metric) => metric.pid === rendererPid);
    if (!renderer) throw new Error('Renderer CPU metrics are not available.');
    return { cpuPercent: renderer.cpu.percentCPUUsage, sampledAt: Date.now() };
  });

  ipcMain.handle(Channels.openExternal, async (event, input: unknown) => {
    assertTrustedSender(event, trustedOrigins);
    const { url } = OpenExternalInputSchema.parse(input);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !EXTERNAL_HOST_ALLOWLIST.includes(parsed.hostname)) {
      throw new Error('External URL not allowed');
    }
    await shell.openExternal(parsed.toString());
  });
}
