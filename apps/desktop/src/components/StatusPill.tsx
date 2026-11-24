export type Tone = 'ok' | 'warn' | 'bad' | 'idle' | 'info';

const tones: Record<Tone, string> = {
  ok: 'bg-ok/10 text-ok ring-ok/25',
  warn: 'bg-warn/10 text-warn ring-warn/25',
  bad: 'bg-bad/10 text-bad ring-bad/25',
  idle: 'bg-white/5 text-muted ring-white/10',
  info: 'bg-accent/10 text-[#A99CFF] ring-accent/25',
};

export function StatusPill({ tone, label, pulse = false }: { tone: Tone; label: string; pulse?: boolean }) {
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${tones[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${pulse ? 'animate-pulse' : ''}`} aria-hidden />
      {label}
    </span>
  );
}
