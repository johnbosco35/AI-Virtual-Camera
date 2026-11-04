import { useAppStore, type ScreenId } from '@/store/appStore';

const items: { id: ScreenId; label: string }[] = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'device', label: 'Device verification' },
  { id: 'activate', label: 'Activate' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'avatars', label: 'Avatar selection' },
  { id: 'camera', label: 'Camera settings' },
  { id: 'preview', label: 'Camera preview' },
  { id: 'session', label: 'Session' },
  { id: 'studio', label: 'Studio' },
  { id: 'virtual-camera', label: 'Virtual camera' },
  { id: 'voice', label: 'Voice' },
  { id: 'background', label: 'Background' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'complete', label: 'Session complete' },
  { id: 'help', label: 'Help' },
];

export function Sidebar() {
  const screen = useAppStore((s) => s.screen);
  const go = useAppStore((s) => s.go);
  const entitlement = useAppStore((s) => s.entitlement);

  return (
    <nav className="flex w-56 shrink-0 flex-col overflow-y-auto bg-slate9 p-4 text-slate-200" aria-label="Main">
      <div className="mb-6 text-lg font-semibold text-white">AI Virtual Camera</div>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.id}>
            <button
              onClick={() => go(item.id)}
              aria-current={screen === item.id ? 'page' : undefined}
              className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                screen === item.id ? 'bg-slate8 text-white' : 'hover:bg-slate8/60'
              }`}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto text-xs text-slate-400">
        Entitlement: <span className="text-slate-200">{entitlement.status}</span>
      </div>
    </nav>
  );
}
