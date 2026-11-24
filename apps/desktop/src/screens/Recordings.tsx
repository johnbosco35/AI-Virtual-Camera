import { useCallback, useEffect, useState } from 'react';
import { Button, IconButton } from '@/components/Button';
import { StatusPill, type Tone } from '@/components/StatusPill';
import { AIBadge, Card, EmptyState, Field, Modal, PageHeader, formatDuration, timeAgo, useAsyncUrl } from '@/components/ui';
import { engine } from '@/lib/engine';
import type { Recording } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

const statusTone: Record<Recording['status'], Tone> = { recording: 'bad', processing: 'info', ready: 'ok', failed: 'bad', interrupted: 'warn' };
const statusLabel: Record<Recording['status'], string> = { recording: 'Recording', processing: 'Processing', ready: 'Ready', failed: 'Failed', interrupted: 'Interrupted' };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function Player({ recording }: { recording: Recording }) {
  const url = useAsyncUrl(() => engine.recordingUrl(recording, recording.format), [recording.id, recording.format, recording.size_bytes]);
  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-black">
        {url && <video key={url} src={url} controls autoPlay className="aspect-video w-full" />}
        <div className="pointer-events-none absolute left-3 top-3"><AIBadge /></div>
      </div>
      <p className="text-xs text-muted">
        {recording.avatar_name || 'Avatar'}{recording.voice_name ? ` · voice: ${recording.voice_name}` : ' · no voice conversion'} · {recording.width}×{recording.height} · {recording.format.toUpperCase()}
      </p>
    </div>
  );
}

