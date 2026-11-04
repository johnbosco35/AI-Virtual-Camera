import { useEffect, useState } from 'react';
import { AvatarChooser } from '@/components/AvatarChooser';
import { Button } from '@/components/Button';
import { StatusPill } from '@/components/StatusPill';
import { ThreeAvatarCanvas } from '@/components/ThreeAvatarCanvas';
import { useFaceTracking } from '@/hooks/useFaceTracking';
import { useWebcam } from '@/hooks/useWebcam';
import { native } from '@/lib/native';
import { startSession } from '@/services/license';
import { useAppStore } from '@/store/appStore';

export function Preview() {
  const {
    entitlement,
    setEntitlement,
    cameraDeviceId,
    setCameraDeviceId,
    cameraResolution,
    mirrorPreview,
    smoothingStrength,
    setSmoothingStrength,
    setCameraResolution,
    setMirrorPreview,
    selectedAvatar,
    customAvatar,
    go,
  } = useAppStore();
  const { videoRef, status, error, devices, start, stop } = useWebcam(cameraDeviceId, cameraResolution);
  const tracking = useFaceTracking(videoRef, status === 'live', smoothingStrength, customAvatar?.blob ?? null, customAvatar?.id ?? null);
  const [cpuPercent, setCpuPercent] = useState<number | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);

  // Preview never consumes the entitlement. Only the Start button below does.
  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    let active = true;
    const sampleCpu = async () => {
      try {
        const sample = await native.getPerformanceMetrics();
        if (active) {
          setCpuPercent(sample?.cpuPercent ?? null);
          setPerformanceError(null);
        }
      } catch (cause) {
        if (active) {
          setPerformanceError(cause instanceof Error ? cause.message : 'CPU usage is unavailable.');
        }
      }
    };
    void sampleCpu();
    const interval = window.setInterval(() => void sampleCpu(), 1000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const canStart = entitlement.status === 'activated' && status === 'live';

  const begin = async () => {
    try {
      setActivationError(null);
      setEntitlement(await startSession(entitlement));
      go('session');
    } catch (cause) {
      setActivationError(cause instanceof Error ? cause.message : 'Session could not be started.');
    }
  };

  const trackingIssue = {
    none: 'Face centered and tracking.',
    'no-face': 'No face found. Move into the camera frame.',
    'poor-lighting': 'Lighting is low. Move to a brighter area.',
    'face-too-small': 'Move closer to the camera.',
    'out-of-frame': 'Your face is near the edge. Move toward the center.',
  }[tracking.metrics.issue];

  return (
    <section className="grid max-w-5xl gap-6 md:grid-cols-[1fr_16rem]">
      <div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Camera</div>
            <div className="aspect-video overflow-hidden rounded-lg bg-slate9 ring-1 ring-slate-300">
              <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${mirrorPreview ? '-scale-x-100' : ''}`} />
            </div>
          </div>
          <div>
            <div className="mb-1 text-xs font-medium text-slate-600">Avatar</div>
            <div className="aspect-video overflow-hidden rounded-lg bg-white ring-1 ring-slate-300">
              <ThreeAvatarCanvas
                avatar={selectedAvatar}
                customImageUrl={customAvatar?.url}
                sourceFaceLandmarks={tracking.templateLandmarks}
                faceMeshTriangles={tracking.templateTriangles}
                templateError={tracking.templateError}
                metrics={tracking.metrics}
                tracking={tracking.state === 'ready' && tracking.metrics.faceFound}
              />
            </div>
          </div>
        </div>
        {error && (
          <div role="alert" className="mt-3 rounded-md bg-bad/10 p-3 text-sm text-bad">
            <strong>{error.title}</strong> {error.fix}
          </div>
        )}
        {tracking.state === 'loading' && (
          <p role="status" className="mt-3 text-sm text-slate-600">Loading the bundled face-tracking model…</p>
        )}
        {tracking.error && (
          <div role="alert" className="mt-3 rounded-md bg-bad/10 p-3 text-sm text-bad">
            Face tracking could not start: {tracking.error}
          </div>
        )}
        {tracking.state === 'ready' && (
          <div className="mt-3 rounded-md bg-white p-3 ring-1 ring-slate-200" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">Tracking quality</span>
              <span>{tracking.metrics.faceFound ? `${tracking.metrics.quality}% estimate` : 'No face'}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-ok transition-[width]" style={{ width: `${tracking.metrics.quality}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-600">{trackingIssue}</p>
            <div className="mt-2 flex gap-4 text-xs text-slate-600">
              <span>Tracking: {tracking.fps || 'Measuring'} fps</span>
              <span>App CPU: {cpuPercent === null ? 'Unavailable' : `${cpuPercent.toFixed(1)}%`}</span>
            </div>
            {performanceError && <p role="alert" className="mt-1 text-xs text-bad">{performanceError}</p>}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <StatusPill
          tone={status === 'live' ? 'ok' : status === 'error' ? 'bad' : 'idle'}
          label={status === 'live' ? 'Camera live' : status === 'starting' ? 'Starting camera' : status === 'error' ? 'Camera problem' : 'Camera off'}
        />
        <div>
          <label htmlFor="cam" className="mb-1 block text-sm font-medium">Camera</label>
          <select
            id="cam"
            value={cameraDeviceId ?? ''}
            onChange={(e) => setCameraDeviceId(e.target.value || null)}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
          >
            <option value="">Default camera</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || 'Camera'}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="resolution" className="mb-1 block text-sm font-medium">Camera resolution</label>
          <select
            id="resolution"
            value={cameraResolution}
            onChange={(event) => {
              if (event.target.value === '720p' || event.target.value === '1080p') setCameraResolution(event.target.value);
            }}
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
          >
            <option value="720p">720p (recommended)</option>
            <option value="1080p">1080p</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mirrorPreview} onChange={(event) => setMirrorPreview(event.target.checked)} />
          Mirror camera preview
        </label>
        <div>
          <label htmlFor="smoothing" className="mb-1 flex justify-between text-sm font-medium">
            <span>Tracking smoothing</span>
            <span>{Math.round(smoothingStrength * 100)}%</span>
          </label>
          <input
            id="smoothing"
            type="range"
            min="0"
            max="0.9"
            step="0.05"
            value={smoothingStrength}
            onChange={(event) => setSmoothingStrength(Number(event.target.value))}
            className="w-full accent-lens"
          />
          <p className="text-xs text-slate-500">More smoothing reduces jitter but can add a little delay.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void start()}>Try again</Button>
          <Button variant="secondary" onClick={stop} disabled={status !== 'live'}>Stop preview</Button>
        </div>
        <hr className="border-slate-200" />
        <Button onClick={begin} disabled={!canStart || tracking.state !== 'ready' || !tracking.metrics.faceFound} className="w-full">Start session</Button>
        {activationError && <p role="alert" className="text-sm text-bad">{activationError}</p>}
        <p className="text-xs text-slate-500">
          Starting uses your one session and begins a 15-minute countdown. Previewing is free. Webcam frames and tracking data stay on this PC and are not saved.
        </p>
        {entitlement.status === 'none' && (
          <p className="text-xs text-warn">Activate this computer first.</p>
        )}
        <button type="button" onClick={() => go('avatars')} className="text-left text-sm font-medium text-slate8 underline">
          Choose avatar or upload a picture
        </button>
      </div>
      <div className="md:col-span-2">
        <AvatarChooser />
      </div>
    </section>
  );
}
