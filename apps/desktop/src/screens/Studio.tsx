import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AvatarStage, type BackgroundState, type RenderedFrame, type StageDriver } from '@/components/AvatarStage';
import { Button, IconButton } from '@/components/Button';
import { AvatarImage, CompatibilityBadge, VoiceGlyph } from '@/components/cards';
import { EngineBanner } from '@/components/EngineBanner';
import { PortraitAuthorisationDialog } from '@/components/PortraitAuthorisation';
import { Icon } from '@/components/Icon';
import { StatusPill, type Tone } from '@/components/StatusPill';
import { AIBadge, Card, CardHeader, EmptyState, Field, Meter, Modal, formatDuration } from '@/components/ui';
import { useDevices } from '@/hooks/useDevices';
import { useFaceTracking } from '@/hooks/useFaceTracking';
import { useOutputRecorder } from '@/hooks/useOutputRecorder';
import { useVoiceConversion } from '@/hooks/useVoiceConversion';
import { useWebcam } from '@/hooks/useWebcam';
import { engine } from '@/lib/engine';
import { cropJpeg, faceCrop } from '@/lib/faceCrop';
import { NeuralFaceClient } from '@/lib/neuralFace';
import { OUTPUT_SIZES, OutputCompositor, containRect, coverRect } from '@/lib/outputCompositor';
import { NeutralCapture, type Neutral } from '@/lib/reenactment';
import { VirtualCameraLink, type VirtualCameraInfo, type VirtualCameraStats } from '@/lib/virtualCamera';
import type { AvatarDetail } from '@/lib/types';
import { useAppStore } from '@/store/appStore';

const CONSENT_KEY = 'avs.mediaConsent.v1';

/** Virtual-camera pipeline counters, readable from DevTools as window.__avsOutputDiagnostics. */
const outputDiagnostics = { encodeCalls: 0, encodeMs: 0, gpuNotReady: 0, linkBusy: 0, sent: 0 };
(window as unknown as { __avsOutputDiagnostics: typeof outputDiagnostics }).__avsOutputDiagnostics = outputDiagnostics;
const MAX_SYNC_DELAY_MS = 1500;

function readConsent() {
  try { return localStorage.getItem(CONSENT_KEY) === 'yes'; } catch { return false; }
}

const issueText = {
  none: 'Tracking',
  'no-face': 'No face found',
  'poor-lighting': 'Too dark',
  'face-too-small': 'Move closer',
  'out-of-frame': 'Centre your face',
} as const;