export function Recordings() {
  const toast = useAppStore((s) => s.toast);
  const go = useAppStore((s) => s.go);
  const [recordings, setRecordings] = useState<Recording[] | null>(null);
  const [playing, setPlaying] = useState<Recording | null>(null);
  const [renaming, setRenaming] = useState<{ recording: Recording; name: string } | null>(null);
  const [deleting, setDeleting] = useState<Recording | null>(null);
  const [pendingSave, setPendingSave] = useState<Record<string, 'mp4' | 'webm'>>({});

  const refresh = useCallback(async () => {
    try {
      setRecordings(await engine.recordings());
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Recordings could not be loaded.', 'bad');
      setRecordings((r) => r ?? []);
    }
  }, [toast]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while something is being recorded or processed.
  const busy = recordings?.some((r) => r.status === 'processing' || r.status === 'recording') ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [busy, refresh]);

  const saveAs = useCallback(async (recording: Recording, format: 'mp4' | 'webm') => {
    if (!window.avc) {
      // Plain-browser development: fall back to the engine download.
      window.open(await engine.recordingUrl(recording, format), '_blank');
      return;
    }
    try {
      const result = await window.avc.saveRecording({ id: recording.id, format, suggestedName: recording.name });
      if (result.saved) toast(`Saved to ${result.path}`, 'ok');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'The recording could not be saved.', 'bad');
    }
  }, [toast]);

  const exportAndSave = async (recording: Recording, format: 'mp4' | 'webm') => {
    if (recording.available_formats.includes(format)) {
      await saveAs(recording, format);
      return;
    }
    try {
      await engine.exportRecording(recording.id, format);
      setPendingSave((p) => ({ ...p, [recording.id]: format }));
      toast(`Converting to ${format.toUpperCase()}… the save dialog opens when it is done.`, 'info');
      await refresh();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Export failed.', 'bad');
    }
  };

  // Open the save dialog once a requested export has finished.
  useEffect(() => {
    if (!recordings) return;
    for (const [id, format] of Object.entries(pendingSave)) {
      const recording = recordings.find((r) => r.id === id);
      if (!recording || recording.status === 'processing') continue;
      setPendingSave((p) => { const next = { ...p }; delete next[id]; return next; });
      if (recording.available_formats.includes(format)) void saveAs(recording, format);
      else toast(recording.status_detail || `Export to ${format.toUpperCase()} failed.`, 'bad');
    }
  }, [pendingSave, recordings, saveAs, toast]);

  const rename = async () => {
    if (!renaming) return;
    try {
      await engine.renameRecording(renaming.recording.id, renaming.name.trim());
      setRenaming(null);
      await refresh();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Rename failed.', 'bad');
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await engine.deleteRecording(deleting.id);
      if (playing?.id === deleting.id) setPlaying(null);
      setDeleting(null);
      await refresh();
      toast('Recording deleted.', 'ok');
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Delete failed.', 'bad');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recordings"
        subtitle="Recordings of the final output: the animated avatar with the converted voice. Stored on this PC; export as MP4 (H.264) or WebM."
        action={<Button variant="primary" icon="record" onClick={() => go('studio')}>Record in the studio</Button>}
      />

      {recordings === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : recordings.length === 0 ? (
        <EmptyState icon="record" title="No recordings yet" body="Open the Avatar Studio and press the record button. Recording captures the avatar and the converted voice, never your raw webcam or microphone." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {recordings.map((r) => {
            const ready = r.status === 'ready';
            return (
              <Card key={r.id} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold" title={r.name}>{r.name}</p>
                    <p className="text-xs text-muted">{timeAgo(r.created_at)} · {formatDuration(r.duration_seconds)} · {formatBytes(r.size_bytes)}</p>
                  </div>
                  <StatusPill tone={statusTone[r.status]} label={statusLabel[r.status]} pulse={r.status === 'processing' || r.status === 'recording'} />
                </div>
                <p className="text-xs text-muted">
                  {r.avatar_name || 'Avatar'}{r.voice_name ? ` · ${r.voice_name}` : ''} · {r.width}×{r.height} · {ready ? r.available_formats.map((f) => f.toUpperCase()).join(' + ') : r.requested_format.toUpperCase()}
                </p>
                {r.status_detail && <p className={`rounded-lg p-2 text-xs ${r.status === 'failed' ? 'bg-bad/10 text-bad' : 'bg-warn/10 text-warn'}`}>{r.status_detail}</p>}
                <div className="mt-auto flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="primary" icon="play" disabled={!ready} onClick={() => setPlaying(r)}>Play</Button>
                  <Button size="sm" icon="upload" disabled={!ready || !!pendingSave[r.id]} onClick={() => void exportAndSave(r, 'mp4')}>Save MP4</Button>
                  <Button size="sm" icon="upload" disabled={!ready || !!pendingSave[r.id]} onClick={() => void exportAndSave(r, 'webm')}>Save WebM</Button>
                  <div className="ml-auto flex gap-1">
                    {window.avc && <IconButton icon="library" label="Show in folder" disabled={!ready} onClick={() => void window.avc!.showRecording({ id: r.id, format: r.format }).catch(() => toast('The file could not be found.', 'bad'))} />}
                    <IconButton icon="replace" label="Rename" onClick={() => setRenaming({ recording: r, name: r.name })} />
                    <IconButton icon="trash" label="Delete" disabled={r.status === 'processing' || r.status === 'recording'} onClick={() => setDeleting(r)} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!playing} title={playing?.name ?? ''} onClose={() => setPlaying(null)} wide>
        {playing && <Player recording={playing} />}
      </Modal>

      <Modal open={!!renaming} title="Rename recording" onClose={() => setRenaming(null)}>
        <div className="space-y-4">
          <Field label="Name" htmlFor="rec-name">
            <input id="rec-name" className="w-full" maxLength={120} value={renaming?.name ?? ''} onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))} onKeyDown={(e) => e.key === 'Enter' && void rename()} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRenaming(null)}>Cancel</Button>
            <Button variant="primary" disabled={!renaming?.name.trim()} onClick={() => void rename()}>Save</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleting} title="Delete recording?" onClose={() => setDeleting(null)}>
        <div className="space-y-4">
          <p className="text-sm text-muted">“{deleting?.name}” and all its exported files will be removed from this PC. Copies you saved elsewhere are not affected.</p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="danger" icon="trash" onClick={() => void remove()}>Delete</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
