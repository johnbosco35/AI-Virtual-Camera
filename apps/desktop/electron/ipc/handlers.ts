import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { FrameChannel } from '../frameChannel';
import {
  Channels,
  EXTERNAL_HOST_ALLOWLIST,
  FrameConnectInputSchema,
  MAX_FRAME_BYTES,
  OpenExternalInputSchema,
  RecordingFileInputSchema,
  type SaveResult,
  type AppInfo,
  type EngineConfig,
  type PerformanceMetrics,
} from './schemas';

/** Reject IPC calls that do not come from our own top-level window. */
function assertTrustedSender(event: IpcMainInvokeEvent, trustedOrigins: string[]) {
  const url = event.senderFrame?.url ?? '';
  const ok = trustedOrigins.some((origin) => url.startsWith(origin));
  if (!ok) throw new Error('Untrusted IPC sender');
}

export function registerIpcHandlers(trustedOrigins: string[], engine: () => EngineConfig & { dataDir: string }) {
  ipcMain.handle(Channels.getAppInfo, (event): AppInfo => {
    assertTrustedSender(event, trustedOrigins);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform, dataDir: engine().dataDir };
  });

  ipcMain.handle(Channels.getEngineConfig, (event): EngineConfig => {
    assertTrustedSender(event, trustedOrigins);
    const { baseUrl, token } = engine();
    return { baseUrl, token };
  });

  ipcMain.handle(Channels.getPerformanceMetrics, (event): PerformanceMetrics => {
    assertTrustedSender(event, trustedOrigins);
    const rendererPid = event.sender.getOSProcessId();
    const renderer = app.getAppMetrics().find((metric) => metric.pid === rendererPid);
    if (!renderer) throw new Error('Renderer CPU metrics are not available.');
    return { cpuPercent: renderer.cpu.percentCPUUsage, sampledAt: Date.now() };
  });

  const recordingFile = async (input: unknown) => {
    const { id, format, suggestedName } = RecordingFileInputSchema.parse(input);
    const dir = path.resolve(engine().dataDir, 'recordings');
    const file = path.resolve(dir, `${id}.${format}`);
    if (path.dirname(file) !== dir) throw new Error('Invalid recording path');
    await stat(file); // throws if missing
    const safeName = (suggestedName ?? 'recording').replace(/[^\w\- ]+/g, '').trim() || 'recording';
    return { file, format, safeName };
  };

  ipcMain.handle(Channels.saveRecording, async (event, input: unknown): Promise<SaveResult> => {
    assertTrustedSender(event, trustedOrigins);
    const { file, format, safeName } = await recordingFile(input);
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const options = {
      title: 'Save recording',
      defaultPath: path.join(app.getPath('videos'), `${safeName}.${format}`),
      filters: [format === 'mp4' ? { name: 'MP4 video (H.264)', extensions: ['mp4'] } : { name: 'WebM video', extensions: ['webm'] }],
    };
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return { saved: false };
    await copyFile(file, result.filePath);
    return { saved: true, path: result.filePath };
  });

  ipcMain.handle(Channels.showRecording, async (event, input: unknown) => {
    assertTrustedSender(event, trustedOrigins);
    const { file } = await recordingFile(input);
    shell.showItemInFolder(file);
  });

  // Virtual-camera frames: renderer → main → local TCP → engine (see frameChannel.ts).
  const frames = new FrameChannel();
  ipcMain.handle(Channels.frameConnect, async (event, input: unknown) => {
    assertTrustedSender(event, trustedOrigins);
    const { port, token, frameBytes } = FrameConnectInputSchema.parse(input);
    await frames.connect(port, token, frameBytes);
  });
  ipcMain.handle(Channels.frameSend, async (event, frame: unknown) => {
    assertTrustedSender(event, trustedOrigins);
    if (!(frame instanceof Uint8Array) || frame.byteLength > MAX_FRAME_BYTES) throw new Error('Invalid frame');
    return frames.send(frame);
  });
  ipcMain.handle(Channels.frameClose, (event) => {
    assertTrustedSender(event, trustedOrigins);
    frames.close();
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
