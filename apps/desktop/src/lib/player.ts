import { create } from 'zustand';
import { setElementSink } from '@/lib/audio';

/** One shared preview player so only one clip plays at a time. */
interface PlayerState {
  playingKey: string | null;
  loadingKey: string | null;
  play: (key: string, url: string | Promise<string>, outputDeviceId?: string | null) => Promise<void>;
  stop: () => void;
}

const element = typeof Audio !== 'undefined' ? new Audio() : null;

export const usePlayer = create<PlayerState>((set, get) => {
  element?.addEventListener('ended', () => set({ playingKey: null }));
  element?.addEventListener('error', () => set({ playingKey: null, loadingKey: null }));
  return {
    playingKey: null,
    loadingKey: null,
    play: async (key, url, outputDeviceId) => {
      if (!element) return;
      if (get().playingKey === key) {
        get().stop();
        return;
      }
      element.pause();
      set({ loadingKey: key, playingKey: null });
      try {
        const resolved = await url;
        if (element.src.startsWith('blob:')) URL.revokeObjectURL(element.src);
        element.src = resolved;
        await setElementSink(element, outputDeviceId ?? null).catch(() => undefined);
        await element.play();
        set({ playingKey: key, loadingKey: null });
      } catch (cause) {
        set({ loadingKey: null, playingKey: null });
        throw cause;
      }
    },
    stop: () => {
      element?.pause();
      set({ playingKey: null, loadingKey: null });
    },
  };
});

/** Preview URLs may need first-time rendering by the engine; surface engine errors as text. */
export async function checkedMediaUrl(url: Promise<string>) {
  const resolved = await url;
  const response = await fetch(resolved, { method: 'GET' });
  if (!response.ok) {
    let message = `Preview unavailable (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') message = body.detail;
    } catch { /* not JSON */ }
    throw new Error(message);
  }
  return URL.createObjectURL(await response.blob());
}
