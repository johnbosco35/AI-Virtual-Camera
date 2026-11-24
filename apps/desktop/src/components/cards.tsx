import { Icon } from '@/components/Icon';
import { useAsyncUrl } from '@/components/ui';
import { engine } from '@/lib/engine';
import { checkedMediaUrl, usePlayer } from '@/lib/player';
import type { Avatar, Voice } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

export function AvatarImage({ avatar, className = '' }: { avatar: Avatar; className?: string }) {
  const url = useAsyncUrl(() => engine.avatarImageUrl(avatar), [avatar.id, avatar.updated_at]);
  return url ? (
    <img src={url} alt={avatar.name} draggable={false} className={`object-cover ${className}`} />
  ) : (
    <div className={`animate-pulse bg-raised ${className}`} />
  );
}

export function CompatibilityBadge({ avatar }: { avatar: Avatar }) {
  const analysing = useAppStore((s) => !!s.analysing[avatar.id]) || (!avatar.has_landmarks && avatar.compatibility_note.startsWith('Analysing'));
  if (analysing) return <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold text-[#A99CFF]">Analysing…</span>;
  if (!avatar.has_landmarks) return <span className="rounded-full bg-bad/15 px-2 py-0.5 text-[10px] font-semibold text-bad" title={avatar.compatibility_note}>No face</span>;
  const pct = Math.round(avatar.compatibility * 100);
  const tone = pct >= 70 ? 'bg-ok/15 text-ok' : pct >= 45 ? 'bg-warn/15 text-warn' : 'bg-bad/15 text-bad';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${tone}`} title={avatar.compatibility_note}>{pct}% match</span>;
}

/** Plays a voice's AI preview (rendered on first request by the engine). */
export function PreviewButton({ voice, kind = 'preview' }: { voice: Voice; kind?: 'preview' | 'sample' }) {
  const key = `${kind}:${voice.id}`;
  const playing = usePlayer((s) => s.playingKey === key);
  const loading = usePlayer((s) => s.loadingKey === key);
  const play = usePlayer((s) => s.play);
  const toast = useAppStore((s) => s.toast);
  const output = useAppStore((s) => s.settings.audio_output_device_id);
  const modelReady = useAppStore((s) => s.status?.model_state === 'ready');
  const disabled = kind === 'preview' ? !modelReady || !voice.ready : !voice.has_sample;
  const label = kind === 'preview' ? 'AI preview' : 'Original sample';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        const url = checkedMediaUrl(kind === 'preview' ? engine.voicePreviewUrl(voice, voice.created_at) : engine.voiceSampleUrl(voice, voice.created_at));
        play(key, url, output).catch((e: Error) => toast(e.message, 'warn'));
      }}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${playing ? 'bg-accent text-white' : 'bg-raised text-text ring-1 ring-line hover:ring-accent/50'}`}
      title={kind === 'preview' ? 'A neutral sentence converted into this voice on your PC (AI-generated audio)' : 'The recording this voice was created from'}
    >
      {loading ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon name={playing ? 'pause' : 'play'} className="h-3 w-3" filled />}
      {loading ? 'Rendering…' : playing ? 'Stop' : label}
    </button>
  );
}

const hues = ['from-[#7C6CFF] to-[#22D3EE]', 'from-[#F472B6] to-[#7C6CFF]', 'from-[#34D399] to-[#22D3EE]', 'from-[#FBBF24] to-[#F472B6]', 'from-[#60A5FA] to-[#A78BFA]'];

export function VoiceGlyph({ voice, size = 'md' }: { voice: Voice; size?: 'sm' | 'md' }) {
  const hue = hues[Math.abs([...voice.id].reduce((h, c) => h * 31 + c.charCodeAt(0), 7)) % hues.length];
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${hue} text-white ${size === 'sm' ? 'h-8 w-8' : 'h-11 w-11'}`}>
      <Icon name="wave" className={size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'} />
    </span>
  );
}
