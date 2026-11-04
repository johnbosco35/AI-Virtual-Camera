import { useCallback, useEffect, useRef, useState } from 'react';

export type WebcamStatus = 'idle' | 'starting' | 'live' | 'error';

export interface WebcamError {
  title: string;
  fix: string;
}

function describeError(err: unknown): WebcamError {
  const name = err instanceof DOMException ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
      return { title: 'Camera access was blocked.', fix: 'Allow camera access in Windows Settings > Privacy > Camera, then try again.' };
    case 'NotFoundError':
      return { title: 'No camera found.', fix: 'Connect a webcam and press Try again.' };
    case 'NotReadableError':
      return { title: 'The camera is in use.', fix: 'Close other apps that use the camera, then try again.' };
    case 'OverconstrainedError':
      return { title: 'This camera does not support the requested mode.', fix: 'Choose another camera.' };
    default:
      return { title: 'The camera could not start.', fix: 'Try again or choose another camera.' };
  }
}

export function useWebcam(preferredDeviceId: string | null, resolution: '720p' | '1080p' = '720p') {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const [status, setStatus] = useState<WebcamStatus>('idle');
  const [error, setError] = useState<WebcamError | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const refreshDevices = useCallback(async () => {
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === 'videoinput'));
  }, []);

  const start = useCallback(async () => {
    stop();
    const requestId = requestIdRef.current;
    setStatus('starting');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: preferredDeviceId ? { exact: preferredDeviceId } : undefined,
          width: { ideal: resolution === '1080p' ? 1920 : 1280 },
          height: { ideal: resolution === '1080p' ? 1080 : 720 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      // Handle unplugging mid-use.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setError({ title: 'The camera was disconnected.', fix: 'Reconnect it and press Try again.' });
        setStatus('error');
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (requestId !== requestIdRef.current) return;
      await refreshDevices(); // labels are only available after permission is granted
      if (requestId === requestIdRef.current) setStatus('live');
    } catch (err) {
      if (requestId === requestIdRef.current) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (videoRef.current) videoRef.current.srcObject = null;
        setError(describeError(err));
        setStatus('error');
      }
    }
  }, [preferredDeviceId, refreshDevices, resolution, stop]);

  useEffect(() => {
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, error, devices, start, stop };
}
