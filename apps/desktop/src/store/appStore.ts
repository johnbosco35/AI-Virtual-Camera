import { create } from 'zustand';
import { analyzePortrait } from '@/hooks/useFaceTracking';
import { engine, EngineError } from '@/lib/engine';
import { assessPortrait } from '@/lib/faceMesh';
import type { Avatar, StudioSessionRecord, StudioSettings, SystemStatus, Voice } from '@/lib/types';

export type ScreenId = 'dashboard' | 'studio' | 'avatars' | 'voice-library' | 'my-voices' | 'recordings' | 'settings';

export interface Toast {
  id: number;
  tone: 'ok' | 'warn' | 'bad' | 'info';
  text: string;
}

const defaultSettings: StudioSettings = {
  camera_device_id: null,
  camera_resolution: '720p',
  microphone_device_id: null,
  audio_output_device_id: null,
  mirror_preview: true,
  mirror_avatar: false,
  smoothing: 0.5,
  expression_gain: 1,
  head_motion_gain: 0.85,
  lip_sync_mode: 'hybrid',
  sync_video_to_voice: true,
  noise_suppression: true,
  echo_cancellation: true,
  monitor_converted_voice: true,
  selected_avatar_id: null,
  selected_voice_id: null,
  block_ms_override: 0,
  preserve_background: true,
  animation_engine: 'mesh',
  output_resolution: '720p',
  output_fps: 30,
  output_framing: 'fill',
  virtual_camera_backend: 'auto',
  virtual_camera_autostart: false,
  virtual_mic_device_id: null,
  virtual_mic_delay_ms: 0,
  recording_format: 'mp4',
  recording_quality: 'standard',
};

interface AppState {
  screen: ScreenId;
  engineOnline: boolean | null;
  status: SystemStatus | null;
  settings: StudioSettings;
  settingsLoaded: boolean;
  avatars: Avatar[];
  voices: Voice[];
  sessions: StudioSessionRecord[];
  analysing: Record<string, boolean>;
  toasts: Toast[];
  go: (screen: ScreenId) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  refreshStatus: () => Promise<void>;
  loadAll: () => Promise<void>;
  refreshAvatars: () => Promise<void>;
  refreshVoices: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  updateSettings: (patch: Partial<StudioSettings>) => Promise<void>;
  analyseAvatar: (avatar: Avatar) => Promise<void>;
}

let toastId = 0;

export const useAppStore = create<AppState>((set, get) => ({
  screen: 'dashboard',
  engineOnline: null,
  status: null,
  settings: defaultSettings,
  settingsLoaded: false,
  avatars: [],
  voices: [],
  sessions: [],
  analysing: {},
  toasts: [],

  go: (screen) => set({ screen }),

  toast: (text, tone = 'info') => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, text }] }));
    window.setTimeout(() => get().dismissToast(id), tone === 'bad' ? 7000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  refreshStatus: async () => {
    try {
      const status = await engine.status();
      const wasOffline = get().engineOnline !== true;
      const modelBecameReady = status.model_state === 'ready' && get().status?.model_state !== 'ready';
      set({ status, engineOnline: true });
      if (wasOffline) await get().loadAll();
      else if (modelBecameReady) await get().refreshVoices();
    } catch {
      set({ engineOnline: false });
    }
  },

  loadAll: async () => {
    try {
      const settings = await engine.settings();
      set({ settings: { ...defaultSettings, ...settings }, settingsLoaded: true });
    } catch { /* keep defaults */ }
    await Promise.all([get().refreshAvatars(), get().refreshVoices(), get().refreshSessions()]);
  },

  refreshAvatars: async () => {
    try {
      const avatars = await engine.avatars();
      set({ avatars });
      // Portraits uploaded or replaced but not yet analysed get their landmarks now.
      for (const avatar of avatars) {
        if (!avatar.has_landmarks && avatar.compatibility_note.startsWith('Analysing') && !get().analysing[avatar.id]) void get().analyseAvatar(avatar);
      }
      const selected = get().settings.selected_avatar_id;
      if (selected && !avatars.some((a) => a.id === selected)) void get().updateSettings({ selected_avatar_id: avatars[0]?.id ?? null });
    } catch (cause) {
      if (cause instanceof EngineError && cause.status === 0) set({ engineOnline: false });
    }
  },

  refreshVoices: async () => {
    try {
      const voices = await engine.voices();
      set({ voices });
      const selected = get().settings.selected_voice_id;
      if (selected && !voices.some((v) => v.id === selected)) void get().updateSettings({ selected_voice_id: null });
    } catch { /* surfaced by status */ }
  },

  refreshSessions: async () => {
    try {
      set({ sessions: await engine.sessions(8) });
    } catch { /* surfaced by status */ }
  },

  updateSettings: async (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    try {
      const saved = await engine.updateSettings(patch);
      set({ settings: { ...defaultSettings, ...saved } });
    } catch (cause) {
      get().toast(cause instanceof Error ? `Settings not saved: ${cause.message}` : 'Settings not saved.', 'warn');
    }
  },

  analyseAvatar: async (avatar) => {
    set((s) => ({ analysing: { ...s.analysing, [avatar.id]: true } }));
    try {
      const url = await engine.avatarImageUrl(avatar);
      const blob = await (await fetch(url)).blob();
      const analysis = await analyzePortrait(blob);
      const { score, note } = assessPortrait(analysis.landmarks, analysis.width, analysis.height, analysis.euler);
      const points = analysis.landmarks
        ? Array.from({ length: analysis.landmarks.length / 3 }, (_, i) => [analysis.landmarks![i * 3], analysis.landmarks![i * 3 + 1], analysis.landmarks![i * 3 + 2]] as [number, number, number])
        : null;
      const updated = await engine.setAvatarLandmarks(avatar.id, points, score, analysis.error ? `Analysis failed: ${analysis.error}` : note);
      set((s) => ({ avatars: s.avatars.map((a) => (a.id === updated.id ? updated : a)) }));
    } catch (cause) {
      get().toast(`Could not analyse “${avatar.name}”: ${cause instanceof Error ? cause.message : 'unknown error'}`, 'warn');
    } finally {
      set((s) => {
        const analysing = { ...s.analysing };
        delete analysing[avatar.id];
        return { analysing };
      });
    }
  },
}));
