import { Icon } from '@/components/Icon';
import { useAppStore } from '@/store/appStore';

const tone = {
  ok: 'border-ok/30 text-ok',
  warn: 'border-warn/30 text-warn',
  bad: 'border-bad/30 text-bad',
  info: 'border-accent/30 text-[#A99CFF]',
};

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts);
  const dismiss = useAppStore((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex animate-fade-in items-start gap-2 rounded-xl border bg-raised/95 p-3 text-sm shadow-2xl backdrop-blur ${tone[t.tone]}`}>
          <Icon name={t.tone === 'ok' ? 'check' : t.tone === 'info' ? 'sparkle' : 'alert'} className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1 text-text">{t.text}</p>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-muted hover:text-text"><Icon name="close" className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
