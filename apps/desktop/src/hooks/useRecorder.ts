import { useCallback, useEffect, useRef, useState } from 'react';
import { createCaptureContext, describeMediaError, encodeWav } from '@/lib/audio';

/** Records the microphone locally to a WAV blob (nothing leaves the PC until the user saves it). */
export function useRecorder(microphoneId: string | null, maxSeconds = 60) {
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const teardown = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    setRecording(false);
    setLevel(0);
  }, []);

  const finish = useCallback(() => {
    const context = contextRef.current;
    if (!context) return;
    const blob = encodeWav(chunksRef.current, context.sampleRate);
    chunksRef.current = [];
    teardown();
    setResult(blob);
  }, [teardown]);

  const start = useCallback(async () => {
    setError(null);
    setResult(null);
    setSeconds(0);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: microphoneId ? { exact: microphoneId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const context = await createCaptureContext();
      contextRef.current = context;
      const node = new AudioWorkletNode(context, 'pcm-capture', { processorOptions: { mode: 'float' } });
      const silent = context.createGain();
      silent.gain.value = 0;
      context.createMediaStreamSource(stream).connect(node).connect(silent).connect(context.destination);
      let total = 0;
      node.port.onmessage = (event: MessageEvent<{ samples: Float32Array; rms: number }>) => {
        chunksRef.current.push(event.data.samples);
        total += event.data.samples.length;
        setLevel(Math.min(1, event.data.rms * 5));
        const elapsed = total / context.sampleRate;
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) finish();
      };
      setRecording(true);
    } catch (cause) {
      teardown();
      setError(describeMediaError(cause, 'microphone'));
    }
  }, [finish, maxSeconds, microphoneId, teardown]);

  const reset = useCallback(() => {
    teardown();
    chunksRef.current = [];
    setResult(null);
    setSeconds(0);
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  return { recording, seconds, level, result, error, start, stop: finish, reset };
}
