import { useMemo } from 'react';
import { Button } from '@/components/Button';
import { AvatarImage, CompatibilityBadge, PreviewButton, VoiceGlyph } from '@/components/cards';
import { EngineBanner } from '@/components/EngineBanner';
import { Icon, type IconName } from '@/components/Icon';
import { Card, CardHeader, EmptyState, formatDuration, timeAgo } from '@/components/ui';
import { useAppStore } from '@/store/appStore';

function Step({ done, label, detail, action }: { done: boolean; label: string; detail: string; action?: { text: string; onClick: () => void } }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? 'bg-ok/15 text-ok' : 'bg-line text-faint'}`}>
        <Icon name={done ? 'check' : 'plus'} className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${done ? 'text-muted line-through decoration-faint' : ''}`}>{label}</p>
        <p className="truncate text-xs text-faint">{detail}</p>
      </div>
      {!done && action && <Button size="sm" onClick={action.onClick}>{action.text}</Button>}
    </li>
  );
}

function Stat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-raised/60 px-4 py-3 ring-1 ring-line">
      <Icon name={icon} className="h-5 w-5 text-[#A99CFF]" />
      <div>
        <p className="text-lg font-semibold tabular-nums leading-tight">{value}</p>
        <p className="text-[11px] text-muted">{label}</p>
      </div>
    </div>
  );
}

