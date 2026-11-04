import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/Button';
import { StatusPill } from '@/components/StatusPill';
import { ThreeAvatarCanvas } from '@/components/ThreeAvatarCanvas';
import { useFaceTracking } from '@/hooks/useFaceTracking';
import { useWebcam } from '@/hooks/useWebcam';
import { validateLocalImage } from '@/lib/validateLocalImage';
import { useAppStore, type BackgroundPreset } from '@/store/appStore';

const choices: { id: Exclude<BackgroundPreset, 'custom'>; name: string; description: string; swatch: string }[] = [
  { id: 'scene', name: 'Avatar scene', description: 'Soft, neutral backdrop', swatch: 'linear-gradient(135deg,#e9f4f1,#d7e8e4)' },
  { id: 'blur', name: 'Soft blur', description: 'Abstract blurred colors, not camera segmentation', swatch: 'radial-gradient(ellipse at 30% 35%,#fff8,transparent 55%),linear-gradient(135deg,#dbeafe,#e9d5ff)' },
  { id: 'solid', name: 'Solid color', description: 'Deep teal', swatch: '#28535b' },
  { id: 'midnight', name: 'Midnight', description: 'Deep blue gradient', swatch: 'linear-gradient(135deg,#152341,#3b3b69)' },
  { id: 'sunset', name: 'Sunset', description: 'Warm sunset illustration', swatch: 'linear-gradient(135deg,#f9a875,#7d497e)' },
  { id: 'mint', name: 'Mint', description: 'Fresh green gradient', swatch: 'linear-gradient(135deg,#d9f3e8,#92c9b3)' },
  { id: 'mountains', name: 'Mountains', description: 'Original mountain illustration', swatch: 'linear-gradient(135deg,#9ec9d5,#719e9c)' },
  { id: 'city', name: 'City', description: 'Original city illustration', swatch: 'linear-gradient(135deg,#f6d5bd,#8ba7c7)' },
];

export function Background() {
  const {
    selectedAvatar,
    customAvatar,
    backgroundPreview,
    setBackgroundPreview,
    customBackground,
    setCustomBackground,
    go,
    cameraDeviceId,
    cameraResolution,
    mirrorPreview,
    smoothingStrength,
  } = useAppStore();
  const { videoRef, status, error, start, stop } = useWebcam(cameraDeviceId, cameraResolution);
  const tracking = useFaceTracking(videoRef, status === 'live', smoothingStrength, customAvatar?.blob ?? null, customAvatar?.id ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void start();
  }, [start]);

  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setBusy(true);
    setUploadError(null);
    try {
      await validateLocalImage(file, { minDimension: 1 });
      setCustomBackground({ url: URL.createObjectURL(file), name: file.name });
      setBackgroundPreview('custom');
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : 'The image could not be loaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Backgrounds</h1>
        <p className="mt-1 text-slate-600">Preview original local backdrops behind your current avatar. Background-code authorization is not connected.</p>
      </header>

      <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Preview only — background feature not verified.</strong> The selected background is not applied to sessions or Studio.
        The backend must authorize the Background add-on before applying it.
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-3 text-lg font-semibold">Choose a preview background</legend>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {choices.map((choice) => (
                <button
                  type="button"
                  key={choice.id}
                  aria-pressed={backgroundPreview === choice.id}
                  onClick={() => setBackgroundPreview(choice.id)}
                  className={`rounded-lg bg-white p-2 text-left ring-2 transition-colors ${
                    backgroundPreview === choice.id ? 'ring-lens' : 'ring-slate-200 hover:ring-slate-400'
                  }`}
                >
                  <span className="block h-20 rounded-md" style={{ background: choice.swatch }} aria-hidden="true" />
                  <span className="mt-2 block text-sm font-semibold">{choice.name}</span>
                  <span className="block text-xs text-slate-500">{choice.description}</span>
                </button>
              ))}
              {customBackground && (
                <button
                  type="button"
                  aria-pressed={backgroundPreview === 'custom'}
                  onClick={() => setBackgroundPreview('custom')}
                  className={`rounded-lg bg-white p-2 text-left ring-2 ${
                    backgroundPreview === 'custom' ? 'ring-lens' : 'ring-slate-200 hover:ring-slate-400'
                  }`}
                >
                  <img src={customBackground.url} alt="" className="block h-20 w-full rounded-md object-cover" />
                  <span className="mt-2 block text-sm font-semibold">Your image</span>
                  <span className="block truncate text-xs text-slate-500">{customBackground.name}</span>
                </button>
              )}
            </div>
          </fieldset>

          <section className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200">
            <h2 className="font-semibold">Use your own background image</h2>
            <p className="text-sm text-slate-600">PNG, JPEG, or WebP; up to 10 MB and 4096 × 4096 pixels. It is decoded and kept in memory on this PC only.</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                {busy ? 'Checking image…' : customBackground ? 'Choose another image' : 'Upload image'}
              </Button>
              {customBackground && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setCustomBackground(null);
                    if (backgroundPreview === 'custom') setBackgroundPreview('scene');
                  }}
                >
                  Delete image
                </Button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              onChange={(event) => void upload(event)}
              className="sr-only"
              aria-label="Upload a PNG, JPEG, or WebP background image"
            />
            {uploadError && <p role="alert" className="text-sm text-bad">{uploadError}</p>}
          </section>
        </div>

        <aside className="space-y-3">
          <h2 className="font-semibold">Live avatar preview</h2>
          <div className="grid grid-cols-2 gap-2">
            <div className="aspect-video overflow-hidden rounded-lg bg-slate9">
              <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${mirrorPreview ? '-scale-x-100' : ''}`} />
            </div>
            <div className="aspect-video overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
              <ThreeAvatarCanvas
                avatar={selectedAvatar}
                customImageUrl={customAvatar?.url}
                sourceFaceLandmarks={tracking.templateLandmarks}
                faceMeshTriangles={tracking.templateTriangles}
                templateError={tracking.templateError}
                background={backgroundPreview}
                backgroundImageUrl={backgroundPreview === 'custom' ? customBackground?.url : null}
                metrics={tracking.metrics}
                tracking={tracking.state === 'ready' && tracking.metrics.faceFound}
              />
            </div>
          </div>
          <StatusPill
            tone={status === 'error' ? 'bad' : tracking.metrics.faceFound ? 'ok' : 'warn'}
            label={status === 'error' ? 'Camera unavailable' : tracking.metrics.faceFound ? `Tracking ${tracking.metrics.quality}% estimate` : status === 'live' ? 'No face found' : 'Starting camera'}
          />
          {error && <p role="alert" className="text-sm text-bad">{error.title} {error.fix}</p>}
          {tracking.error && <p role="alert" className="text-sm text-bad">Face tracking could not start: {tracking.error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void start()}>Try camera again</Button>
            <Button variant="secondary" onClick={stop} disabled={status !== 'live'}>Stop preview</Button>
          </div>
          <Button disabled title="Feature-code authorization is unavailable">Apply background</Button>
          <Button variant="secondary" onClick={() => go('activate')}>
            Review activation screen
          </Button>
        </aside>
      </div>
      <p className="text-xs text-slate-500">The preview never replaces the real webcam background. No camera segmentation is enabled. Built-in artwork is drawn locally; no background images are uploaded.</p>
    </section>
  );
}
