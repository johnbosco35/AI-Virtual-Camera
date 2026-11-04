import { useEffect } from 'react';
import { Button } from '@/components/Button';
import { StatusPill } from '@/components/StatusPill';
import { ThreeAvatarCanvas } from '@/components/ThreeAvatarCanvas';
import { useFaceTracking } from '@/hooks/useFaceTracking';
import { useWebcam } from '@/hooks/useWebcam';
import { useAppStore } from '@/store/appStore';

export function Studio() {
  const { entitlement, cameraDeviceId, cameraResolution, mirrorPreview, smoothingStrength, selectedAvatar, customAvatar, go } = useAppStore();
  const { videoRef, status, error, start } = useWebcam(cameraDeviceId, cameraResolution);
  const tracking = useFaceTracking(videoRef, status === 'live', smoothingStrength, customAvatar?.blob ?? null, customAvatar?.id ?? null);

  useEffect(() => {
    if (entitlement.status === 'active') void start();
  }, [entitlement.status, start]);

  if (entitlement.status !== 'active') {
    return (
      <section className="max-w-xl space-y-4">
        <h1 className="text-2xl font-semibold">Studio</h1>
        <p className="text-slate-600">Start an authorized session from Camera preview before opening the studio.</p>
        <Button onClick={() => go('preview')}>Go to camera preview</Button>
      </section>
    );
  }

  return (
    <section className="max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Studio</h1>
        <p className="mt-1 text-slate-600">Preview the selected avatar. Recording and Go Live are not available in this build.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="mb-1 text-sm font-medium">Camera</h2>
          <div className="aspect-video overflow-hidden rounded-lg bg-slate9">
            <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${mirrorPreview ? '-scale-x-100' : ''}`} />
          </div>
        </div>
        <div>
          <h2 className="mb-1 text-sm font-medium">Avatar preview</h2>
          <div className="aspect-video overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
            <ThreeAvatarCanvas
              avatar={selectedAvatar}
              customImageUrl={customAvatar?.url}
              sourceFaceLandmarks={tracking.templateLandmarks}
              faceMeshTriangles={tracking.templateTriangles}
              templateError={tracking.templateError}
              metrics={tracking.metrics}
              tracking={tracking.metrics.faceFound}
            />
          </div>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error.title} {error.fix}</p>}
      {tracking.error && <p role="alert" className="text-sm text-bad">Face tracking could not start: {tracking.error}</p>}
      <StatusPill tone={tracking.metrics.faceFound ? 'ok' : 'warn'} label={tracking.metrics.faceFound ? `Tracking ${tracking.metrics.quality}% estimate` : status === 'live' ? 'No face found' : 'Camera off'} />
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => void start()}>Start camera preview</Button>
        <Button disabled title="Recording is not implemented yet">Record</Button>
        <Button disabled title="The native virtual camera is not available yet">Go Live</Button>
        <Button variant="secondary" onClick={() => go('preview')}>Back to camera preview</Button>
      </div>
      <p className="text-xs text-slate-500">Webcam frames and tracking data stay on this PC. Leaving this screen stops the preview and tracking worker.</p>
    </section>
  );
}
