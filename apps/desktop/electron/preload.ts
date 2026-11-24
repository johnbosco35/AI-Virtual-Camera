import { contextBridge, ipcRenderer } from 'electron';
import {
  AppInfoSchema,
  Channels,
  EngineConfigSchema,
  PerformanceMetricsSchema,
  SaveResultSchema,
  type AppInfo,
  type FrameConnectInput,
  type RecordingFileInput,
  type SaveResult,
  type EngineConfig,
  type PerformanceMetrics,
} from './ipc/schemas';

/** The only surface the renderer can touch. Responses are validated again here. */
const api = {
  getAppInfo: async (): Promise<AppInfo> => AppInfoSchema.parse(await ipcRenderer.invoke(Channels.getAppInfo)),
  getEngineConfig: async (): Promise<EngineConfig> => EngineConfigSchema.parse(await ipcRenderer.invoke(Channels.getEngineConfig)),
  getPerformanceMetrics: async (): Promise<PerformanceMetrics> =>
    PerformanceMetricsSchema.parse(await ipcRenderer.invoke(Channels.getPerformanceMetrics)),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(Channels.openExternal, { url }),
  saveRecording: async (input: RecordingFileInput): Promise<SaveResult> => SaveResultSchema.parse(await ipcRenderer.invoke(Channels.saveRecording, input)),
  showRecording: (input: Pick<RecordingFileInput, 'id' | 'format'>): Promise<void> => ipcRenderer.invoke(Channels.showRecording, input),
  frameConnect: (input: FrameConnectInput): Promise<void> => ipcRenderer.invoke(Channels.frameConnect, input),
  frameSend: async (frame: Uint8Array): Promise<boolean> => (await ipcRenderer.invoke(Channels.frameSend, frame)) === true,
  frameClose: (): Promise<void> => ipcRenderer.invoke(Channels.frameClose),
};

contextBridge.exposeInMainWorld('avc', api);
export type AvcApi = typeof api;