export function Dashboard() {
  const avatars = useAppStore((s) => s.avatars);
  const voices = useAppStore((s) => s.voices);
  const sessions = useAppStore((s) => s.sessions);
  const status = useAppStore((s) => s.status);
  const settings = useAppStore((s) => s.settings);
  const go = useAppStore((s) => s.go);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const recentAvatars = useMemo(() => [...avatars].sort((a, b) => (b.last_used_at ?? b.created_at).localeCompare(a.last_used_at ?? a.created_at)).slice(0, 4), [avatars]);
  const featuredVoices = useMemo(() => [...voices].sort((a, b) => Number(b.favourite) - Number(a.favourite) || Number(b.kind === 'personal') - Number(a.kind === 'personal')).slice(0, 5), [voices]);
  const voiceCheck = status?.requirements.find((r) => r.id === 'voice');
  const totalMinutes = sessions.reduce((n, s) => n + s.duration_seconds, 0) / 60;

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(ellipse_at_top_left,rgba(124,108,255,.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(34,211,238,.16),transparent_50%)] p-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#A99CFF]">Welcome back</p>
        <h1 className="mt-2 max-w-2xl font-display text-3xl font-semibold leading-tight tracking-tight">
          Bring any portrait to life with <span className="text-gradient">your face and voice</span>.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-muted">Webcam tracking animates the avatar in real time, and speech-to-speech conversion gives it the voice you choose. Everything runs locally on this PC.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button variant="primary" size="lg" icon="studio" onClick={() => go('studio')}>Open Avatar Studio</Button>
          <Button size="lg" icon="upload" onClick={() => go('avatars')}>Upload avatar</Button>
        </div>
        <div className="mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon="avatars" label="Avatars" value={String(avatars.length)} />
          <Stat icon="library" label="Voices" value={String(voices.length)} />
          <Stat icon="clock" label="Studio minutes" value={totalMinutes.toFixed(0)} />
          <Stat icon="cpu" label="Voice RTF" value={status?.benchmark ? status.benchmark.rtf.toFixed(2) : '—'} />
        </div>
      </section>

      <EngineBanner />

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="pb-3 xl:col-span-2">
          <CardHeader title="Recently used avatars" icon="avatars" action={<Button size="sm" variant="ghost" onClick={() => go('avatars')}>All avatars →</Button>} />
          <div className="p-5 pt-4">
            {recentAvatars.length === 0 ? (
              <EmptyState icon="avatars" title="No avatars yet" body="Upload a portrait to get started." action={<Button variant="primary" icon="upload" onClick={() => go('avatars')}>Upload</Button>} />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {recentAvatars.map((a) => (
                  <button key={a.id} type="button" onClick={() => { void updateSettings({ selected_avatar_id: a.id }); go('studio'); }} className={`group overflow-hidden rounded-xl border text-left transition ${a.id === settings.selected_avatar_id ? 'border-accent/60' : 'border-line hover:border-accent/40'}`}>
                    <AvatarImage avatar={a} className="aspect-square w-full transition group-hover:scale-[1.03]" />
                    <div className="flex items-center justify-between gap-1 p-2.5">
                      <div className="min-w-0"><p className="truncate text-sm font-semibold">{a.name}</p><p className="text-[10px] text-faint">{timeAgo(a.last_used_at ?? a.created_at)}</p></div>
                      <CompatibilityBadge avatar={a} />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card className="pb-2">
          <CardHeader title="Get set up" icon="sparkle" />
          <ul className="divide-y divide-line px-5">
            <Step done={avatars.length > 0} label="Upload a portrait" detail="Photo, illustration or painting with a visible face" action={{ text: 'Upload', onClick: () => go('avatars') }} />
            <Step done={status?.model_state === 'ready'} label="Prepare the voice model" detail={status?.model_detail || 'OpenVoice V2, downloaded once'} action={{ text: 'Open', onClick: () => go('settings') }} />
            <Step done={!!settings.selected_voice_id} label="Pick a voice" detail="From the library or your own authorised sample" action={{ text: 'Browse', onClick: () => go('voice-library') }} />
            <Step done={!!status?.source_voice_ready} label="Calibrate your microphone voice" detail="Optional: better conversion from the first word" action={{ text: 'Calibrate', onClick: () => go('settings') }} />
          </ul>
          {voiceCheck && voiceCheck.status !== 'ok' && (
            <p className={`mx-5 mb-3 mt-2 rounded-lg p-2.5 text-xs ${voiceCheck.status === 'fail' ? 'bg-warn/10 text-warn' : 'bg-raised text-muted'}`}>{voiceCheck.detail}</p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="pb-3">
          <CardHeader title="Available voices" icon="library" action={<Button size="sm" variant="ghost" onClick={() => go('voice-library')}>Library →</Button>} />
          <ul className="space-y-1 px-3 pt-3">
            {featuredVoices.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted">Voices appear once the voice model is ready.</li>}
            {featuredVoices.map((v) => (
              <li key={v.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-raised/60">
                <VoiceGlyph voice={v} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{v.name} {v.id === settings.selected_voice_id && <span className="ml-1 text-[10px] font-bold text-[#A99CFF]">IN USE</span>}</p>
                  <p className="truncate text-xs text-muted">{v.kind === 'personal' ? 'My voice' : v.language}</p>
                </div>
                <PreviewButton voice={v} />
              </li>
            ))}
          </ul>
        </Card>

        <Card className="pb-3 xl:col-span-2">
          <CardHeader title="Recent sessions" icon="clock" />
          {sessions.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">Your studio sessions will be listed here.</p>
          ) : (
            <div className="overflow-x-auto px-5 pt-3">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-faint">
                  <tr><th className="py-2 font-semibold">When</th><th className="font-semibold">Avatar</th><th className="font-semibold">Voice</th><th className="font-semibold">Length</th><th className="font-semibold">Voice latency</th><th className="font-semibold">Tracking</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {sessions.map((s) => (
                    <tr key={s.id}>
                      <td className="py-2.5 text-muted">{timeAgo(s.started_at)}</td>
                      <td className="font-medium">{s.avatar_name || '—'}</td>
                      <td>{s.voice_name || <span className="text-faint">Face only</span>}</td>
                      <td className="tabular-nums">{formatDuration(s.duration_seconds)}</td>
                      <td className="tabular-nums text-muted">{s.avg_latency_ms === null ? '—' : s.avg_latency_ms < 2000 ? `${Math.round(s.avg_latency_ms)} ms` : `${(s.avg_latency_ms / 1000).toFixed(1)} s`}</td>
                      <td className="tabular-nums text-muted">{s.avg_tracking_fps === null ? '—' : `${Math.round(s.avg_tracking_fps)} fps`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
