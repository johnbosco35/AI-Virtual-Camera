import { useEffect, useRef, useState } from 'react';
import { ThreeAvatarCanvas } from '@/components/ThreeAvatarCanvas';
import { Button } from '@/components/Button';
import { StatusPill } from '@/components/StatusPill';
import { useFaceTracking } from '@/hooks/useFaceTracking';
import { useWebcam } from '@/hooks/useWebcam';
import { formatClock } from '@/lib/time';
import { endSession } from '@/services/license';
import { useAppStore } from '@/store/appStore';

export function Session() {
  const {
    entitlement,
    setEntitlement,
    go,
    cameraDeviceId,
    cameraResolution,
    mirrorPreview,
    smoothingStrength,
    selectedAvatar,
    customAvatar,
  } = useAppStore();
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const endingRef = useRef(false);
  const expiryAttemptedRef = useRef(false);
  const { videoRef, status, error, start } = useWebcam(cameraDeviceId, cameraResolution);
  const tracking = useFaceTracking(videoRef, status === 'live', smoothingStrength, customAvatar?.blob ?? null, customAvatar?.id ?? null);

  // Remaining time is derived from the server-issued absolute expiry, so a restart or
  // re-render can never reset the countdown.
  const remaining =
    entitlement.status === 'active' ? (entitlement.expiresAt - (now + entitlement.serverOffsetMs)) / 1000 : 0;
  const trackingMessage = {
    none: 'Face centered and tracking.',
    'no-face': 'No face found. Move into the camera frame.',
    'poor-lighting': 'Lighting is low. Move to a brighter area.',
    'face-too-small': 'Move closer to the camera.',
    'out-of-frame': 'Your face is near the edge. Move toward the center.',
  }[tracking.metrics.issue];

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (entitlement.status === 'active') void start();
  }, [entitlement.status, start]);

  useEffect(() => {
    if (entitlement.status !== 'active' || remaining > 0 || endingRef.current || expiryAttemptedRef.current) return;
    expiryAttemptedRef.current = true;
    endingRef.current = true;
    setEnding(true);
    void endSession(entitlement)
      .then((e) => {
        setEntitlement(e);
        go('complete');
      })
      .catch((cause: unknown) => {
        setEndError(cause instanceof Error ? cause.message : 'Session could not be ended.');
        endingRef.current = false;
        setEnding(false);
      });
  }, [entitlement, remaining, setEntitlement, go]);

  const finishSession = async () => {
    if (entitlement.status !== 'active' || endingRef.current) return;
    endingRef.current = true;
    setEnding(true);
    setEndError(null);
    try {
      setEntitlement(await endSession(entitlement));
      go('complete');
    } catch (cause) {
      setEndError(cause instanceof Error ? cause.message : 'Session could not be ended.');
      endingRef.current = false;
      setEnding(false);
    }
  };

  if (entitlement.status !== 'active') {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">No active session</h1>
        <Button onClick={() => go('preview')}>Back to preview</Button>
      </section>
    );
  }

  return (
    <section className="grid max-w-5xl gap-6 md:grid-cols-[1fr_16rem]">
      <div>
      <h1 className="text-2xl font-semibold">Session in progress</h1>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="aspect-video overflow-hidden rounded-lg bg-slate9 ring-1 ring-slate-300">
            <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${mirrorPreview ? '-scale-x-100' : ''}`} />
          </div>
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
        {error && (
          <div role="alert" className="mt-3 rounded-md bg-bad/10 p-3 text-sm text-bad">
            <strong>{error.title}</strong> {error.fix}
          </div>
        )}
        {tracking.error && (
          <div role="alert" className="mt-3 rounded-md bg-bad/10 p-3 text-sm text-bad">
            Face tracking stopped: {tracking.error}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-md bg-white p-3 ring-1 ring-slate-200">
          <span className="text-sm">Tracking quality</span>
          <StatusPill
            tone={!tracking.metrics.faceFound ? 'warn' : tracking.metrics.quality >= 65 ? 'ok' : 'warn'}
            label={
              tracking.state === 'loading'
                ? 'Loading model'
                : tracking.state !== 'ready'
                  ? 'Unavailable'
                  : tracking.metrics.faceFound
                    ? `${tracking.metrics.quality}% estimate`
                    : tracking.metrics.issue === 'poor-lighting'
                      ? 'Improve lighting'
                      : 'No face found'
            }
          />
        </div>
        {tracking.state === 'ready' && <p className="mt-1 text-xs text-slate-600">{trackingMessage}</p>}
        <p className="mt-2 text-xs text-slate-500">Webcam frames and tracking data are processed locally and are not saved or sent over the network.</p>
      </div>
      <div className="space-y-5">
        <div>
          <h1 className="text-sm font-medium text-slate-600">Session time remaining</h1>
          <div className="mt-1 text-5xl font-semibold tabular-nums" aria-live="off">{formatClock(remaining)}</div>
        </div>
        <p className="text-sm text-slate-600">
          Select “AI Virtual Camera” in your video-call app. Live camera output is unavailable until the native camera is installed.
        </p>
      <Button
        variant="danger"
        onClick={() => void finishSession()}
        disabled={ending}
      >
        {ending ? 'Ending session…' : 'End session'}
      </Button>
      {endError && <p role="alert" className="text-sm text-bad">{endError}</p>}
      </div>
    </section>
  );
}
