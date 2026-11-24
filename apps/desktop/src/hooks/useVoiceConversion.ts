import { useCallback, useEffect, useRef, useState } from 'react';
import { createCaptureContext, describeMediaError, setContextSink } from '@/lib/audio';
import { websocketUrl } from '@/lib/engine';
import type { Visemes } from '@/lib/reenactment';

/**
 * Real-time speech-to-speech conversion: microphone → AudioWorklet → WebSocket → engine (OpenVoice V2)
 * → converted PCM + visemes → scheduled playback on the Web Audio clock.
 * Visemes share that clock, so the avatar's mouth follows exactly what is being heard.
 *
 * Converted audio goes to one bus that feeds: the monitor (your headphones), a recording tap and the
 * virtual microphone (an output device such as "CABLE Input" that call apps read as a microphone).
 * Taps are delayed by the output latency so they line up with the mouth, which is timed to what is heard.
 * The raw microphone is never connected to any output.
 */

export type ConversionStatus = 'idle' | 'connecting' | 'streaming' | 'error';

export interface ConversionOptions {
  voiceId: string;
  microphoneId: string | null;
  outputId: string | null;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  monitor: boolean;
  /** Output device that acts as the virtual microphone (null = off). */
  virtualMicId: string | null;
  /** Extra delay for the virtual microphone, to line up with the virtual camera in call apps. */
  virtualMicDelayMs: number;
}

interface VisemeSegment {
  start: number;
  hop: number;
  data: Float32Array; // n * 4
}

const HEADER_BYTES = 28;
const JITTER_SECONDS = 0.08;

