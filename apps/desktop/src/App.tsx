import { useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Toasts } from '@/components/Toasts';
import { Dashboard } from '@/screens/Dashboard';
import { MyAvatars } from '@/screens/MyAvatars';
import { MyVoices } from '@/screens/MyVoices';
import { Recordings } from '@/screens/Recordings';
import { Settings } from '@/screens/Settings';
import { Studio } from '@/screens/Studio';
import { VoiceLibrary } from '@/screens/VoiceLibrary';
import { useAppStore } from '@/store/appStore';

const screens = {
  dashboard: Dashboard,
  studio: Studio,
  avatars: MyAvatars,
  'voice-library': VoiceLibrary,
  'my-voices': MyVoices,
  recordings: Recordings,
  settings: Settings,
} as const;

export function App() {
  const screen = useAppStore((s) => s.screen);
  const refreshStatus = useAppStore((s) => s.refreshStatus);
  const modelState = useAppStore((s) => s.status?.model_state);
  const online = useAppStore((s) => s.engineOnline);
  const Screen = screens[screen];

  // Poll the engine: quickly while it is starting or downloading, slowly once ready.
  useEffect(() => {
    void refreshStatus();
    const fast = online !== true || (modelState !== 'ready' && modelState !== 'missing');
    const timer = window.setInterval(() => void refreshStatus(), fast ? 1500 : 15000);
    return () => window.clearInterval(timer);
  }, [refreshStatus, online, modelState]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className={`min-w-0 flex-1 ${screen === 'studio' ? 'overflow-hidden p-6' : 'overflow-y-auto p-8'}`}>
        <div key={screen} className="h-full animate-fade-in">
          <Screen />
        </div>
      </main>
      <Toasts />
    </div>
  );
}
