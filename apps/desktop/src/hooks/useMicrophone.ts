import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/store/appStore';

function describeMicrophoneError(cause: unknown) {
  if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
    return 'Microphone access was blocked. Allow microphone access in Windows privacy settings.';
  }
  if (cause instanceof DOMException && cause.name === 'NotFoundError') {
    return 'No microphone was found. Connect a microphone and try again.';
  }
  return cause instanceof Error ? cause.message : 'The microphone could not be started.';
}

export function useMicrophone() {
  const microphoneDeviceId = useAppStore((state) => state.microphoneDeviceId);
  const audioOutputDeviceId = useAppStore((state) => state.audioOutputDeviceId);
  const setMicrophoneDeviceId = useAppStore((state) => state.setMicrophoneDeviceId);
  const setAudioOutputDeviceId = useAppStore((state) => state.setAudioOutputDeviceId);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const routedStreamRef = useRef<MediaStream | null>(null);
  const requestIdRef = useRef(0);
  const animationFrameRef = useRef(0);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [active, setActive] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    setInputs(devices.filter((device) => device.kind === 'audioinput'));
    setOutputs(devices.filter((device) => device.kind === 'audiooutput'));
  }, []);

  const stopRouting = useCallback(() => {
    const element = audioElementRef.current;
    if (element) {
      element.pause();
      element.srcObject = null;
    }
    routedStreamRef.current?.getTracks().forEach((track) => track.stop());
    routedStreamRef.current = null;
    audioElementRef.current = null;
    setRouting(false);
  }, []);

  const stop = useCallback(() => {
    requestIdRef.current += 1;
    cancelAnimationFrame(animationFrameRef.current);
    stopRouting();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setLevel(0);
    setActive(false);
    setMuted(false);
  }, [stopRouting]);

  const start = useCallback(async () => {
    if (streamRef.current?.active) return streamRef.current;
    const requestId = ++requestIdRef.current;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: microphoneDeviceId ? { exact: microphoneDeviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }
      streamRef.current = stream;
      const context = new AudioContext();
      await context.resume();
      if (requestId !== requestIdRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        await context.close();
        return null;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      audioContextRef.current = context;
      const samples = new Float32Array(analyser.fftSize);
      let previousLevel = -1;
      const measure = () => {
        if (!stream.active) return;
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        const nextLevel = Math.min(1, rms * 4);
        if (Math.abs(nextLevel - previousLevel) >= 0.015) {
          previousLevel = nextLevel;
          setLevel(nextLevel);
        }
        animationFrameRef.current = requestAnimationFrame(measure);
      };
      animationFrameRef.current = requestAnimationFrame(measure);
      setActive(true);
      setMuted(false);
      await refreshDevices();
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (requestId === requestIdRef.current) stop();
      }, { once: true });
      return stream;
    } catch (cause) {
      if (requestId !== requestIdRef.current) return null;
      stop();
      const message = describeMicrophoneError(cause);
      setError(message);
      throw new Error(message);
    }
  }, [microphoneDeviceId, refreshDevices, stop]);

  const setMutedState = useCallback((nextMuted: boolean) => {
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    routedStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
    setMuted(nextMuted);
  }, []);

  const routeToSelectedOutput = useCallback(async () => {
    if (!audioOutputDeviceId) throw new Error('Choose a virtual audio cable output first.');
    stopRouting();
    const stream = await start();
    if (!stream) throw new Error('Microphone start was canceled.');
    const element = new Audio();
    const routedStream = new MediaStream(stream.getAudioTracks().map((track) => {
      const clone = track.clone();
      clone.enabled = !muted;
      return clone;
    }));
    routedStreamRef.current = routedStream;
    element.srcObject = routedStream;
    const output = element as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
    if (!output.setSinkId) {
      stopRouting();
      throw new Error('This desktop runtime cannot select an audio output device.');
    }
    try {
      await output.setSinkId(audioOutputDeviceId);
      await output.play();
      audioElementRef.current = element;
      setRouting(true);
    } catch (cause) {
      stopRouting();
      throw new Error(describeMicrophoneError(cause));
    }
  }, [audioOutputDeviceId, muted, start, stopRouting]);

  useEffect(() => {
    void refreshDevices().catch((cause: unknown) => setError(describeMicrophoneError(cause)));
    const onDeviceChange = () => {
      void refreshDevices().catch((cause: unknown) => setError(describeMicrophoneError(cause)));
    };
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
      stop();
    };
  }, [refreshDevices, stop]);

  return {
    inputs,
    outputs,
    microphoneDeviceId,
    audioOutputDeviceId,
    setMicrophoneDeviceId,
    setAudioOutputDeviceId,
    active,
    muted,
    level,
    routing,
    error,
    start,
    stop,
    setMuted: setMutedState,
    routeToSelectedOutput,
    stopRouting,
  };
}
