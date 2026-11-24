import type {
  Avatar,
  AvatarDetail,
  FaceGeneratorStatus,
  Point3,
  Recording,
  StudioSessionRecord,
  StudioSettings,
  SystemStatus,
  Voice,
  VirtualCameraStatus,
} from '@/lib/types';

/** Client for the local Python engine (FastAPI on 127.0.0.1). Nothing here talks to the internet. */

interface EngineConfig {
  baseUrl: string;
  token: string;
}

let configPromise: Promise<EngineConfig> | null = null;

export function engineConfig(): Promise<EngineConfig> {
  configPromise ??= (async () => {
    const fromShell = await window.avc?.getEngineConfig().catch(() => null);
    if (fromShell) return fromShell;
    return {
      baseUrl: import.meta.env.VITE_ENGINE_URL ?? 'http://127.0.0.1:8765',
      token: import.meta.env.VITE_ENGINE_TOKEN ?? '',
    };
  })();
  return configPromise;
}

export class EngineError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { baseUrl, token } = await engineConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api${path}`, {
      ...init,
      headers: { 'X-AVS-Token': token, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new EngineError('The AI engine is not running. It starts with the app; check Settings → Engine.', 0);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body.detail === 'string') message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: { msg: string }) => d.msg).join('; ');
    } catch { /* not JSON */ }
    throw new EngineError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? response.json() : response.blob()) as Promise<T>;
}

const json = (body: unknown) => JSON.stringify(body);

/** URL for media elements (they cannot send headers, so the token travels as a query parameter). */
export async function mediaUrl(path: string, cacheKey?: string | number, extra: Record<string, string> = {}) {
  const { baseUrl, token } = await engineConfig();
  const params = new URLSearchParams({ ...extra, token });
  if (cacheKey !== undefined) params.set('v', String(cacheKey));
  return `${baseUrl}/api${path}?${params}`;
}

export async function websocketUrl(path: string) {
  const { baseUrl, token } = await engineConfig();
  return `${baseUrl.replace(/^http/, 'ws')}${path}?token=${encodeURIComponent(token)}`;
}

export const engine = {
  health: async () => {
    const { baseUrl } = await engineConfig();
    const response = await fetch(`${baseUrl}/health`);
    return response.ok;
  },
  status: () => request<SystemStatus>('/system/status'),
  downloadModels: () => request<{ state: string }>('/system/models/download', { method: 'POST' }),
  benchmark: () => request<SystemStatus['benchmark']>('/system/benchmark', { method: 'POST' }),

  settings: () => request<StudioSettings>('/settings'),
  updateSettings: (values: Partial<StudioSettings>) => request<StudioSettings>('/settings', { method: 'PATCH', body: json({ values }) }),

  avatars: () => request<Avatar[]>('/avatars'),
  avatar: (id: string) => request<AvatarDetail>(`/avatars/${id}`),
  uploadAvatar: (file: File, consent: { subject: string; relation: 'self' | 'authorised' }, name?: string) => {
    const form = new FormData();
    form.append('file', file);
    if (name) form.append('name', name);
    form.append('consent_subject', consent.subject);
    form.append('consent_relation', consent.relation);
    form.append('consent_confirmed', 'true');
    return request<Avatar>('/avatars', { method: 'POST', body: form });
  },
  replaceAvatarImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    form.append('consent_confirmed', 'true');
    return request<Avatar>(`/avatars/${id}/image`, { method: 'PUT', body: form });
  },
  authoriseAvatar: (id: string, consent: { subject: string; relation: 'self' | 'authorised' }) =>
    request<Avatar>(`/avatars/${id}/authorisation`, { method: 'PUT', body: json({ consent_subject: consent.subject, consent_relation: consent.relation, consent_confirmed: true }) }),
  updateAvatar: (id: string, patch: { name?: string; favourite?: boolean }) => request<Avatar>(`/avatars/${id}`, { method: 'PATCH', body: json(patch) }),
  setAvatarLandmarks: (id: string, landmarks: Point3[] | null, compatibility: number, note: string) =>
    request<Avatar>(`/avatars/${id}/landmarks`, { method: 'PUT', body: json({ landmarks, compatibility, compatibility_note: note }) }),
  deleteAvatar: (id: string) => request<void>(`/avatars/${id}`, { method: 'DELETE' }),
  avatarImageUrl: (avatar: Pick<Avatar, 'id' | 'updated_at'>) => mediaUrl(`/avatars/${avatar.id}/image`, avatar.updated_at),

  voices: (kind?: 'library' | 'personal') => request<Voice[]>(`/voices${kind ? `?kind=${kind}` : ''}`),
  createVoice: (input: { file: Blob; filename: string; name: string; description: string; consentSubject: string; consentRelation: 'self' | 'authorised' }) => {
    const form = new FormData();
    form.append('file', input.file, input.filename);
    form.append('name', input.name);
    form.append('description', input.description);
    form.append('consent_subject', input.consentSubject);
    form.append('consent_relation', input.consentRelation);
    form.append('consent_confirmed', 'true');
    return request<Voice>('/voices', { method: 'POST', body: form });
  },
  replaceVoiceSample: (id: string, file: Blob, filename: string) => {
    const form = new FormData();
    form.append('file', file, filename);
    form.append('consent_confirmed', 'true');
    return request<Voice>(`/voices/${id}/sample`, { method: 'PUT', body: form });
  },
  updateVoice: (id: string, patch: { name?: string; description?: string; favourite?: boolean }) =>
    request<Voice>(`/voices/${id}`, { method: 'PATCH', body: json(patch) }),
  deleteVoice: (id: string) => request<void>(`/voices/${id}`, { method: 'DELETE' }),
  voicePreviewUrl: (voice: Pick<Voice, 'id'>, cacheKey?: string) => mediaUrl(`/voices/${voice.id}/preview`, cacheKey),
  voiceSampleUrl: (voice: Pick<Voice, 'id'>, cacheKey?: string) => mediaUrl(`/voices/${voice.id}/sample`, cacheKey),
  convertClip: (id: string, file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'clip.wav');
    return request<Blob>(`/voices/${id}/convert`, { method: 'POST', body: form });
  },
  sourceVoice: () => request<Voice | null>('/voices/source'),
  setSourceVoice: (file: Blob) => {
    const form = new FormData();
    form.append('file', file, 'calibration.wav');
    return request<Voice>('/voices/source', { method: 'PUT', body: form });
  },
  clearSourceVoice: () => request<void>('/voices/source', { method: 'DELETE' }),

  sessions: (limit = 10) => request<StudioSessionRecord[]>(`/sessions?limit=${limit}`),
  startSession: (avatarId: string | null, voiceId: string | null) =>
    request<StudioSessionRecord>('/sessions', { method: 'POST', body: json({ avatar_id: avatarId, voice_id: voiceId }) }),
  endSession: (id: string, stats: { duration_seconds: number; avg_latency_ms: number | null; avg_tracking_fps: number | null; voice_seconds: number; blocks_dropped: number }) =>
    request<StudioSessionRecord>(`/sessions/${id}/end`, { method: 'POST', body: json(stats) }),
  clearSessions: () => request<void>('/sessions', { method: 'DELETE' }),

  recordings: () => request<Recording[]>('/recordings'),
  recording: (id: string) => request<Recording>(`/recordings/${id}`),
  createRecording: (input: { mime_type: string; requested_format: 'mp4' | 'webm'; width: number; height: number; has_audio: boolean; avatar_name: string; voice_name: string }) =>
    request<Recording>('/recordings', { method: 'POST', body: json(input) }),
  appendRecordingChunk: (id: string, chunk: Blob) =>
    request<{ size_bytes: number }>(`/recordings/${id}/chunks`, { method: 'POST', body: chunk, headers: { 'Content-Type': 'application/octet-stream' } }),
  finishRecording: (id: string, durationSeconds: number) => request<Recording>(`/recordings/${id}/finish`, { method: 'POST', body: json({ duration_seconds: durationSeconds }) }),
  exportRecording: (id: string, format: 'mp4' | 'webm') => request<Recording>(`/recordings/${id}/export?format=${format}`, { method: 'POST' }),
  renameRecording: (id: string, name: string) => request<Recording>(`/recordings/${id}`, { method: 'PATCH', body: json({ name }) }),
  deleteRecording: (id: string) => request<void>(`/recordings/${id}`, { method: 'DELETE' }),
  recordingUrl: (recording: Pick<Recording, 'id' | 'size_bytes'>, format?: 'mp4' | 'webm') =>
    mediaUrl(`/recordings/${recording.id}/media`, recording.size_bytes, format ? { format } : {}),

  virtualCameraStatus: () => request<VirtualCameraStatus>('/virtual-camera/status'),
  faceStatus: () => request<FaceGeneratorStatus>('/face/status'),
  downloadFaceModel: () => request<FaceGeneratorStatus>('/face/download', { method: 'POST' }),
};
