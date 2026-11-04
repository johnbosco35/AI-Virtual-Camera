import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { useAppStore } from '@/store/appStore';

export function CameraSettings() {
  const {
    cameraDeviceId,
    setCameraDeviceId,
    cameraResolution,
    setCameraResolution,
    mirrorPreview,
    setMirrorPreview,
    smoothingStrength,
    setSmoothingStrength,
    go,
  } = useAppStore();
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!navigator.mediaDevices?.enumerateDevices) {
      setError('Camera selection is not supported in this environment.');
      return;
    }
    void navigator.mediaDevices.enumerateDevices()
      .then((devices) => {
        if (active) {
          setCameras(devices.filter((device) => device.kind === 'videoinput'));
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Camera devices could not be listed.');
      });
    return () => { active = false; };
  }, []);

  return (
    <section className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">Camera and tracking settings</h1>
      <p className="text-slate-600">Adjust these before starting a session. Camera and tracking preview is available on the Camera preview page.</p>
      <div className="space-y-5 rounded-lg bg-white p-5 ring-1 ring-slate-200">
        <div>
          <label htmlFor="settings-camera" className="mb-1 block text-sm font-medium">Camera</label>
          <select id="settings-camera" value={cameraDeviceId ?? ''} onChange={(event) => setCameraDeviceId(event.target.value || null)} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2">
            <option value="">Default camera</option>
            {cameras.map((camera) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || 'Camera'}</option>)}
          </select>
          {error && <p role="alert" className="mt-1 text-sm text-bad">{error}</p>}
          {!error && cameras.length === 0 && <p className="mt-1 text-xs text-slate-500">Camera labels appear after camera permission is granted.</p>}
        </div>
        <div>
          <label htmlFor="settings-resolution" className="mb-1 block text-sm font-medium">Resolution</label>
          <select id="settings-resolution" value={cameraResolution} onChange={(event) => {
            if (event.target.value === '720p' || event.target.value === '1080p') setCameraResolution(event.target.value);
          }} className="w-full rounded-md border border-slate-300 bg-white px-3 py-2">
            <option value="720p">720p (recommended)</option>
            <option value="1080p">1080p</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mirrorPreview} onChange={(event) => setMirrorPreview(event.target.checked)} />
          Mirror self-view
        </label>
        <div>
          <label htmlFor="settings-smoothing" className="mb-1 flex justify-between text-sm font-medium">
            <span>Tracking smoothing</span><span>{Math.round(smoothingStrength * 100)}%</span>
          </label>
          <input id="settings-smoothing" type="range" min="0" max="0.9" step="0.05" value={smoothingStrength} onChange={(event) => setSmoothingStrength(Number(event.target.value))} className="w-full accent-lens" />
          <p className="mt-1 text-xs text-slate-500">Higher values reduce jitter but add some response delay.</p>
        </div>
        <Button onClick={() => go('preview')}>Open camera preview</Button>
      </div>
    </section>
  );
}
