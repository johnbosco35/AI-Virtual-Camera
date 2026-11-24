import { useMemo, useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import { PreviewButton, VoiceGlyph } from '@/components/cards';
import { EngineBanner } from '@/components/EngineBanner';
import { Icon } from '@/components/Icon';
import { TryVoiceModal } from '@/components/voiceTools';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { engine } from '@/lib/engine';
import type { Voice } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

export function VoiceCard({ voice, selected, onTry }: { voice: Voice; selected: boolean; onTry: () => void }) {
  const refreshVoices = useAppStore((s) => s.refreshVoices);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const toast = useAppStore((s) => s.toast);
  const modelReady = useAppStore((s) => s.status?.model_state === 'ready');
  const favourite = async () => {
    try {
      await engine.updateVoice(voice.id, { favourite: !voice.favourite });
      await refreshVoices();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Update failed.', 'bad');
    }
  };
  return (
    <Card className={`flex flex-col gap-3 p-4 transition ${selected ? 'border-accent/60 shadow-glow' : 'hover:border-[#2E3850]'}`}>
      <div className="flex items-start gap-3">
        <VoiceGlyph voice={voice} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-semibold">{voice.name}</h3>
            {selected && <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold text-white">SELECTED</span>}
          </div>
          <p className="text-xs text-muted">{voice.kind === 'personal' ? `My voice · ${voice.consent_subject}` : voice.language}</p>
        </div>
        <IconButton icon="star" label={voice.favourite ? 'Remove from favourites' : 'Save to favourites'} active={voice.favourite} onClick={() => void favourite()} />
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-muted">{voice.description || 'Custom voice profile.'}</p>
      {voice.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">{voice.tags.map((t) => <span key={t} className="rounded-md bg-raised px-1.5 py-0.5 text-[10px] text-muted ring-1 ring-line">{t}</span>)}</div>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <PreviewButton voice={voice} />
        <Button size="sm" variant="ghost" icon="mic" disabled={!modelReady} onClick={onTry}>Try with my voice</Button>
        <Button size="sm" variant={selected ? 'secondary' : 'primary'} className="ml-auto" disabled={selected || !voice.ready} onClick={() => void updateSettings({ selected_voice_id: voice.id }).then(() => toast(`“${voice.name}” will be used in the studio.`, 'ok'))}>
          {selected ? 'In use' : 'Use voice'}
        </Button>
      </div>
      <p className="text-[10px] text-faint">{voice.source}</p>
    </Card>
  );
}

export function VoiceLibrary() {
  const voices = useAppStore((s) => s.voices);
  const selectedId = useAppStore((s) => s.settings.selected_voice_id);
  const go = useAppStore((s) => s.go);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'favourites' | 'mine' | string>('all');
  const [trying, setTrying] = useState<Voice | null>(null);

  const languages = useMemo(() => Array.from(new Set(voices.filter((v) => v.kind === 'library').map((v) => v.language))).sort(), [voices]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return voices.filter((v) => {
      if (filter === 'favourites' && !v.favourite) return false;
      if (filter === 'mine' && v.kind !== 'personal') return false;
      if (!['all', 'favourites', 'mine'].includes(filter) && v.language !== filter) return false;
      return !q || [v.name, v.description, v.language, ...v.tags].some((s) => s.toLowerCase().includes(q));
    });
  }, [voices, query, filter]);

  const chips = [['all', 'All voices'], ['favourites', 'Favourites'], ['mine', 'My voices'], ...languages.map((l) => [l, l])];

  return (
    <div>
      <PageHeader
        title="Voice Library"
        subtitle="Preloaded AI voice profiles plus your own. Previews are generated on this PC by converting a neutral sentence into each voice."
        action={<Button variant="primary" icon="plus" onClick={() => go('my-voices')}>Add my own voice</Button>}
      />
      <div className="mb-4"><EngineBanner /></div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input type="search" placeholder="Search voices" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full !pl-9" aria-label="Search voices" />
        </div>
        {chips.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setFilter(id)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${filter === id ? 'bg-accent text-white' : 'bg-raised text-muted ring-1 ring-line hover:text-text'}`}>{label}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="library" title={voices.length ? 'No voices match' : 'The library is empty'} body={voices.length ? 'Try another search or filter.' : 'Library voices appear once the voice model has been downloaded.'} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {shown.map((voice) => <VoiceCard key={voice.id} voice={voice} selected={voice.id === selectedId} onTry={() => setTrying(voice)} />)}
        </div>
      )}
      <TryVoiceModal voice={trying} onClose={() => setTrying(null)} />
    </div>
  );
}
