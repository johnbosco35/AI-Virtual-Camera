import { useCallback, useEffect, useRef, useState } from 'react';
import { describeMediaError } from '@/lib/audio';

export type WebcamStatus = 'idle' | 'starting' | 'live' | 'error';

const SIZES = { '480p': [640, 480], '720p': [1280, 720], '1080p': [1920, 1080] } as const;

export function useWebcam(deviceId: string | null, resolution: keyof typeof SIZES = '720p') {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const requestRef = useRef(0);
  const [status, setStatus] = useState<WebcamStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    requestRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    stop();
    const request = requestRef.current;
    setStatus('starting');
    setError(null);
    const [width, height] = SIZES[resolution] ?? SIZES['720p'];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30 } },
        audio: false,
      });
      if (request !== requestRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        setError('The camera was disconnected. Reconnect it and start the camera again.');
        setStatus('error');
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (request === requestRef.current) setStatus('live');
    } catch (cause) {
      if (request !== requestRef.current) return;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setError(describeMediaError(cause, 'camera'));
      setStatus('error');
    }
  }, [deviceId, resolution, stop]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, error, start, stop };
}
