import { useEffect } from 'react';
import { AvatarChooser } from '@/components/AvatarChooser';
import { Button } from '@/components/Button';
import { ThreeAvatarCanvas } from '@/components/ThreeAvatarCanvas';
import { StatusPill } from '@/components/StatusPill';
import { useFaceTracking } from '@/hooks/useFaceTracking';
import { useWebcam } from '@/hooks/useWebcam';
import { useAppStore } from '@/store/appStore';

export function AvatarSelection() {
  const { go, selectedAvatar, customAvatar, cameraDeviceId, cameraResolution, mirrorPreview, smoothingStrength } = useAppStore();
  const { videoRef, status, error, start } = useWebcam(cameraDeviceId, cameraResolution);
  const tracking = useFaceTracking(videoRef, status === 'live', smoothingStrength, customAvatar?.blob ?? null, customAvatar?.id ?? null);

  useEffect(() => {
    void start();
  }, [start]);

  return (
    <section className="max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Avatar selection</h1>
        <p className="mt-2 text-slate-600">Choose an original built-in avatar or add an image with permission from the person shown.</p>
      </header>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
        <AvatarChooser metrics={tracking.metrics} tracking={tracking.state === 'ready' && tracking.metrics.faceFound} />
        <aside className="space-y-3">
          <h2 className="font-semibold">Live camera and avatar preview</h2>
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
              metrics={tracking.metrics}
              tracking={tracking.state === 'ready' && tracking.metrics.faceFound}
            />
          </div>
          <StatusPill
            tone={status === 'error' ? 'bad' : tracking.metrics.faceFound ? 'ok' : 'warn'}
            label={status === 'error' ? 'Camera unavailable' : tracking.metrics.faceFound ? `Tracking ${tracking.metrics.quality}% estimate` : status === 'live' ? 'No face found' : 'Starting camera'}
          />
          {error && <p role="alert" className="text-sm text-bad">{error.title} {error.fix}</p>}
          {tracking.error && <p role="alert" className="text-sm text-bad">Face tracking could not start: {tracking.error}</p>}
          <Button className="w-full" onClick={() => go('preview')}>Continue to camera preview</Button>
          <button type="button" className="w-full text-center text-sm underline" onClick={() => go('camera')}>Camera and tracking settings</button>
        </aside>
      </div>
    </section>
  );
}
