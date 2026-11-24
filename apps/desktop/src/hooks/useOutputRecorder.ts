import { useCallback, useEffect, useRef, useState } from 'react';
import { engine } from '@/lib/engine';
import type { Recording } from '@/lib/types';

/**
 * Records the studio's final output: the composed avatar frame (same canvas as the virtual camera) plus
 * the converted voice. The raw webcam and raw microphone are never part of the recording.
 *
 * Chunks (1 s) are streamed to the engine while recording, so long calls do not accumulate in memory and a
 * crash keeps everything up to the last second. The engine remuxes or transcodes on finish (ffmpeg).
 */

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'finishing';

const MP4_TYPES = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'];
// VP8 is the cheapest encoder on CPUs without hardware VP9; H.264-in-WebM uses hardware encoders where present.
const WEBM_TYPES = ['video/webm;codecs=h264,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

/** Best container the recorder supports for the requested export format. */
export function pickMimeType(format: 'mp4' | 'webm', supported: (type: string) => boolean = (t) => MediaRecorder.isTypeSupported(t)) {
  const order = format === 'mp4' ? [...MP4_TYPES, ...WEBM_TYPES] : [...WEBM_TYPES, ...MP4_TYPES];
  return order.find((type) => supported(type)) ?? null;
}

export interface RecordingSources {
  canvas: HTMLCanvasElement;
  fps: number;
  format: 'mp4' | 'webm';
  quality: 'standard' | 'high';
  avatarName: string;
  voiceName: string;
}

export function useOutputRecorder() {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const voiceSourceRef = useRef<{ stream: MediaStream; node: MediaStreamAudioSourceNode } | null>(null);
  const recordingIdRef = useRef<string | null>(null);
  const uploadsRef = useRef<Promise<unknown>>(Promise.resolve());
  const activeMsRef = useRef(0);
  const resumedAtRef = useRef<number | null>(null);
  const uploadErrorRef = useRef<string | null>(null);
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<Recording | null>(null);

  const elapsed = useCallback(() => activeMsRef.current + (resumedAtRef.current !== null ? performance.now() - resumedAtRef.current : 0), []);

  useEffect(() => {
    if (state !== 'recording' && state !== 'paused') return;
    const timer = window.setInterval(() => setSeconds(elapsed() / 1000), 250);
    return () => window.clearInterval(timer);
  }, [elapsed, state]);

  /** Connect (or replace) the converted-voice stream; null records silence. Safe to call at any time. */
  const attachVoice = useCallback((stream: MediaStream | null) => {
    const context = contextRef.current;
    const destination = destinationRef.current;
    const current = voiceSourceRef.current;
    if (current && current.stream === stream) return;
    current?.node.disconnect();
    voiceSourceRef.current = null;
    if (!context || !destination || !stream || !stream.getAudioTracks().length) return;
    const node = context.createMediaStreamSource(stream);
    node.connect(destination);
    voiceSourceRef.current = { stream, node };
  }, []);

  const cleanup = useCallback(() => {
    voiceSourceRef.current?.node.disconnect();
    voiceSourceRef.current = null;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = null;
    destinationRef.current = null;
    recorderRef.current = null;
    resumedAtRef.current = null;
  }, []);

  const start = useCallback(async (sources: RecordingSources, voice: MediaStream | null) => {
    if (recorderRef.current) return;
    setError(null);
    setState('starting');
    uploadErrorRef.current = null;
    try {
      const mimeType = pickMimeType(sources.format);
      if (!mimeType) throw new Error('This system cannot record video.');
      const context = new AudioContext({ latencyHint: 'interactive' });
      await context.resume();
      const destination = context.createMediaStreamDestination();
      contextRef.current = context;
      destinationRef.current = destination;
      attachVoice(voice);
      const video = sources.canvas.captureStream(sources.fps).getVideoTracks();
      const stream = new MediaStream([...video, ...destination.stream.getAudioTracks()]);
      const pixels = sources.canvas.width * sources.canvas.height;
      const bitsPerPixel = sources.quality === 'high' ? 0.12 : 0.07;
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: Math.round(pixels * sources.fps * bitsPerPixel),
        audioBitsPerSecond: 160_000,
      });
      const created = await engine.createRecording({
        mime_type: mimeType.replace(/"/g, ''),
        requested_format: sources.format,
        width: sources.canvas.width,
        height: sources.canvas.height,
        has_audio: true,
        avatar_name: sources.avatarName.slice(0, 80),
        voice_name: sources.voiceName.slice(0, 80),
      });
      recordingIdRef.current = created.id;
      uploadsRef.current = Promise.resolve();
      recorder.ondataavailable = (event) => {
        if (!event.data.size || !recordingIdRef.current) return;
        const id = recordingIdRef.current;
        // Chunks must arrive in order: chain the uploads.
        uploadsRef.current = uploadsRef.current
          .then(() => engine.appendRecordingChunk(id, event.data))
          .catch((cause: unknown) => {
            uploadErrorRef.current = cause instanceof Error ? cause.message : 'A part of the recording could not be saved.';
          });
      };
      recorder.onerror = () => setError('The recorder stopped unexpectedly.');
      recorderRef.current = recorder;
      activeMsRef.current = 0;
      resumedAtRef.current = performance.now();
      setSeconds(0);
      recorder.start(1000);
      setState('recording');
    } catch (cause) {
      cleanup();
      setState('idle');
      setError(cause instanceof Error ? cause.message : 'Recording could not start.');
    }
  }, [attachVoice, cleanup]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    if (resumedAtRef.current !== null) activeMsRef.current += performance.now() - resumedAtRef.current;
    resumedAtRef.current = null;
    setState('paused');
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    recorder.resume();
    resumedAtRef.current = performance.now();
    setState('recording');
  }, []);

  /** Stop and hand the file to the engine for finishing. Resolves with the recording (status "processing"). */
  const stop = useCallback(async (): Promise<Recording | null> => {
    const recorder = recorderRef.current;
    const id = recordingIdRef.current;
    if (!recorder || !id) return null;
    setState('finishing');
    const durationSeconds = elapsed() / 1000;
    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve();
    });
    recorder.stream.getTracks().forEach((t) => t.stop());
    // ondataavailable for the final chunk fires before 'stop'; wait for the chained uploads.
    await uploadsRef.current;
    cleanup();
    recordingIdRef.current = null;
    try {
      const finished = await engine.finishRecording(id, durationSeconds);
      setLast(finished);
      if (uploadErrorRef.current) setError(`Saved with gaps: ${uploadErrorRef.current}`);
      return finished;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The recording could not be finished.');
      return null;
    } finally {
      setState('idle');
      setSeconds(0);
    }
  }, [cleanup, elapsed]);

  // Leaving the studio while recording still saves what was recorded.
  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => { void stopRef.current(); }, []);

  return { state, seconds, error, last, start, pause, resume, stop, attachVoice };
}
