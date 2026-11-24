import { useMemo, useRef, useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import { PreviewButton, VoiceGlyph } from '@/components/cards';
import { EngineBanner } from '@/components/EngineBanner';
import { Icon } from '@/components/Icon';
import { RecorderPanel, TryVoiceModal } from '@/components/voiceTools';
import { Card, EmptyState, Field, Modal, PageHeader, formatDuration, timeAgo } from '@/components/ui';
import { engine } from '@/lib/engine';
import type { Voice } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

const AUDIO_ACCEPT = '.wav,.mp3,.flac,.ogg,.oga,.opus,.m4a,.aac,.webm,.wma,audio/*';
const MIN_SECONDS = 6;

type Source = { blob: Blob; filename: string } | null;

function ConsentBlock({ relation, setRelation, subject, setSubject, confirmed, setConfirmed }: {
  relation: 'self' | 'authorised'; setRelation: (r: 'self' | 'authorised') => void; subject: string; setSubject: (s: string) => void; confirmed: boolean; setConfirmed: (c: boolean) => void;
}) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-warn/30 bg-warn/5 p-4">
      <legend className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-warn"><Icon name="shield" className="h-3.5 w-3.5" />Authorisation required</legend>
      <div className="flex gap-2">
        {(['self', 'authorised'] as const).map((r) => (
          <button key={r} type="button" onClick={() => setRelation(r)} className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${relation === r ? 'bg-accent text-white' : 'bg-raised text-muted ring-1 ring-line'}`}>
            {r === 'self' ? 'This is my own voice' : 'Someone authorised me'}
          </button>
        ))}
      </div>
      <Field label={relation === 'self' ? 'Your name' : 'Name of the person whose voice this is'} htmlFor="consent-subject">
        <input id="consent-subject" type="text" className="w-full" maxLength={120} value={subject} onChange={(e) => setSubject(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-xs text-muted">
        <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span>
          {relation === 'self'
            ? 'I confirm this recording is my own voice and I consent to creating an AI voice profile from it.'
            : `I confirm that ${subject.trim() || 'this person'} has explicitly authorised me to create and use an AI voice profile from this recording.`}{' '}
          I will not use it to impersonate anyone or to mislead people about who is speaking.
        </span>
      </label>
    </fieldset>
  );
}

function CreateVoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const refreshVoices = useAppStore((s) => s.refreshVoices);
  const toast = useAppStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'record' | 'upload'>('record');
  const [source, setSource] = useState<Source>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [relation, setRelation] = useState<'self' | 'authorised'>('self');
  const [subject, setSubject] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setSource(null); setName(''); setDescription(''); setSubject(''); setConfirmed(false); setError(null); };
  const close = () => { reset(); onClose(); };
  const ready = !!source && name.trim() && subject.trim() && confirmed && !busy;

  const create = async () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const voice = await engine.createVoice({ file: source.blob, filename: source.filename, name: name.trim(), description: description.trim(), consentSubject: subject.trim(), consentRelation: relation });
      await refreshVoices();
      toast(`Voice profile “${voice.name}” created from ${voice.sample_seconds.toFixed(0)} s of speech.`, 'ok');
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The voice profile could not be created.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="Create a voice profile" onClose={close} wide>
      <div className="space-y-5">
        <div className="flex gap-2">
          {(['record', 'upload'] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setSource(null); }} className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${mode === m ? 'bg-accent/15 text-white ring-1 ring-accent/50' : 'bg-raised text-muted ring-1 ring-line'}`}>
              <Icon name={m === 'record' ? 'mic' : 'upload'} />{m === 'record' ? 'Record with microphone' : 'Upload audio file'}
            </button>
          ))}
        </div>
        {mode === 'record' ? (
          <RecorderPanel minSeconds={MIN_SECONDS} maxSeconds={60} onResult={(blob) => setSource(blob ? { blob, filename: 'recording.wav' } : null)} prompt="Read naturally for 15–30 seconds in a quiet room, e.g. describe your day. More clean speech gives a more faithful voice." />
        ) : (
          <div className="rounded-xl border border-line bg-raised p-4">
            <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setSource({ blob: f, filename: f.name }); e.target.value = ''; }} />
            <div className="flex items-center gap-3">
              <Button icon="upload" onClick={() => fileRef.current?.click()}>Choose file</Button>
              <span className="truncate text-sm text-muted">{source ? source.filename : 'WAV, MP3, FLAC, OGG, M4A or WEBM · max 40 MB · at least 6 s of speech'}</span>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Voice name" htmlFor="voice-name"><input id="voice-name" type="text" className="w-full" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My podcast voice" /></Field>
          <Field label="Description (optional)" htmlFor="voice-desc"><input id="voice-desc" type="text" className="w-full" maxLength={400} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Warm, relaxed…" /></Field>
        </div>
        <ConsentBlock relation={relation} setRelation={setRelation} subject={subject} setSubject={setSubject} confirmed={confirmed} setConfirmed={setConfirmed} />
        {error && <p role="alert" className="rounded-lg bg-bad/10 p-3 text-sm text-bad">{error}</p>}
        <div className="flex items-center justify-between">
          <p className="text-xs text-faint">The sample and its voice embedding are stored only on this PC.</p>
          <div className="flex gap-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" icon="sparkle" disabled={!ready} onClick={() => void create()}>{busy ? 'Creating profile…' : 'Create voice profile'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ReplaceSampleModal({ voice, onClose }: { voice: Voice | null; onClose: () => void }) {
  const refreshVoices = useAppStore((s) => s.refreshVoices);
  const toast = useAppStore((s) => s.toast);
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!voice || !source) return;
    setBusy(true);
    try {
      await engine.replaceVoiceSample(voice.id, source.blob, source.filename);
      await refreshVoices();
      toast(`Replaced the sample for “${voice.name}”.`, 'ok');
      setSource(null); setConfirmed(false); onClose();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Replace failed.', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!voice} title={`Replace sample · ${voice?.name ?? ''}`} onClose={onClose}>
      <div className="space-y-4">
        <RecorderPanel minSeconds={MIN_SECONDS} maxSeconds={60} onResult={(blob) => setSource(blob ? { blob, filename: 'recording.wav' } : null)} />
        <input ref={fileRef} type="file" accept={AUDIO_ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setSource({ blob: f, filename: f.name }); e.target.value = ''; }} />
        <Button size="sm" variant="ghost" icon="upload" onClick={() => fileRef.current?.click()}>…or upload a file {source?.filename && source.filename !== 'recording.wav' ? `(${source.filename})` : ''}</Button>
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm {voice?.consent_relation === 'self' ? 'this new recording is my own voice' : `${voice?.consent_subject} authorised this new recording`}.
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!source || !confirmed || busy} onClick={() => void submit()}>{busy ? 'Updating…' : 'Replace sample'}</Button>
        </div>
      </div>
    </Modal>
  );
}

