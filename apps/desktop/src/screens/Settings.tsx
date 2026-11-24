import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { EngineBanner } from '@/components/EngineBanner';
import { Icon } from '@/components/Icon';
import { OutputSettings } from '@/components/OutputSettings';
import { StatusPill } from '@/components/StatusPill';
import { RecorderPanel } from '@/components/voiceTools';
import { Card, CardHeader, Field, Modal, PageHeader, Slider, Toggle } from '@/components/ui';
import { useDevices } from '@/hooks/useDevices';
import { engine } from '@/lib/engine';
import type { FaceGeneratorStatus, LipSyncMode, StudioSettings, Voice } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

function DeviceSelect({ id, label, value, devices, fallback, onChange }: { id: string; label: string; value: string | null; devices: MediaDeviceInfo[]; fallback: string; onChange: (v: string | null) => void }) {
  return (
    <Field label={label} htmlFor={id}>
      <select id={id} className="w-full" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{fallback}</option>
        {devices.filter((d) => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} ${i + 1}`}</option>)}
      </select>
    </Field>
  );
}

export function Settings() {
  const settings = useAppStore((s) => s.settings);
  const status = useAppStore((s) => s.status);
  const online = useAppStore((s) => s.engineOnline);
  const update = useAppStore((s) => s.updateSettings);
  const refreshStatus = useAppStore((s) => s.refreshStatus);
  const refreshSessions = useAppStore((s) => s.refreshSessions);
  const toast = useAppStore((s) => s.toast);
  const devices = useDevices();
  const [calibrating, setCalibrating] = useState(false);
  const [calibration, setCalibration] = useState<Blob | null>(null);
  const [source, setSource] = useState<Voice | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);
  const [appInfo, setAppInfo] = useState<{ version: string; dataDir?: string } | null>(null);
  const [face, setFace] = useState<FaceGeneratorStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => engine.faceStatus().then((s) => alive && setFace(s)).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, face?.state === 'downloading' ? 2000 : 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [face?.state]);

  useEffect(() => {
    void engine.sourceVoice().then(setSource).catch(() => undefined);
    void window.avc?.getAppInfo().then((info) => setAppInfo({ version: info.version, dataDir: info.dataDir })).catch(() => undefined);
  }, [status?.source_voice_ready]);

  const set = <K extends keyof StudioSettings>(key: K) => (value: StudioSettings[K]) => void update({ [key]: value } as Partial<StudioSettings>);

  const saveCalibration = async () => {
    if (!calibration) return;
    try {
      setSource(await engine.setSourceVoice(calibration));
      await refreshStatus();
      toast('Your microphone voice is calibrated.', 'ok');
      setCalibrating(false);
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Calibration failed.', 'bad');
    }
  };

  const benchmark = async () => {
    setBenchmarking(true);
    try {
      await engine.benchmark();
      await refreshStatus();
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : 'Benchmark failed.', 'bad');
    } finally {
      setBenchmarking(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Devices, animation feel, voice processing, engine performance and privacy." />
      <EngineBanner />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="pb-5">
          <CardHeader title="Devices" icon="camera" subtitle="Device names appear after camera/microphone permission is granted" />
          <div className="grid gap-4 px-5 pt-4 sm:grid-cols-2">
            <DeviceSelect id="set-camera" label="Camera" value={settings.camera_device_id} devices={devices.cameras} fallback="Default camera" onChange={set('camera_device_id')} />
            <Field label="Camera resolution" htmlFor="set-res" hint="480p is lighter on older PCs">
              <select id="set-res" className="w-full" value={settings.camera_resolution} onChange={(e) => set('camera_resolution')(e.target.value as StudioSettings['camera_resolution'])}>
                <option value="480p">480p</option><option value="720p">720p</option><option value="1080p">1080p</option>
              </select>
            </Field>
            <DeviceSelect id="set-mic" label="Microphone" value={settings.microphone_device_id} devices={devices.microphones} fallback="Default microphone" onChange={set('microphone_device_id')} />
            <DeviceSelect id="set-out" label="Audio output" value={settings.audio_output_device_id} devices={devices.outputs} fallback="System default" onChange={set('audio_output_device_id')} />
          </div>
          <div className="mt-2 divide-y divide-line px-5">
            <Toggle label="Mirror camera preview" checked={settings.mirror_preview} onChange={set('mirror_preview')} />
            <Toggle label="Mirror avatar (selfie view)" description="Off = anatomically correct: turn left and the avatar turns its left, as others would see you." checked={settings.mirror_avatar} onChange={set('mirror_avatar')} />
          </div>
          <p className="mx-5 mt-3 text-xs text-faint">Audio output is where you hear the converted voice. To use it in a call app, set up the virtual microphone under Outputs.</p>
        </Card>

        <Card className="pb-5">
          <CardHeader title="Animation" icon="avatars" subtitle="How closely the avatar follows your face" />
          <div className="space-y-5 px-5 pt-4">
            <Field label="Animation engine" htmlFor="set-engine" hint={face?.cuda ? `GPU: ${face.gpu}` : 'Neural animation needs an NVIDIA (CUDA) GPU; this PC has none, so it uses the standard animation.'}>
              <select id="set-engine" className="w-full" value={settings.animation_engine} onChange={(e) => set('animation_engine')(e.target.value as StudioSettings['animation_engine'])}>
                <option value="mesh">Standard (WebGL mesh, any PC)</option>
                <option value="neural" disabled={!face?.cuda || !face.weights}>Neural, LivePortrait (more realistic, CUDA GPU)</option>
              </select>
            </Field>
            {face && !face.weights && (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-raised/60 p-2.5 text-xs text-muted">
                <span>{face.state === 'downloading' ? face.detail : 'Neural animation model not downloaded (about 520 MB, MIT licence).'}</span>
                <Button size="sm" disabled={face.state === 'downloading'} onClick={() => void engine.downloadFaceModel().then(setFace)}>{face.state === 'downloading' ? 'Downloading…' : 'Download'}</Button>
              </div>
            )}
            <Slider id="set-smooth" label="Motion smoothing" value={settings.smoothing} min={0} max={1} step={0.05} onChange={set('smoothing')} format={(v) => (v < 0.3 ? 'Responsive' : v > 0.7 ? 'Steady' : 'Balanced')} />
            <Slider id="set-expr" label="Expression strength" value={settings.expression_gain} min={0.3} max={1.6} step={0.05} onChange={set('expression_gain')} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider id="set-head" label="Head movement" value={settings.head_motion_gain} min={0} max={1.3} step={0.05} onChange={set('head_motion_gain')} format={(v) => `${Math.round(v * 100)}%`} />
            <Field label="Lip-sync source while converting" htmlFor="set-lips" hint="Hybrid: webcam mouth, opened further by the converted voice. Audio: mouth driven only by the AI voice.">
              <select id="set-lips" className="w-full" value={settings.lip_sync_mode} onChange={(e) => set('lip_sync_mode')(e.target.value as LipSyncMode)}>
                <option value="hybrid">Hybrid (webcam + converted voice)</option>
                <option value="audio">Converted voice only</option>
                <option value="webcam">Webcam only</option>
              </select>
            </Field>
            <Toggle label="Delay face to match the AI voice" description="Keeps expressions in sync with converted speech in live mode (adds the voice latency to the video)." checked={settings.sync_video_to_voice} onChange={set('sync_video_to_voice')} />
          </div>
        </Card>

        <Card className="pb-5">
          <CardHeader title="Voice processing" icon="mic" />
          <div className="divide-y divide-line px-5 pt-2">
            <Toggle label="Noise suppression" checked={settings.noise_suppression} onChange={set('noise_suppression')} />
            <Toggle label="Echo cancellation" description="Keep on if you use speakers instead of headphones." checked={settings.echo_cancellation} onChange={set('echo_cancellation')} />
            <Toggle label="Hear the converted voice" description="Plays the AI voice on the selected output while you talk." checked={settings.monitor_converted_voice} onChange={set('monitor_converted_voice')} />
          </div>
          <div className="mx-5 mt-4 rounded-xl border border-line bg-raised p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Voice calibration</p>
                <p className="text-xs text-muted">{source ? `Calibrated from ${source.sample_seconds.toFixed(0)} s of your speech.` : 'Record your normal speaking voice so conversion is accurate from the first word.'}</p>
              </div>
              <StatusPill tone={source ? 'ok' : 'idle'} label={source ? 'Calibrated' : 'Not calibrated'} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="primary" icon="mic" disabled={status?.model_state !== 'ready'} onClick={() => setCalibrating(true)}>{source ? 'Recalibrate' : 'Calibrate my voice'}</Button>
              {source && <Button size="sm" variant="danger" icon="trash" onClick={() => void engine.clearSourceVoice().then(() => { setSource(null); void refreshStatus(); })}>Remove</Button>}
            </div>
          </div>
          <div className="mx-5 mt-4">
            <Field label="Streaming block size" htmlFor="set-block" hint="Automatic picks the smallest block this PC can convert in real time. Larger blocks = more latency but fewer dropouts.">
              <select id="set-block" className="w-full" value={settings.block_ms_override} onChange={(e) => set('block_ms_override')(Number(e.target.value))}>
                <option value={0}>Automatic (from benchmark)</option>
                {[200, 300, 400, 600, 800, 1000, 1200].map((ms) => <option key={ms} value={ms}>{ms} ms</option>)}
              </select>
            </Field>
          </div>
        </Card>

        <Card className="pb-5">
          <CardHeader title="Engine & hardware" icon="cpu" subtitle={status ? `Engine ${status.engine_version} · ${status.model_detail}` : online === false ? 'Engine offline' : 'Connecting…'} action={<Button size="sm" disabled={status?.model_state !== 'ready' || benchmarking} onClick={() => void benchmark()}>{benchmarking ? 'Measuring…' : 'Run benchmark'}</Button>} />
          {status ? (
            <div className="px-5 pt-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-muted">Processor</dt><dd className="truncate">{status.hardware.cpu}</dd>
                <dt className="text-muted">Cores / RAM</dt><dd>{status.hardware.logical_cores} logical · {status.hardware.ram_gb} GB</dd>
                <dt className="text-muted">Inference device</dt><dd>{status.device.toUpperCase()} · {status.torch_threads} threads{status.hardware.gpu ? ` · ${status.hardware.gpu}` : ''}</dd>
                <dt className="text-muted">Voice real-time factor</dt><dd>{status.benchmark ? `${status.benchmark.rtf.toFixed(2)} (needs < 0.75 for live)` : '—'}</dd>
              </dl>
              <ul className="mt-4 space-y-2">
                {status.requirements.map((r) => (
                  <li key={r.id} className="flex items-start gap-2.5 rounded-lg bg-raised/60 p-2.5">
                    <Icon name={r.status === 'ok' ? 'check' : 'alert'} className={`mt-0.5 h-4 w-4 shrink-0 ${r.status === 'ok' ? 'text-ok' : r.status === 'warn' ? 'text-warn' : 'text-bad'}`} />
                    <div><p className="text-sm font-medium">{r.label}</p><p className="text-xs text-muted">{r.detail}</p></div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="px-5 pt-4 text-sm text-muted">Start the engine to see hardware checks. In development: <code className="rounded bg-raised px-1">npm run dev:engine</code>.</p>
          )}
        </Card>

        <OutputSettings settings={settings} set={set} outputs={devices.outputs} onRefreshDevices={() => void devices.refresh()} />

        <Card className="pb-5 xl:col-span-2">
          <CardHeader title="Privacy & data" icon="shield" />
          <div className="grid gap-4 px-5 pt-4 text-sm text-muted md:grid-cols-3">
            <p>Webcam frames, microphone audio, portraits and voice samples are processed on this PC by local models (MediaPipe, OpenVoice V2). Nothing is uploaded.</p>
            <p>Every AI-modified video and audio stream is labelled “AI-generated” in the app. Voice cloning requires the voice owner's recorded authorisation.</p>
            <p>Data folder: <span className="break-all text-text">{appInfo?.dataDir ?? 'apps/engine/data'}</span>. Delete avatars and voices individually to remove their files.</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 px-5">
            <Button size="sm" variant="danger" icon="trash" onClick={() => void engine.clearSessions().then(refreshSessions).then(() => toast('Session history cleared.', 'ok'))}>Clear session history</Button>
            <Button size="sm" icon="cameraOff" onClick={() => { try { localStorage.removeItem('avs.mediaConsent.v1'); } catch { /* ignore */ } toast('The studio will ask for camera and microphone permission again.', 'ok'); }}>Revoke studio media consent</Button>
          </div>
        </Card>
      </div>

      <Modal open={calibrating} title="Calibrate your microphone voice" onClose={() => setCalibrating(false)}>
        <div className="space-y-4">
          <RecorderPanel minSeconds={6} maxSeconds={30} onResult={setCalibration} prompt="Speak normally for 10–20 seconds using the microphone you will use in the studio." />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCalibrating(false)}>Cancel</Button>
            <Button variant="primary" disabled={!calibration} onClick={() => void saveCalibration()}>Save calibration</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
