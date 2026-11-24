import { Icon, type IconName } from '@/components/Icon';
import { useAppStore, type ScreenId } from '@/store/appStore';

const items: { id: ScreenId; label: string; icon: IconName }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'studio', label: 'Avatar Studio', icon: 'studio' },
  { id: 'avatars', label: 'My Avatars', icon: 'avatars' },
  { id: 'voice-library', label: 'Voice Library', icon: 'library' },
  { id: 'my-voices', label: 'My Voices', icon: 'mic' },
  { id: 'recordings', label: 'Recordings', icon: 'record' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function Sidebar() {
  const screen = useAppStore((s) => s.screen);
  const go = useAppStore((s) => s.go);
  const online = useAppStore((s) => s.engineOnline);
  const status = useAppStore((s) => s.status);

  const engineTone = online === false ? 'bg-bad' : status?.model_state === 'ready' ? 'bg-ok' : 'bg-warn';
  const engineLabel = online === false ? 'Engine offline' : status?.model_state === 'ready' ? `Engine ready · ${status.device.toUpperCase()}` : status ? `Voice model ${status.model_state}` : 'Connecting…';

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-line bg-panel/80 px-3 py-5" aria-label="Main">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 text-white shadow-glow">
          <Icon name="sparkle" className="h-5 w-5" />
        </span>
        <div>
          <div className="font-display text-[15px] font-semibold leading-tight">Avatar Studio</div>
          <div className="text-[11px] text-muted">Face &amp; voice AI · local</div>
        </div>
      </div>
      <ul className="space-y-1">
        {items.map((item) => {
          const active = screen === item.id;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => go(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${active ? 'bg-accent/15 text-white ring-1 ring-accent/30' : 'text-muted hover:bg-raised hover:text-text'}`}
              >
                <Icon name={item.icon} className={`h-[18px] w-[18px] ${active ? 'text-[#A99CFF]' : ''}`} />
                {item.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto space-y-3 px-2">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${engineTone}`} aria-hidden />
          {engineLabel}
        </div>
        <p className="text-[11px] leading-relaxed text-faint">All processing runs on this PC. Avatars and voices never leave it.</p>
      </div>
    </nav>
  );
}