export function useVoiceConversion() {
  const contextRef = useRef<AudioContext | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const recordTapRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const vmicRef = useRef<{ delay: DelayNode; element: HTMLAudioElement; baseDelay: number } | null>(null);
  const segmentsRef = useRef<VisemeSegment[]>([]);
  const latencyRef = useRef<number | null>(null);
  const latencySamplesRef = useRef<number[]>([]);
  const voicedSecondsRef = useRef(0);
  const droppedRef = useRef(0);
  const levelsRef = useRef({ input: 0, output: 0 });
  const [status, setStatus] = useState<ConversionStatus>('idle');
  const [mode, setMode] = useState<'live' | 'buffered' | null>(null);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [rtf, setRtf] = useState<number | null>(null);
  const [calibrated, setCalibrated] = useState(false);
  const [dropped, setDropped] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState({ input: 0, output: 0 });
  const [virtualMic, setVirtualMicState] = useState<{ deviceId: string; error: string | null } | null>(null);

  const stop = useCallback(() => {
    const socket = socketRef.current;
    if (socket) {
      try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'stop' })); } catch { /* closing */ }
      socket.onmessage = null;
      socket.onclose = null;
      socket.close();
    }
    socketRef.current = null;
    nodeRef.current?.port.close();
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    outputGainRef.current = null;
    recordTapRef.current = null;
    if (vmicRef.current) {
      vmicRef.current.element.pause();
      vmicRef.current.element.srcObject = null;
    }
    vmicRef.current = null;
    setVirtualMicState(null);
    segmentsRef.current = [];
    latencyRef.current = null;
    setStatus('idle');
    setMode(null);
    setLatencyMs(null);
    setLevels({ input: 0, output: 0 });
    setMutedState(false);
  }, []);

  /** Send the converted voice to an output device that call apps can use as a microphone. */
  const routeVirtualMic = useCallback(async (deviceId: string | null) => {
    const vmic = vmicRef.current;
    if (!vmic) return;
    if (!deviceId) {
      vmic.element.pause();
      setVirtualMicState(null);
      return;
    }
    try {
      const sinkable = vmic.element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
      if (!sinkable.setSinkId) throw new Error('Output device selection is not supported.');
      await sinkable.setSinkId(deviceId);
      await vmic.element.play();
      setVirtualMicState({ deviceId, error: null });
    } catch (cause) {
      vmic.element.pause();
      setVirtualMicState({ deviceId, error: cause instanceof Error ? cause.message : 'The virtual microphone device could not be opened.' });
    }
  }, []);

  const setVirtualMicDelay = useCallback((ms: number) => {
    const vmic = vmicRef.current;
    if (vmic) vmic.delay.delayTime.value = vmic.baseDelay + Math.max(0, Math.min(1000, ms)) / 1000;
  }, []);

  const start = useCallback(async (options: ConversionOptions) => {
    stop();
    setError(null);
    setStatus('connecting');
    latencySamplesRef.current = [];
    voicedSecondsRef.current = 0;
    droppedRef.current = 0;
    setDropped(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options.microphoneId ? { exact: options.microphoneId } : undefined,
          channelCount: 1,
          echoCancellation: options.echoCancellation,
          noiseSuppression: options.noiseSuppression,
          autoGainControl: false,
        },
        video: false,
      });
      streamRef.current = stream;
      const context = await createCaptureContext();
      contextRef.current = context;
      if (options.outputId) await setContextSink(context, options.outputId).catch(() => undefined);

      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, 'pcm-capture', { processorOptions: { mode: 'pcm16' }, numberOfOutputs: 1 });
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(node).connect(silent).connect(context.destination);
      nodeRef.current = node;

      // All converted audio → bus → monitor / recording tap / virtual microphone.
      const bus = context.createGain();
      const outputAnalyser = context.createAnalyser();
      outputAnalyser.fftSize = 512;
      bus.connect(outputAnalyser);
      const outputGain = context.createGain();
      outputGain.gain.value = options.monitor ? 1 : 0;
      bus.connect(outputGain).connect(context.destination);
      outputGainRef.current = outputGain;
      const baseDelay = Math.min(0.5, context.outputLatency || context.baseLatency || 0);
      const recordDelay = context.createDelay(1);
      recordDelay.delayTime.value = baseDelay;
      const recordTap = context.createMediaStreamDestination();
      bus.connect(recordDelay).connect(recordTap);
      recordTapRef.current = recordTap;
      const vmicDelay = context.createDelay(2);
      vmicDelay.delayTime.value = baseDelay + options.virtualMicDelayMs / 1000;
      const vmicTap = context.createMediaStreamDestination();
      bus.connect(vmicDelay).connect(vmicTap);
      const vmicElement = new Audio();
      vmicElement.srcObject = vmicTap.stream;
      vmicRef.current = { delay: vmicDelay, element: vmicElement, baseDelay };
      if (options.virtualMicId) await routeVirtualMic(options.virtualMicId);

      const socket = new WebSocket(await websocketUrl('/ws/convert'));
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;
      let firstFrame: number | null = null;
      let nextTime = 0;
      let outRate = 22050;
      const sampleRate = context.sampleRate;

      node.port.onmessage = (event: MessageEvent<{ pcm: Int16Array; startFrame: number; rms: number }>) => {
        levelsRef.current.input = Math.min(1, event.data.rms * 5);
        if (socket.readyState !== WebSocket.OPEN) return;
        if (firstFrame === null) firstFrame = event.data.startFrame;
        socket.send(event.data.pcm.buffer);
      };

      const outSamples = new Float32Array(512);
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          const message = JSON.parse(event.data);
          if (message.type === 'ready') {
            outRate = message.outputSampleRate;
            setMode(message.mode);
            setVoiceName(message.voiceName);
            setCalibrated(message.calibrated);
            setStatus('streaming');
          } else if (message.type === 'stats') {
            setRtf(message.rtf);
            setCalibrated(message.calibrated);
            droppedRef.current = message.droppedBlocks;
            setDropped(message.droppedBlocks);
          } else if (message.type === 'voice') {
            setVoiceName(message.voiceName);
          } else if (message.type === 'error') {
            setError(message.message);
            if (message.fatal !== false) setStatus('error');
          }
          return;
        }
        // Binary block: header + float32 audio + float32 visemes
        const buffer = event.data as ArrayBuffer;
        const view = new DataView(buffer);
        const inputEnd = view.getUint32(8, true);
        const samples = view.getUint32(16, true);
        const visemeCount = view.getUint16(20, true);
        const flags = view.getUint16(22, true);
        const hop = view.getFloat32(24, true);
        const audio = new Float32Array(buffer, HEADER_BYTES, samples);
        const visemes = new Float32Array(buffer, HEADER_BYTES + samples * 4, visemeCount * 4);
        const audioBuffer = context.createBuffer(1, samples, outRate);
        audioBuffer.copyToChannel(audio, 0);
        const now = context.currentTime;
        const startAt = nextTime < now + 0.01 ? now + JITTER_SECONDS : nextTime;
        const node2 = context.createBufferSource();
        node2.buffer = audioBuffer;
        node2.connect(bus);
        node2.start(startAt);
        nextTime = startAt + samples / outRate;
        if (flags & 1) voicedSecondsRef.current += samples / outRate;
        segmentsRef.current.push({ start: startAt, hop, data: visemes.slice() });
        while (segmentsRef.current.length > 32) segmentsRef.current.shift();
        if (firstFrame !== null) {
          const capturedAt = (firstFrame + inputEnd) / sampleRate;
          const heardAt = nextTime + (context.outputLatency || 0);
          const latency = (heardAt - capturedAt) * 1000;
          latencyRef.current = latencyRef.current === null ? latency : latencyRef.current * 0.7 + latency * 0.3;
          latencySamplesRef.current.push(latency);
          if (latencySamplesRef.current.length > 2000) latencySamplesRef.current.shift();
        }
      };
      socket.onopen = () => socket.send(JSON.stringify({ type: 'start', voiceId: options.voiceId, sampleRate }));
      socket.onclose = () => {
        if (socketRef.current === socket) {
          setStatus((current) => (current === 'error' ? current : 'error'));
          setError((current) => current ?? 'The connection to the AI engine closed.');
        }
      };

      // UI meters (~10 Hz)
      const tick = window.setInterval(() => {
        if (contextRef.current !== context) { window.clearInterval(tick); return; }
        outputAnalyser.getFloatTimeDomainData(outSamples);
        let sum = 0;
        for (const s of outSamples) sum += s * s;
        levelsRef.current.output = Math.min(1, Math.sqrt(sum / outSamples.length) * 5);
        setLevels({ ...levelsRef.current });
        setLatencyMs(latencyRef.current === null ? null : Math.round(latencyRef.current));
      }, 100);
    } catch (cause) {
      stop();
      setError(describeMediaError(cause, 'microphone'));
      setStatus('error');
    }
  }, [stop, routeVirtualMic]);

  /** Converted audio only (aligned with the avatar's mouth), for recording. Null when not converting. */
  const recordingStream = useCallback(() => recordTapRef.current?.stream ?? null, []);

  const switchVoice = useCallback((voiceId: string) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'voice', voiceId }));
  }, []);

  const setMuted = useCallback((value: boolean) => {
    nodeRef.current?.port.postMessage({ enabled: !value });
    setMutedState(value);
  }, []);

  const setMonitor = useCallback((value: boolean) => {
    if (outputGainRef.current) outputGainRef.current.gain.value = value ? 1 : 0;
  }, []);

  const setOutputDevice = useCallback(async (deviceId: string | null) => {
    if (contextRef.current) await setContextSink(contextRef.current, deviceId);
  }, []);

  /** Mouth shape for the audio currently being heard (null when nothing is playing). */
  const visemesNow = useCallback((): Visemes | null => {
    const context = contextRef.current;
    if (!context) return null;
    const stamp = context.getOutputTimestamp?.();
    const t = stamp?.contextTime ?? context.currentTime - (context.outputLatency || 0);
    for (const segment of segmentsRef.current) {
      const n = segment.data.length / 4;
      const offset = (t - segment.start) / segment.hop;
      if (offset >= 0 && offset < n) {
        const i = Math.floor(offset);
        const j = Math.min(n - 1, i + 1);
        const f = offset - i;
        const d = segment.data;
        const lerp = (c: number) => d[i * 4 + c] * (1 - f) + d[j * 4 + c] * f;
        return { jaw: lerp(0), round: lerp(1), wide: lerp(2), energy: lerp(3) };
      }
    }
    return { jaw: 0, round: 0, wide: 0, energy: 0 };
  }, []);

  const sessionStats = useCallback(() => {
    const samples = latencySamplesRef.current;
    return {
      avgLatencyMs: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
      voiceSeconds: voicedSecondsRef.current,
      droppedBlocks: droppedRef.current,
    };
  }, []);

  useEffect(() => stop, [stop]);

  return {
    status, mode, voiceName, latencyMs, rtf, calibrated, dropped, muted, error, levels,
    latencyRef, start, stop, switchVoice, setMuted, setMonitor, setOutputDevice, visemesNow, sessionStats,
    virtualMic, routeVirtualMic, setVirtualMicDelay, recordingStream,
  };
}
