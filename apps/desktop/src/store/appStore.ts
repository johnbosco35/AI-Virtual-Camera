import { create } from 'zustand';
import type { Entitlement } from '@/services/license';

export type ScreenId =
  | 'welcome'
  | 'activate'
  | 'preview'
  | 'session'
  | 'complete'
  | 'help'
  | 'device'
  | 'avatars'
  | 'camera'
  | 'virtual-camera'
  | 'privacy'
  | 'recovery'
  | 'purchase'
  | 'voice'
  | 'background'
  | 'studio';
export type AvatarId = 'aria' | 'sol' | 'milo' | 'custom';
export type BackgroundPreset = 'scene' | 'blur' | 'solid' | 'midnight' | 'sunset' | 'mint' | 'mountains' | 'city' | 'custom';

export interface CustomAvatar {
  id: string;
  blob: Blob;
  url: string;
  name: string;
}

export interface CustomBackground {
  url: string;
  name: string;
}

interface AppState {
  screen: ScreenId;
  fingerprint: string | null;
  entitlement: Entitlement;
  cameraDeviceId: string | null;
  cameraResolution: '720p' | '1080p';
  mirrorPreview: boolean;
  smoothingStrength: number;
  selectedAvatar: AvatarId;
  customAvatar: CustomAvatar | null;
  backgroundPreview: BackgroundPreset;
  customBackground: CustomBackground | null;
  microphoneDeviceId: string | null;
  audioOutputDeviceId: string | null;
  go: (screen: ScreenId) => void;
  setFingerprint: (fp: string) => void;
  setEntitlement: (e: Entitlement) => void;
  setCameraDeviceId: (id: string | null) => void;
  setCameraResolution: (resolution: '720p' | '1080p') => void;
  setMirrorPreview: (mirror: boolean) => void;
  setSmoothingStrength: (strength: number) => void;
  setSelectedAvatar: (avatar: AvatarId) => void;
  setCustomAvatar: (avatar: CustomAvatar | null) => void;
  setBackgroundPreview: (background: BackgroundPreset) => void;
  setCustomBackground: (background: CustomBackground | null) => void;
  setMicrophoneDeviceId: (id: string | null) => void;
  setAudioOutputDeviceId: (id: string | null) => void;
}

/** UI state only. Never treated as proof of payment or authorization. */
export const useAppStore = create<AppState>((set) => ({
  screen: 'welcome',
  fingerprint: null,
  entitlement: { status: 'none' },
  cameraDeviceId: null,
  cameraResolution: '720p',
  mirrorPreview: true,
  smoothingStrength: 0.55,
  selectedAvatar: 'aria',
  customAvatar: null,
  backgroundPreview: 'scene',
  customBackground: null,
  microphoneDeviceId: null,
  audioOutputDeviceId: null,
  go: (screen) => set({ screen }),
  setFingerprint: (fingerprint) => set({ fingerprint }),
  setEntitlement: (entitlement) => set({ entitlement }),
  setCameraDeviceId: (cameraDeviceId) => set({ cameraDeviceId }),
  setCameraResolution: (cameraResolution) => set({ cameraResolution }),
  setMirrorPreview: (mirrorPreview) => set({ mirrorPreview }),
  setSmoothingStrength: (smoothingStrength) => set({ smoothingStrength }),
  setSelectedAvatar: (selectedAvatar) => set({ selectedAvatar }),
  setCustomAvatar: (customAvatar) =>
    set((state) => {
      if (state.customAvatar?.url && state.customAvatar.url !== customAvatar?.url) {
        URL.revokeObjectURL(state.customAvatar.url);
      }
      return { customAvatar };
    }),
  setBackgroundPreview: (backgroundPreview) => set({ backgroundPreview }),
  setCustomBackground: (customBackground) =>
    set((state) => {
      if (state.customBackground?.url && state.customBackground.url !== customBackground?.url) {
        URL.revokeObjectURL(state.customBackground.url);
      }
      return { customBackground };
    }),
  setMicrophoneDeviceId: (microphoneDeviceId) => set({ microphoneDeviceId }),
  setAudioOutputDeviceId: (audioOutputDeviceId) => set({ audioOutputDeviceId }),
}));
