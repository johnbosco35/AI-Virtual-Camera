import { useEffect } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Activate } from '@/screens/Activate';
import { Complete } from '@/screens/Complete';
import { Help } from '@/screens/Help';
import { Preview } from '@/screens/Preview';
import { Session } from '@/screens/Session';
import { Welcome } from '@/screens/Welcome';
import { useAppStore } from '@/store/appStore';
import { AvatarSelection } from '@/screens/AvatarSelection';
import { DeviceVerification } from '@/screens/DeviceVerification';
import { Privacy } from '@/screens/Privacy';
import { VirtualCamera } from '@/screens/VirtualCamera';
import { CameraSettings } from '@/screens/CameraSettings';
import { Recovery } from '@/screens/Recovery';
import { Purchase } from '@/screens/Purchase';
import { Studio } from '@/screens/Studio';
import { Voice } from '@/screens/Voice';
import { Background } from '@/screens/Background';

const screens = {
  welcome: Welcome,
  activate: Activate,
  preview: Preview,
  session: Session,
  complete: Complete,
  help: Help,
  device: DeviceVerification,
  avatars: AvatarSelection,
  camera: CameraSettings,
  'virtual-camera': VirtualCamera,
  privacy: Privacy,
  recovery: Recovery,
  purchase: Purchase,
  voice: Voice,
  background: Background,
  studio: Studio,
} as const;

export function App() {
  const screen = useAppStore((s) => s.screen);
  const customAvatar = useAppStore((s) => s.customAvatar);
  const customBackground = useAppStore((s) => s.customBackground);
  const Screen = screens[screen];

  useEffect(() => () => {
    if (customAvatar?.url) URL.revokeObjectURL(customAvatar.url);
    if (customBackground?.url) URL.revokeObjectURL(customBackground.url);
  }, [customAvatar?.url, customBackground?.url]);

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 overflow-auto p-8">
        <Screen />
      </main>
    </div>
  );
}
