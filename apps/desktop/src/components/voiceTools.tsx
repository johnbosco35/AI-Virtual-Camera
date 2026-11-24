import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { AIBadge, Meter, Modal } from '@/components/ui';
import { useRecorder } from '@/hooks/useRecorder';
import { engine } from '@/lib/engine';
import { usePlayer } from '@/lib/player';
import type { Voice } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

/** Record button + live level + timer; yields a WAV blob. */
export function RecorderPanel({ minSeconds, maxSeconds, onResult, prompt }: { minSeconds: number; maxSeconds: number; onResult: (blob: Blob | null) => void; prompt?: string }) {
  const microphoneId = useAppStore((s) => s.settings.microphone_device_id);
  const recorder = useRecorder(microphoneId, maxSeconds);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    onResult(recorder.result);
    if (!recorder.result) { setUrl(null); return; }
    const objectUrl = URL.createObjectURL(recorder.result);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.result]);

  const tooShort = recorder.result && recorder.seconds < minSeconds;
  return (
    <div className="space-y-3 rounded-xl border border-line bg-raised p-4">
      {prompt && <p className="text-sm text-muted">{prompt}</p>}
      <div className="flex items-center gap-3">
        {recorder.recording ? (
          <Button variant="danger" icon="stop" onClick={recorder.stop}>Stop</Button>
        ) : (
          <Button variant="primary" icon="record" onClick={() => void recorder.start()}>{recorder.result ? 'Record again' : 'Start recording'}</Button>
        )}
        <span className="w-20 text-sm tabular-nums text-muted">{recorder.seconds.toFixed(1)} s / {maxSeconds}s</span>
        <div className="flex-1"><Meter value={recorder.level} label="Recording level" /></div>
      </div>
      {recorder.recording && recorder.seconds < minSeconds && <p className="text-xs text-muted">Keep talking — at least {minSeconds} s of speech is needed.</p>}
      {url && <audio controls src={url} className="h-9 w-full" />}
      {tooShort && <p className="text-xs text-warn">That recording is shorter than {minSeconds} s. Record a little more for a reliable voice profile.</p>}
      {recorder.error && <p role="alert" className="text-xs text-bad">{recorder.error}</p>}
    </div>
  );
}

/** Record yourself and hear the same words in the chosen voice (offline conversion of a short clip). */
export function TryVoiceModal({ voice, onClose }: { voice: Voice | null; onClose: () => void }) {
  const [clip, setClip] = useState<Blob | null>(null);
  const [converted, setConverted] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const output = useAppStore((s) => s.settings.audio_output_device_id);
  const play = usePlayer((s) => s.play);

  useEffect(() => {
    setClip(null);
    setConverted(null);
    setError(null);
  }, [voice?.id]);
  useEffect(() => () => { if (converted) URL.revokeObjectURL(converted); }, [converted]);

  const convert = async () => {
    if (!voice || !clip) return;
    setBusy(true);
    setError(null);
    try {
      const wav = await engine.convertClip(voice.id, clip);
      const url = URL.createObjectURL(wav);
      setConverted(url);
      await play(`try:${voice.id}`, url, output);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Conversion failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!voice} title={`Try “${voice?.name ?? ''}” with your voice`} onClose={onClose}>
      <div className="space-y-4">
        <RecorderPanel minSeconds={1} maxSeconds={15} onResult={setClip} prompt="Say a sentence or two. Your words are converted into this voice on your PC." />
        <div className="flex items-center gap-3">
          <Button variant="primary" icon="sparkle" disabled={!clip || busy} onClick={() => void convert()}>{busy ? 'Converting…' : 'Convert & play'}</Button>
          {converted && (
            <Button icon="play" onClick={() => void play(`try:${voice?.id}`, converted, output)}>Play again</Button>
          )}
          {converted && <AIBadge label="AI-GENERATED AUDIO" />}
        </div>
        {busy && <p className="text-xs text-muted"><Icon name="cpu" className="mr-1 inline h-3.5 w-3.5" />Running OpenVoice V2 on this PC… slower machines take a few seconds per second of speech.</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      </div>
    </Modal>
  );
}