export function MyVoices() {
  const allVoices = useAppStore((s) => s.voices);
  const voices = useMemo(() => allVoices.filter((v) => v.kind === 'personal'), [allVoices]);
  const selectedId = useAppStore((s) => s.settings.selected_voice_id);
  const modelReady = useAppStore((s) => s.status?.model_state === 'ready');
  const updateSettings = useAppStore((s) => s.updateSettings);
  const refreshVoices = useAppStore((s) => s.refreshVoices);
  const toast = useAppStore((s) => s.toast);
  const [creating, setCreating] = useState(false);
  const [replacing, setReplacing] = useState<Voice | null>(null);
  const [trying, setTrying] = useState<Voice | null>(null);
  const [deleting, setDeleting] = useState<Voice | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const save = async (id: string, patch: { name?: string; favourite?: boolean }) => {
    try { await engine.updateVoice(id, patch); await refreshVoices(); } catch (cause) { toast(cause instanceof Error ? cause.message : 'Update failed.', 'bad'); }
  };
  const remove = async (voice: Voice) => {
    try {
      await engine.deleteVoice(voice.id);
      await refreshVoices();
      toast(`Deleted “${voice.name}”, its sample and its embedding.`, 'ok');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Delete failed.', 'bad');
    }
    setDeleting(null);
  };

  return (
    <div>
      <PageHeader
        title="My Voices"
        subtitle="Voice profiles created from authorised samples. A profile is a timbre embedding: when you speak, your words keep your rhythm and intonation but take on this voice."
        action={<Button variant="primary" icon="plus" disabled={!modelReady} onClick={() => setCreating(true)}>New voice profile</Button>}
      />
      <div className="mb-4"><EngineBanner /></div>
      {voices.length === 0 ? (
        <EmptyState icon="mic" title="No personal voices yet" body="Record or upload at least 6 seconds of clear speech from yourself or someone who has authorised you." action={<Button variant="primary" icon="plus" disabled={!modelReady} onClick={() => setCreating(true)}>Create voice profile</Button>} />
      ) : (
        <div className="space-y-3">
          {voices.map((voice) => (
            <Card key={voice.id} className={`flex flex-wrap items-center gap-4 p-4 ${voice.id === selectedId ? 'border-accent/60' : ''}`}>
              <VoiceGlyph voice={voice} />
              <div className="min-w-[200px] flex-1">
                {renaming?.id === voice.id ? (
                  <input type="text" autoFocus maxLength={80} value={renaming.name} aria-label="Voice name" className="!py-1"
                    onChange={(e) => setRenaming({ id: voice.id, name: e.target.value })}
                    onBlur={() => { if (renaming.name.trim() && renaming.name !== voice.name) void save(voice.id, { name: renaming.name.trim() }); setRenaming(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                ) : (
                  <button type="button" onClick={() => setRenaming({ id: voice.id, name: voice.name })} className="font-semibold hover:text-[#A99CFF]" title="Rename">{voice.name}</button>
                )}
                <p className="text-xs text-muted">
                  {voice.consent_relation === 'self' ? 'Own voice' : 'Authorised by'} {voice.consent_subject} · consent {voice.consent_at ? new Date(voice.consent_at).toLocaleDateString() : '—'} · {formatDuration(voice.sample_seconds)} sample · used {timeAgo(voice.last_used_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <PreviewButton voice={voice} />
                <PreviewButton voice={voice} kind="sample" />
                <Button size="sm" variant="ghost" icon="mic" disabled={!modelReady} onClick={() => setTrying(voice)}>Try</Button>
                <Button size="sm" variant={voice.id === selectedId ? 'secondary' : 'primary'} disabled={voice.id === selectedId} onClick={() => void updateSettings({ selected_voice_id: voice.id })}>{voice.id === selectedId ? 'In use' : 'Use voice'}</Button>
                <IconButton icon="star" label={voice.favourite ? 'Remove from favourites' : 'Save to favourites'} active={voice.favourite} onClick={() => void save(voice.id, { favourite: !voice.favourite })} />
                <IconButton icon="replace" label="Replace sample" disabled={!modelReady} onClick={() => setReplacing(voice)} />
                <IconButton icon="trash" label="Delete voice" className="hover:!text-bad" onClick={() => setDeleting(voice)} />
              </div>
            </Card>
          ))}
        </div>
      )}
      <Card className="mt-8 flex items-start gap-3 p-4 text-sm text-muted">
        <Icon name="shield" className="mt-0.5 h-4 w-4 shrink-0 text-[#A99CFF]" />
        <p>Voice cloning requires the voice owner's authorisation, recorded with each profile. Converted audio is labelled as AI-generated in the app. Do not use voice profiles to impersonate people or commit fraud.</p>
      </Card>
      <CreateVoiceModal open={creating} onClose={() => setCreating(false)} />
      <ReplaceSampleModal voice={replacing} onClose={() => setReplacing(null)} />
      <TryVoiceModal voice={trying} onClose={() => setTrying(null)} />
      <Modal open={!!deleting} title="Delete voice profile?" onClose={() => setDeleting(null)}>
        <p className="text-sm text-muted">“{deleting?.name}”, its original sample and its embedding will be permanently deleted from this PC.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" icon="trash" onClick={() => deleting && void remove(deleting)}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