export function Studio() {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const avatars = useAppStore((s) => s.avatars);
  const voices = useAppStore((s) => s.voices);
  const status = useAppStore((s) => s.status);
  const go = useAppStore((s) => s.go);
  const toast = useAppStore((s) => s.toast);
  const refreshSessions = useAppStore((s) => s.refreshSessions);
  const devices = useDevices();

  const [consented, setConsented] = useState(readConsent);
  const webcam = useWebcam(settings.camera_device_id, settings.camera_resolution);
  const tracking = useFaceTracking(webcam.videoRef, webcam.status === 'live', settings.smoothing);
  const voice = useVoiceConversion();

  const avatarSummary = avatars.find((a) => a.id === settings.selected_avatar_id) ?? avatars[0] ?? null;
  const selectedVoice = voices.find((v) => v.id === settings.selected_voice_id) ?? null;
  const [avatar, setAvatar] = useState<AvatarDetail | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStart, setSessionStart] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [renderFps, setRenderFps] = useState(0);
  const [calibrating, setCalibrating] = useState(true);
  const [picker, setPicker] = useState<'avatar' | 'voice' | null>(null);
  const [authorising, setAuthorising] = useState(false);
  const refreshAvatars = useAppStore((s) => s.refreshAvatars);
  const [background, setBackground] = useState<BackgroundState>({ mode: 'pending' });
  const recorder = useOutputRecorder();
  const [vcam, setVcam] = useState<{ state: 'off' | 'starting' | 'on'; info: VirtualCameraInfo | null; stats: VirtualCameraStats | null }>({ state: 'off', info: null, stats: null });
  const vcamLinkRef = useRef<VirtualCameraLink | null>(null);
  const compositorRef = useRef<OutputCompositor | null>(null);
  const lastEncodeRef = useRef(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const neutralRef = useRef<Neutral | null>(null);
  const captureRef = useRef(new NeutralCapture(12));

  // ---- camera lifecycle: starts on entry once the user has granted consent
  useEffect(() => {
    if (consented) void webcam.start();
    return () => webcam.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consented, settings.camera_device_id, settings.camera_resolution]);

  useEffect(() => {
    if (webcam.status === 'live') void devices.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webcam.status]);

  // ---- load the selected avatar (with landmarks); reload when analysis finishes
  useEffect(() => {
    if (!avatarSummary) { setAvatar(null); return; }
    let alive = true;
    engine.avatar(avatarSummary.id).then((detail) => alive && setAvatar(detail)).catch((e: Error) => toast(e.message, 'bad'));
    return () => { alive = false; };
  }, [avatarSummary?.id, avatarSummary?.updated_at, avatarSummary?.has_landmarks, toast]);

  useEffect(() => {
    if (!sessionStart) return;
    const timer = window.setInterval(() => setElapsed((performance.now() - sessionStart) / 1000), 500);
    return () => window.clearInterval(timer);
  }, [sessionStart]);

  // ---- neural reenactment (LivePortrait in the engine; needs a CUDA GPU for live use)
  const neuralRef = useRef<NeuralFaceClient | null>(null);
  const neutralSentRef = useRef(false);
  const [neural, setNeural] = useState<{ state: 'off' | 'connecting' | 'on' | 'error'; detail: string; fps: number }>({ state: 'off', detail: '', fps: 0 });
  const neuralWanted = settings.animation_engine === 'neural';
  useEffect(() => {
    if (!neuralWanted || !consented || !avatar?.landmarks || !avatar.authorised) {
      setNeural({ state: 'off', detail: '', fps: 0 });
      return;
    }
    let alive = true;
    const client = new NeuralFaceClient();
    neuralRef.current = client;
    neutralSentRef.current = false;
    setNeural({ state: 'connecting', detail: 'Starting neural animation…', fps: 0 });
    client.onChange = () => { if (alive) setNeural((n) => ({ ...n, fps: client.stats.fps, detail: client.error ?? n.detail })); };
    void (async () => {
      try {
        await client.connect({ expression: settings.expression_gain, head: settings.head_motion_gain });
        const response = await fetch(await engine.avatarImageUrl(avatar));
        const bitmap = await createImageBitmap(await response.blob());
        const crop = faceCrop(avatar.landmarks!, bitmap.width, bitmap.height);
        await client.setSource(await cropJpeg(bitmap, crop), crop);
        bitmap.close();
        if (alive) setNeural({ state: 'on', detail: `LivePortrait on ${client.device?.toUpperCase()}`, fps: 0 });
      } catch (cause) {
        if (alive) setNeural({ state: 'error', detail: cause instanceof Error ? cause.message : 'Neural animation could not start.', fps: 0 });
      }
    })();
    return () => {
      alive = false;
      client.close();
      if (neuralRef.current === client) neuralRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neuralWanted, consented, avatar, avatar?.authorised]);

  useEffect(() => { neuralRef.current?.setGains({ expression: settings.expression_gain, head: settings.head_motion_gain }); }, [settings.expression_gain, settings.head_motion_gain]);

  // Live crops: the user's neutral face once calibration finishes, then each new tracked frame.
  useEffect(() => {
    if (neural.state !== 'on') return;
    let lastTimestamp = -1;
    const timer = window.setInterval(() => {
      const client = neuralRef.current;
      const video = webcam.videoRef.current;
      const latest = tracking.latestRef.current;
      if (!client || !video || !video.videoWidth || !latest?.found || !latest.landmarks || latest.timestamp === lastTimestamp) return;
      const crop = faceCrop(latest.landmarks, video.videoWidth, video.videoHeight);
      if (!neutralSentRef.current) {
        if (!neutralRef.current) return; // wait until the mesh calibration has captured a neutral pose
        neutralSentRef.current = true;
        void cropJpeg(video, crop).then((jpeg) => client.setNeutral(jpeg));
        return;
      }
      if (!client.canSend) return;
      lastTimestamp = latest.timestamp;
      void cropJpeg(video, crop).then((jpeg) => client.sendFrame(jpeg));
    }, 25);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neural.state]);

  const resetNeutral = useCallback(() => {
    neutralRef.current = null;
    neutralSentRef.current = false;
    captureRef.current.reset();
    setCalibrating(true);
  }, []);

  // ---- per-frame pose for the renderer (no React state involved)
  const live = useRef({ settings, voiceStatus: voice.status, voiceMode: voice.mode });
  live.current = { settings, voiceStatus: voice.status, voiceMode: voice.mode };
  const driver = useRef<StageDriver>({ pose: () => null, paused: false });
  driver.current.paused = paused;
  driver.current.neural = () => (neuralWanted && neuralRef.current?.ready ? neuralRef.current.latest : null);
  driver.current.pose = () => {
    const latest = tracking.latestRef.current;
    if (!latest) return null;
    if (!neutralRef.current) {
      const neutral = captureRef.current.add(latest);
      if (!neutral) return null;
      neutralRef.current = neutral;
      setCalibrating(false);
    }
    const { settings: s, voiceStatus, voiceMode } = live.current;
    const streaming = voiceStatus === 'streaming';
    const latency = voice.latencyRef.current;
    // In live mode the face is delayed to line up with the converted voice. In buffered mode the delay is
    // seconds long, so expressions stay live and only the mouth follows the (delayed) converted audio.
    const delay = streaming && voiceMode === 'live' && s.sync_video_to_voice && latency !== null && latency < MAX_SYNC_DELAY_MS ? latency : 0;
    const frame = delay ? tracking.frameAt(performance.now() - delay) ?? latest : latest;
    return {
      frame,
      neutral: neutralRef.current,
      params: {
        expressionGain: s.expression_gain,
        headGain: s.head_motion_gain,
        lipSyncMode: streaming && voiceMode === 'buffered' && s.lip_sync_mode === 'hybrid' ? 'audio' : s.lip_sync_mode,
        visemes: streaming ? voice.visemesNow() : null,
        webcamJawOpen: tracking.blendshape(frame, 'jawOpen'),
      },
    };
  };

  // ---- final output: one composed 16:9 frame feeds the virtual camera and the recorder
  const outputKey = `${settings.output_resolution}@${settings.output_fps}`;
  const compositor = useCallback(() => {
    const current = compositorRef.current;
    const { width, height } = OUTPUT_SIZES[settings.output_resolution];
    if (current && current.width === width && current.height === height) {
      current.setFps(settings.output_fps);
      return current;
    }
    compositorRef.current = new OutputCompositor(settings.output_resolution, settings.output_fps);
    return compositorRef.current;
  }, [settings.output_resolution, settings.output_fps]);

  const faceFocus = useMemo(() => {
    const points = avatar?.landmarks;
    if (!points?.length) return null;
    let x = 0, y = 0;
    for (const [px, py] of points) { x += px; y += py; }
    return { x: x / points.length, y: y / points.length };
  }, [avatar?.landmarks]);

  const outputLive = useRef({ size: OUTPUT_SIZES[settings.output_resolution], fps: settings.output_fps, vcam: false, recording: false, mirrored: settings.mirror_avatar, framing: settings.output_framing, focus: faceFocus });
  outputLive.current = {
    size: OUTPUT_SIZES[settings.output_resolution],
    fps: settings.output_fps,
    vcam: vcam.state === 'on',
    recording: recorder.state === 'recording' || recorder.state === 'paused' || recorder.state === 'starting',
    mirrored: settings.mirror_avatar,
    framing: settings.output_framing,
    focus: faceFocus,
  };
  const onFrame = useCallback(({ canvas, encodeI420 }: RenderedFrame) => {
    const o = outputLive.current;
    // Recording: composed on a 2D canvas that MediaRecorder captures.
    if (o.recording) compositorRef.current?.compose(canvas, { mirrored: o.mirrored, framing: o.framing, focus: o.focus });
    // Virtual camera: composed and converted to I420 on the GPU, in the renderer's own context.
    const link = vcamLinkRef.current;
    if (!o.vcam || !link) return;
    const now = performance.now();
    if (now - lastEncodeRef.current < 1000 / o.fps - 4) return;
    lastEncodeRef.current = now;
    const { width, height } = o.size;
    const full = { x: 0, y: 0, width: 1, height: 1 };
    let dest = full;
    let crop = full;
    if (o.framing === 'fill') {
      const r = coverRect(canvas.width, canvas.height, width, height, o.focus ?? { x: 0.5, y: 0.45 });
      crop = { x: r.x / canvas.width, y: r.y / canvas.height, width: r.width / canvas.width, height: r.height / canvas.height };
    } else {
      const r = containRect(canvas.width, canvas.height, width, height);
      dest = { x: r.x / width, y: r.y / height, width: r.width / width, height: r.height / height };
    }
    const t0 = performance.now();
    const bytes = encodeI420({ width, height, mirrored: o.mirrored, dest, crop });
    const d = outputDiagnostics;
    d.encodeCalls += 1;
    d.encodeMs += performance.now() - t0;
    if (!bytes) d.gpuNotReady += 1;
    else if (!link.canSend) d.linkBusy += 1;
    else if (link.send(bytes)) d.sent += 1;
  }, []);

  const stopVirtualCamera = useCallback(() => {
    vcamLinkRef.current?.stop();
    vcamLinkRef.current = null;
    setVcam({ state: 'off', info: null, stats: null });
  }, []);

  const startVirtualCamera = useCallback(async () => {
    if (!avatarSummary?.authorised) { setAuthorising(true); return; }
    const out = compositor();
    out.clear();
    const link = new VirtualCameraLink();
    vcamLinkRef.current?.stop();
    vcamLinkRef.current = link;
    setVcam({ state: 'starting', info: null, stats: null });
    link.onStats = (stats) => setVcam((v) => (vcamLinkRef.current === link ? { ...v, stats } : v));
    link.onClosed = (message) => {
      if (vcamLinkRef.current !== link) return;
      vcamLinkRef.current = null;
      setVcam({ state: 'off', info: null, stats: null });
      toast(message ?? 'The virtual camera stopped.', message ? 'bad' : 'warn');
    };
    try {
      const info = await link.start({ width: out.width, height: out.height, fps: settings.output_fps, backend: settings.virtual_camera_backend });
      if (vcamLinkRef.current !== link) return;
      setVcam({ state: 'on', info, stats: null });
      toast(`Virtual camera on: select “${info.device}” as the camera in your call app.`, 'ok');
    } catch (cause) {
      if (vcamLinkRef.current === link) vcamLinkRef.current = null;
      setVcam({ state: 'off', info: null, stats: null });
      toast(cause instanceof Error ? cause.message : 'The virtual camera could not start.', 'bad');
    }
  }, [avatarSummary?.authorised, compositor, settings.output_fps, settings.virtual_camera_backend, toast]);

  // Output size, rate or driver changed while the camera is on: restart it with the new format.
  const vcamOnRef = useRef(false);
  vcamOnRef.current = vcam.state === 'on';
  useEffect(() => {
    if (vcamOnRef.current) void startVirtualCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputKey, settings.virtual_camera_backend]);

  const autostarted = useRef(false);
  useEffect(() => {
    if (consented && avatar && settings.virtual_camera_autostart && !autostarted.current) {
      autostarted.current = true;
      void startVirtualCamera();
    }
  }, [avatar, consented, settings.virtual_camera_autostart, startVirtualCamera]);

  useEffect(() => () => {
    vcamLinkRef.current?.stop();
    vcamLinkRef.current = null;
  }, []);

  // Recording: attach the converted voice whenever it starts, stops or restarts.
  const recordingActive = recorder.state === 'recording' || recorder.state === 'paused';
  useEffect(() => {
    if (recordingActive) recorder.attachVoice(voice.status === 'streaming' ? voice.recordingStream() : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordingActive, voice.status]);

  const startRecording = async () => {
    if (!avatar) return;
    if (!authorised) { setAuthorising(true); return; }
    const out = compositor();
    out.clear();
    await recorder.start(
      {
        canvas: out.canvas,
        fps: settings.output_fps,
        format: settings.recording_format,
        quality: settings.recording_quality,
        avatarName: avatar.name,
        voiceName: voice.status === 'streaming' ? voice.voiceName ?? '' : '',
      },
      voice.status === 'streaming' ? voice.recordingStream() : null,
    );
  };
  const stopRecording = async () => {
    const result = await recorder.stop();
    if (result) toast(`Recording saved (${formatDuration(result.duration_seconds)}). It is finalised in Recordings.`, 'ok');
  };
  useEffect(() => {
    if (recorder.error) toast(recorder.error, 'bad');
  }, [recorder.error, toast]);

  // The virtual microphone follows the setting while a session runs.
  useEffect(() => {
    if (voice.status === 'streaming') void voice.routeVirtualMic(settings.virtual_mic_device_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.virtual_mic_device_id, voice.status]);
  useEffect(() => {
    voice.setVirtualMicDelay(settings.virtual_mic_delay_ms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.virtual_mic_delay_ms]);

  // ---- session control
  const authorised = avatarSummary?.authorised ?? false;
  const startSession = async () => {
    if (!avatarSummary) { toast('Upload an avatar first.', 'warn'); return; }
    if (!authorised) { setAuthorising(true); return; }
    try {
      const record = await engine.startSession(avatarSummary.id, selectedVoice?.id ?? null);
      setSessionId(record.id);
    } catch { /* history is optional */ }
    setSessionStart(performance.now());
    setElapsed(0);
    setPaused(false);
    if (selectedVoice && status?.model_state === 'ready') {
      await voice.start({
        voiceId: selectedVoice.id,
        microphoneId: settings.microphone_device_id,
        outputId: settings.audio_output_device_id,
        noiseSuppression: settings.noise_suppression,
        echoCancellation: settings.echo_cancellation,
        monitor: settings.monitor_converted_voice,
        virtualMicId: settings.virtual_mic_device_id,
        virtualMicDelayMs: settings.virtual_mic_delay_ms,
      });
    } else if (selectedVoice) {
      toast('The voice model is not ready, so this session animates the avatar only.', 'warn');
    }
  };

  const stopSession = useCallback(async () => {
    const stats = voice.sessionStats();
    voice.stop();
    if (sessionId && sessionStart) {
      try {
        await engine.endSession(sessionId, {
          duration_seconds: (performance.now() - sessionStart) / 1000,
          avg_latency_ms: stats.avgLatencyMs,
          avg_tracking_fps: tracking.averageFps(),
          voice_seconds: stats.voiceSeconds,
          blocks_dropped: stats.droppedBlocks,
        });
        void refreshSessions();
      } catch { /* history is optional */ }
    }
    setSessionId(null);
    setSessionStart(null);
    setPaused(false);
  }, [refreshSessions, sessionId, sessionStart, tracking, voice]);

  const sessionRef = useRef(stopSession);
  sessionRef.current = stopSession;
  useEffect(() => () => { void sessionRef.current(); }, []);

  useEffect(() => {
    if (voice.error) toast(voice.error, 'bad');
  }, [voice.error, toast]);

  const chooseVoice = (id: string) => {
    void updateSettings({ selected_voice_id: id });
    if (voice.status === 'streaming') voice.switchVoice(id);
    setPicker(null);
  };
  const chooseAvatar = (id: string) => {
    void updateSettings({ selected_avatar_id: id });
    setPicker(null);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  const live2 = sessionStart !== null;
  const trackingTone: Tone = tracking.state === 'error' ? 'bad' : tracking.summary.found ? (tracking.summary.issue === 'none' ? 'ok' : 'warn') : webcam.status === 'live' ? 'warn' : 'idle';
  const trackingLabel = tracking.state === 'loading' ? 'Loading tracker…' : tracking.state === 'error' ? 'Tracker error' : webcam.status !== 'live' ? 'Camera off' : issueText[tracking.summary.issue];
  const voiceTone: Tone = voice.status === 'streaming' ? (voice.mode === 'live' ? 'ok' : 'warn') : voice.status === 'error' ? 'bad' : voice.status === 'connecting' ? 'info' : 'idle';
  const voiceLabel = voice.status === 'streaming' ? (voice.mode === 'live' ? 'Converting live' : 'Converting (buffered)') : voice.status === 'connecting' ? 'Connecting…' : voice.status === 'error' ? 'Voice error' : selectedVoice ? 'Voice ready' : 'No voice';
  const sortedVoices = useMemo(() => [...voices].sort((a, b) => Number(b.kind === 'personal') - Number(a.kind === 'personal') || Number(b.favourite) - Number(a.favourite)), [voices]);

  if (!consented) {
    return (
      <div className="mx-auto max-w-xl pt-16">
        <Card className="p-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-[#A99CFF]"><Icon name="shield" className="h-7 w-7" /></span>
          <h1 className="font-display text-xl font-semibold">Camera &amp; microphone permission</h1>
          <p className="mt-2 text-sm text-muted">
            The studio uses your webcam to track facial movement and your microphone for voice conversion. Video and audio are processed only on this
            computer by local AI models. Nothing is recorded or uploaded.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => go('dashboard')}>Not now</Button>
            <Button variant="primary" icon="camera" onClick={() => { try { localStorage.setItem(CONSENT_KEY, 'yes'); } catch { /* ignore */ } setConsented(true); }}>
              Allow and open studio
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Avatar Studio</h1>
          <p className="text-sm text-muted">Your face drives the portrait; your voice is converted to the selected profile.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={trackingTone} label={trackingLabel} pulse={tracking.summary.found} />
          <StatusPill tone={voiceTone} label={voiceLabel} pulse={voice.status === 'streaming'} />
          <StatusPill
            tone={vcam.state === 'on' ? 'ok' : vcam.state === 'starting' ? 'info' : 'idle'}
            label={vcam.state === 'on' ? `Virtual camera · ${vcam.info?.device ?? ''}` : vcam.state === 'starting' ? 'Starting camera…' : 'Virtual camera off'}
            pulse={vcam.state === 'on'}
          />
          {neuralWanted && (
            <StatusPill
              tone={neural.state === 'on' ? 'ok' : neural.state === 'error' ? 'bad' : 'info'}
              label={neural.state === 'on' ? `Neural face · ${neural.fps || 0} fps` : neural.state === 'error' ? 'Neural face off' : 'Neural face starting…'}
            />
          )}
          {recorder.state !== 'idle' && (
            <StatusPill
              tone={recorder.state === 'paused' ? 'warn' : 'bad'}
              label={recorder.state === 'paused' ? `Paused ${formatDuration(recorder.seconds)}` : recorder.state === 'finishing' ? 'Saving…' : recorder.state === 'starting' ? 'Starting…' : `REC ${formatDuration(recorder.seconds)}`}
              pulse={recorder.state === 'recording'}
            />
          )}
          {live2 && <StatusPill tone="info" label={`Session ${formatDuration(elapsed)}`} />}
        </div>
      </header>

      <EngineBanner compact />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------------- main stage */}
        <div className="flex min-h-0 flex-col gap-3">
          <div ref={stageRef} className="relative min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_at_center,#161B29_0%,#090C13_75%)]">
            {avatarSummary ? (
              <AvatarStage
                avatar={avatar}
                driver={driver}
                mirrored={settings.mirror_avatar}
                preserveBackground={settings.preserve_background}
                onRenderFps={setRenderFps}
                onFrame={onFrame}
                onBackground={setBackground}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-8">
                <EmptyState icon="avatars" title="No avatar yet" body="Upload a portrait photo or illustration to animate it with your face." action={<Button variant="primary" icon="upload" onClick={() => go('avatars')}>Upload an avatar</Button>} />
              </div>
            )}
            {avatarSummary && (
              <>
                <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2">
                  <AIBadge />
                  <span className="rounded-full bg-black/50 px-3 py-1 text-xs font-semibold backdrop-blur">{avatarSummary.name}</span>
                  {voice.status === 'streaming' && <AIBadge label={`AI VOICE · ${voice.voiceName ?? ''}`} />}
                </div>
                <div className="pointer-events-none absolute right-4 top-4 flex flex-col items-end gap-1 text-[11px] tabular-nums text-muted">
                  <span className="rounded bg-black/50 px-2 py-0.5 backdrop-blur">{tracking.state === 'loading' ? 'Loading face tracker…' : `Track ${tracking.fps} fps · Render ${renderFps} fps`}</span>
                  {background.mode === 'static' && <span className="rounded bg-black/50 px-2 py-0.5 backdrop-blur">Background locked</span>}
                  {vcam.state === 'on' && vcam.stats && <span className="rounded bg-black/50 px-2 py-0.5 backdrop-blur">Virtual camera {Math.round(vcam.stats.inputFps)} fps</span>}
                  {voice.latencyMs !== null && <span className="rounded bg-black/50 px-2 py-0.5 backdrop-blur">Voice latency {voice.latencyMs < 2000 ? `${voice.latencyMs} ms` : `${(voice.latencyMs / 1000).toFixed(1)} s`}</span>}
                </div>
                {paused && <div className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-full bg-black/70 px-4 py-1.5 text-sm font-semibold">Animation paused</div>}
                {!paused && calibrating && tracking.summary.found && (
                  <div className="absolute inset-x-0 bottom-6 mx-auto w-fit rounded-full bg-black/70 px-4 py-1.5 text-sm">Hold a neutral expression — calibrating…</div>
                )}
                {!authorised && (
                  <div className="absolute inset-x-6 top-14 flex items-center justify-between gap-3 rounded-lg bg-warn/15 p-3 text-sm text-warn">
                    <span>Confirm that you may animate this portrait before starting a session, the virtual camera or a recording.</span>
                    <Button size="sm" variant="primary" icon="shield" onClick={() => setAuthorising(true)}>Authorise</Button>
                  </div>
                )}
                {neuralWanted && neural.state === 'error' && (
                  <div className="absolute inset-x-6 bottom-16 rounded-lg bg-bad/15 p-2 text-center text-xs text-bad">{neural.detail} Using the standard (mesh) animation instead.</div>
                )}
                {background.mode === 'whole' && settings.preserve_background && avatar?.landmarks && (
                  <div className="absolute inset-x-6 bottom-6 rounded-lg bg-warn/15 p-2 text-center text-xs text-warn">
                    The background cannot be kept static for this picture: {background.reason} The whole picture moves with the head.
                  </div>
                )}
                {avatar && !avatar.landmarks && (
                  <div className="absolute inset-x-6 bottom-6 rounded-lg bg-warn/15 p-2 text-center text-xs text-warn">{avatarSummary.compatibility_note || 'No face detected in this picture: it follows head motion only.'}</div>
                )}
              </>
            )}
          </div>

          {/* ---------------- control bar */}
          <Card className="flex flex-wrap items-center gap-2 p-3">
            {!live2 ? (
              <Button variant="primary" size="lg" icon="play" disabled={!avatarSummary} onClick={() => void startSession()}>Start session</Button>
            ) : (
              <>
                <Button size="lg" icon={paused ? 'play' : 'pause'} onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause animation'}</Button>
                <Button variant="danger" size="lg" icon="stop" onClick={() => void stopSession()}>Stop</Button>
              </>
            )}
            <div className="mx-1 h-8 w-px bg-line" />
            <IconButton icon={voice.muted ? 'micOff' : 'mic'} label={voice.muted ? 'Unmute microphone' : 'Mute microphone'} active={voice.muted} disabled={voice.status !== 'streaming'} onClick={() => voice.setMuted(!voice.muted)} />
            <IconButton icon={webcam.status === 'live' ? 'camera' : 'cameraOff'} label={webcam.status === 'live' ? 'Turn camera off' : 'Turn camera on'} onClick={() => (webcam.status === 'live' ? webcam.stop() : void webcam.start())} />
            <IconButton icon="reset" label="Reset avatar position (recalibrate neutral pose)" onClick={resetNeutral} />
            <IconButton icon="fullscreen" label="Fullscreen" onClick={toggleFullscreen} />
            <div className="mx-1 h-8 w-px bg-line" />
            <Button
              icon="studio"
              variant={vcam.state === 'on' ? 'primary' : 'secondary'}
              disabled={!avatar || vcam.state === 'starting'}
              onClick={() => (vcam.state === 'on' ? stopVirtualCamera() : void startVirtualCamera())}
            >
              {vcam.state === 'on' ? 'Virtual camera on' : vcam.state === 'starting' ? 'Starting…' : 'Virtual camera'}
            </Button>
            {recorder.state === 'idle' || recorder.state === 'starting' ? (
              <IconButton icon="record" label="Record the avatar and converted voice" className="text-bad" disabled={!avatar || recorder.state === 'starting'} onClick={() => void startRecording()} />
            ) : (
              <>
                <IconButton
                  icon={recorder.state === 'paused' ? 'play' : 'pause'}
                  label={recorder.state === 'paused' ? 'Resume recording' : 'Pause recording'}
                  disabled={recorder.state === 'finishing'}
                  onClick={() => (recorder.state === 'paused' ? recorder.resume() : recorder.pause())}
                />
                <IconButton icon="stop" label="Stop and save the recording" active disabled={recorder.state === 'finishing'} onClick={() => void stopRecording()} />
              </>
            )}
            <div className="ml-auto flex gap-2">
              <Button icon="avatars" onClick={() => setPicker('avatar')}>Change avatar</Button>
              <Button icon="library" onClick={() => setPicker('voice')}>Change voice</Button>
            </div>
          </Card>
        </div>

        {/* ---------------- side panels */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-2">
          <Card className="pb-4">
            <CardHeader title="Camera" subtitle={tracking.delegate ? `MediaPipe Face Landmarker · ${tracking.delegate}` : 'MediaPipe Face Landmarker'} icon="camera" action={<StatusPill tone={trackingTone} label={tracking.summary.found ? `${tracking.summary.quality}%` : trackingLabel} />} />
            <div className="mx-5 mt-3 aspect-video overflow-hidden rounded-xl bg-black">
              <video ref={webcam.videoRef} muted playsInline className={`h-full w-full object-cover ${settings.mirror_preview ? '-scale-x-100' : ''}`} />
            </div>
            {webcam.error && <p role="alert" className="mx-5 mt-2 text-xs text-bad">{webcam.error}</p>}
            {tracking.error && <p role="alert" className="mx-5 mt-2 text-xs text-bad">Tracking: {tracking.error}</p>}
            <div className="mx-5 mt-3">
              <Field label="Camera" htmlFor="studio-camera">
                <select id="studio-camera" className="w-full" value={settings.camera_device_id ?? ''} onChange={(e) => void updateSettings({ camera_device_id: e.target.value || null })}>
                  <option value="">Default camera</option>
                  {devices.cameras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
                </select>
              </Field>
            </div>
            <dl className="mx-5 mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              {([['Smile', tracking.summary.expressions.smile], ['Mouth open', tracking.summary.expressions.mouthOpen], ['Blink', tracking.summary.expressions.blink], ['Brows', tracking.summary.expressions.browRaise], ['Frown', tracking.summary.expressions.frown]] as const).map(([label, value]) => (
                <div key={label}>
                  <dt className="mb-1 flex justify-between text-muted"><span>{label}</span><span className="tabular-nums">{Math.round(value * 100)}</span></dt>
                  <dd><Meter value={value} label={label} tone="accent" /></dd>
                </div>
              ))}
              <div>
                <dt className="mb-1 text-muted">Head</dt>
                <dd className="tabular-nums text-text">{tracking.summary.found ? `${Math.round(tracking.summary.yaw)}° · ${Math.round(tracking.summary.pitch)}° · ${Math.round(tracking.summary.roll)}°` : '—'}</dd>
              </div>
            </dl>
          </Card>

          <Card className="pb-4">
            <CardHeader title="Voice" subtitle="OpenVoice V2 · speech-to-speech" icon="mic" action={<StatusPill tone={voiceTone} label={voiceLabel} />} />
            <div className="mx-5 mt-3 space-y-3">
              <button type="button" onClick={() => setPicker('voice')} className="flex w-full items-center gap-3 rounded-xl border border-line bg-raised p-3 text-left transition hover:border-accent/50">
                {selectedVoice ? <VoiceGlyph voice={selectedVoice} size="sm" /> : <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-line"><Icon name="mic" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{selectedVoice?.name ?? 'Choose a voice'}</span>
                  <span className="block truncate text-xs text-muted">{selectedVoice ? (selectedVoice.kind === 'personal' ? 'My voice' : selectedVoice.language) : 'Without a voice, only the face is animated'}</span>
                </span>
                <Icon name="library" className="h-4 w-4 text-muted" />
              </button>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between text-muted"><span>Microphone {voice.muted ? '(muted)' : ''}</span><span>{voice.status === 'streaming' ? 'On' : 'Off'}</span></div>
                <Meter value={voice.muted ? 0 : voice.levels.input} label="Microphone level" />
                <div className="flex items-center justify-between text-muted"><span>AI voice output</span><span>{voice.status === 'streaming' && voice.rtf !== null ? `RTF ${voice.rtf.toFixed(2)}` : ''}</span></div>
                <Meter value={voice.levels.output} label="Converted voice level" tone="accent" />
              </div>
              {voice.status === 'streaming' && !voice.calibrated && !status?.source_voice_ready && (
                <p className="rounded-lg bg-accent/10 p-2 text-xs text-[#A99CFF]">Learning your voice from the first few seconds of speech… (calibrate in Settings to skip this)</p>
              )}
              {voice.mode === 'buffered' && (
                <p className="rounded-lg bg-warn/10 p-2 text-xs text-warn">
                  This PC converts speech slower than real time, so the AI voice runs behind and catches up when you pause. The avatar's mouth follows the converted voice.
                  {voice.dropped > 0 && ` ${voice.dropped} block(s) skipped to limit delay.`}
                </p>
              )}
              <div className="rounded-lg border border-line bg-raised/60 p-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Virtual microphone</span>
                  <StatusPill
                    tone={!settings.virtual_mic_device_id ? 'idle' : voice.virtualMic?.error ? 'bad' : voice.virtualMic ? 'ok' : 'idle'}
                    label={!settings.virtual_mic_device_id ? 'Off' : voice.virtualMic?.error ? 'Error' : voice.virtualMic ? 'Sending AI voice' : 'Starts with session'}
                  />
                </div>
                <p className="mt-1 text-muted">
                  {settings.virtual_mic_device_id
                    ? voice.virtualMic?.error ?? `→ ${devices.outputs.find((d) => d.deviceId === settings.virtual_mic_device_id)?.label || 'selected device'}. In the call app, choose the matching cable as the microphone.`
                    : 'Send the converted voice to call apps: set it up in Settings → Outputs.'}
                </p>
              </div>
              <Field label="Audio output" htmlFor="studio-output">
                <select id="studio-output" className="w-full" value={settings.audio_output_device_id ?? ''} onChange={(e) => { const id = e.target.value || null; void updateSettings({ audio_output_device_id: id }); void voice.setOutputDevice(id); }}>
                  <option value="">System default</option>
                  {devices.outputs.filter((d) => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${i + 1}`}</option>)}
                </select>
              </Field>
              <Field label="Microphone" htmlFor="studio-mic">
                <select id="studio-mic" className="w-full" disabled={voice.status === 'streaming'} value={settings.microphone_device_id ?? ''} onChange={(e) => void updateSettings({ microphone_device_id: e.target.value || null })}>
                  <option value="">Default microphone</option>
                  {devices.microphones.filter((d) => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}
                </select>
              </Field>
            </div>
          </Card>
        </div>
      </div>

      <PortraitAuthorisationDialog
        open={authorising && !!avatarSummary}
        title={`Authorise “${avatarSummary?.name ?? ''}”`}
        onCancel={() => setAuthorising(false)}
        onConfirm={(consent) => {
          setAuthorising(false);
          if (avatarSummary) void engine.authoriseAvatar(avatarSummary.id, consent).then(refreshAvatars).then(() => toast('Portrait authorised.', 'ok')).catch((e: Error) => toast(e.message, 'bad'));
        }}
      />

      {/* ---------------- pickers */}
      <Modal open={picker === 'avatar'} title="Choose avatar" onClose={() => setPicker(null)} wide>
        {avatars.length === 0 ? (
          <EmptyState icon="avatars" title="No avatars" body="Upload portraits in My Avatars." action={<Button variant="primary" onClick={() => go('avatars')}>Go to My Avatars</Button>} />
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {avatars.map((a) => (
              <button key={a.id} type="button" onClick={() => chooseAvatar(a.id)} className={`overflow-hidden rounded-xl border text-left transition ${a.id === avatarSummary?.id ? 'border-accent shadow-glow' : 'border-line hover:border-accent/50'}`}>
                <AvatarImage avatar={a} className="aspect-square w-full" />
                <div className="flex items-center justify-between gap-1 p-2"><span className="truncate text-xs font-semibold">{a.name}</span><CompatibilityBadge avatar={a} /></div>
              </button>
            ))}
          </div>
        )}
      </Modal>
      <Modal open={picker === 'voice'} title="Choose voice" onClose={() => setPicker(null)}>
        <div className="space-y-1.5">
          <button type="button" onClick={() => { void updateSettings({ selected_voice_id: null }); setPicker(null); }} className="flex w-full items-center gap-3 rounded-xl p-2.5 text-left hover:bg-raised">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-line"><Icon name="micOff" /></span>
            <span className="text-sm">No voice conversion (face only)</span>
          </button>
          {sortedVoices.map((v) => (
            <button key={v.id} type="button" disabled={!v.ready} onClick={() => chooseVoice(v.id)} className={`flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition disabled:opacity-40 ${v.id === selectedVoice?.id ? 'bg-accent/15 ring-1 ring-accent/40' : 'hover:bg-raised'}`}>
              <VoiceGlyph voice={v} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{v.name} {v.favourite && <Icon name="star" filled className="inline h-3 w-3 text-warn" />}</span>
                <span className="block truncate text-xs text-muted">{v.kind === 'personal' ? `My voice · ${v.consent_subject}` : `${v.language} · ${v.description}`}</span>
              </span>
            </button>
          ))}
          <div className="pt-2"><Button size="sm" variant="ghost" onClick={() => { setPicker(null); go('voice-library'); }}>Open voice library →</Button></div>
        </div>
      </Modal>
    </div>
  );
}
