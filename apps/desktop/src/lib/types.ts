export type Point3 = [number, number, number];

export interface Avatar {
  id: string;
  name: string;
  mime_type: string;
  width: number;
  height: number;
  has_landmarks: boolean;
  compatibility: number;
  compatibility_note: string;
  favourite: boolean;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  /** The user confirmed this is their own face or one they are authorised to animate. */
  authorised: boolean;
  consent_subject: string;
  consent_relation: string;
  consent_at: string | null;
}

export interface AvatarDetail extends Avatar {
  landmarks: Point3[] | null;
}

export type VoiceKind = 'library' | 'personal' | 'source';

export interface Voice {
  id: string;
  kind: VoiceKind;
  name: string;
  description: string;
  language: string;
  tags: string[];
  sample_seconds: number;
  favourite: boolean;
  has_sample: boolean;
  has_preview: boolean;
  ready: boolean;
  consent_subject: string;
  consent_relation: string;
  consent_at: string | null;
  source: string;
  created_at: string;
  last_used_at: string | null;
}

export interface StudioSessionRecord {
  id: string;
  avatar_id: string | null;
  voice_id: string | null;
  avatar_name: string;
  voice_name: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number;
  avg_latency_ms: number | null;
  avg_tracking_fps: number | null;
  voice_seconds: number;
  blocks_dropped: number;
}

export type RequirementStatus = 'ok' | 'warn' | 'fail';

export interface Requirement {
  id: string;
  label: string;
  status: RequirementStatus;
  detail: string;
}

export interface SystemStatus {
  engine_version: string;
  model_state: 'missing' | 'downloading' | 'loading' | 'ready' | 'error';
  model_detail: string;
  download_progress: number;
  device: string;
  torch_threads: number;
  hardware: {
    os: string;
    cpu: string;
    logical_cores: number;
    ram_gb: number;
    cuda: boolean;
    gpu: string | null;
    torch: string;
    python: string;
  };
  benchmark: { rtf: number; window_seconds: number; device: string; threads: number; measured_at: number } | null;
  requirements: Requirement[];
  source_voice_ready: boolean;
}

export type LipSyncMode = 'webcam' | 'audio' | 'hybrid';

export interface StudioSettings {
  camera_device_id: string | null;
  camera_resolution: '480p' | '720p' | '1080p';
  microphone_device_id: string | null;
  audio_output_device_id: string | null;
  mirror_preview: boolean;
  mirror_avatar: boolean;
  smoothing: number;
  expression_gain: number;
  head_motion_gain: number;
  lip_sync_mode: LipSyncMode;
  sync_video_to_voice: boolean;
  noise_suppression: boolean;
  echo_cancellation: boolean;
  monitor_converted_voice: boolean;
  selected_avatar_id: string | null;
  selected_voice_id: string | null;
  block_ms_override: number;
  preserve_background: boolean;
  animation_engine: 'mesh' | 'neural';
  output_resolution: OutputResolution;
  output_fps: number;
  output_framing: 'fill' | 'fit';
  virtual_camera_backend: 'auto' | 'obs' | 'unitycapture';
  virtual_camera_autostart: boolean;
  virtual_mic_device_id: string | null;
  virtual_mic_delay_ms: number;
  recording_format: 'mp4' | 'webm';
  recording_quality: 'standard' | 'high';
}

export interface FaceGeneratorStatus {
  weights: boolean;
  state: 'missing' | 'unloaded' | 'downloading' | 'loading' | 'ready' | 'error';
  detail: string;
  device: string;
  cuda: boolean;
  gpu: string | null;
  last_ms: number | null;
  frames: number;
}

export type OutputResolution = '360p' | '540p' | '720p' | '1080p';

export interface Recording {
  id: string;
  name: string;
  status: 'recording' | 'processing' | 'ready' | 'failed' | 'interrupted';
  status_detail: string;
  format: 'mp4' | 'webm';
  requested_format: 'mp4' | 'webm';
  available_formats: ('mp4' | 'webm')[];
  duration_seconds: number;
  size_bytes: number;
  width: number;
  height: number;
  has_audio: boolean;
  avatar_name: string;
  voice_name: string;
  created_at: string;
  finished_at: string | null;
}

export interface VirtualCameraBackend {
  id: 'obs' | 'unitycapture';
  label: string;
  installed: boolean;
  usable: boolean;
}

export interface VirtualCameraStatus {
  platform_supported: boolean;
  backends: VirtualCameraBackend[];
  active: boolean;
  backend: string | null;
  device: string | null;
  width: number;
  height: number;
  fps: number;
  frames_received: number;
  frames_sent: number;
  input_fps: number;
  output_fps: number;
  last_error: string;
}
