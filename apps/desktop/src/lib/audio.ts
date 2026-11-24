/** Shared audio helpers: worklet loading, WAV encoding, output-device routing. */

export function workletUrl() {
  return new URL('worklets/pcm-capture.js', document.baseURI).href;
}

export async function createCaptureContext() {
  const context = new AudioContext({ latencyHint: 'interactive' });
  await context.audioWorklet.addModule(workletUrl());
  await context.resume();
  return context;
}

export function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  write(0, 'RIFF');
  view.setUint32(4, 36 + length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

type SinkCapable = { setSinkId?: (id: string | { type: 'none' }) => Promise<void> };

/** Routes an AudioContext to a chosen output device (Chromium 110+). */
export async function setContextSink(context: AudioContext, deviceId: string | null) {
  const sinkable = context as AudioContext & SinkCapable;
  if (!sinkable.setSinkId) return false;
  await sinkable.setSinkId(deviceId ?? '');
  return true;
}

export async function setElementSink(element: HTMLMediaElement, deviceId: string | null) {
  const sinkable = element as HTMLMediaElement & SinkCapable;
  if (!sinkable.setSinkId || !deviceId) return false;
  await sinkable.setSinkId(deviceId);
  return true;
}

export function describeMediaError(cause: unknown, device: 'camera' | 'microphone') {
  const name = cause instanceof DOMException ? cause.name : '';
  if (name === 'NotAllowedError') return `${device === 'camera' ? 'Camera' : 'Microphone'} access was blocked. Allow it in Windows Settings → Privacy & security, then try again.`;
  if (name === 'NotFoundError') return `No ${device} was found. Connect one and try again.`;
  if (name === 'NotReadableError') return `The ${device} is being used by another app. Close it and try again.`;
  if (name === 'OverconstrainedError') return `The selected ${device} does not support this mode. Choose another device.`;
  return cause instanceof Error ? cause.message : `The ${device} could not start.`;
}

/** Output-device labels that look like virtual audio cables (a call app can read what we play there as a mic). */
export function looksLikeVirtualCable(label: string) {
  return /cable|vb-audio|voicemeeter|virtual|\bvac\b|blackhole/i.test(label);
}
