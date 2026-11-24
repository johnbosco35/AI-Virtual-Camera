"""Pydantic request/response shapes shared by routes and controllers."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class AvatarOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    mime_type: str
    width: int
    height: int
    has_landmarks: bool
    compatibility: float
    compatibility_note: str
    favourite: bool
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None
    # True once the user confirmed this is their own likeness or one they are authorised to use.
    authorised: bool
    consent_subject: str
    consent_relation: str
    consent_at: datetime | None


class AvatarDetailOut(AvatarOut):
    landmarks: list[list[float]] | None


class AvatarPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    favourite: bool | None = None


class AvatarAuthorisationIn(BaseModel):
    consent_subject: str = Field(min_length=1, max_length=120)
    consent_relation: Literal["self", "authorised"]
    consent_confirmed: bool


class AvatarLandmarksIn(BaseModel):
    """Landmarks detected in the renderer (MediaPipe IMAGE mode) for this portrait."""

    landmarks: list[list[float]] | None = Field(default=None, max_length=500)
    compatibility: float = Field(ge=0, le=1)
    compatibility_note: str = Field(default="", max_length=200)


class VoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    name: str
    description: str
    language: str
    tags: list[str]
    sample_seconds: float
    favourite: bool
    has_sample: bool
    has_preview: bool
    ready: bool
    consent_subject: str
    consent_relation: str
    consent_at: datetime | None
    source: str
    created_at: datetime
    last_used_at: datetime | None


class VoicePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=400)
    favourite: bool | None = None


class SessionStartIn(BaseModel):
    avatar_id: str | None = None
    voice_id: str | None = None


class SessionEndIn(BaseModel):
    duration_seconds: float = Field(ge=0, le=86400)
    avg_latency_ms: float | None = Field(default=None, ge=0, le=60000)
    avg_tracking_fps: float | None = Field(default=None, ge=0, le=240)
    voice_seconds: float = Field(default=0, ge=0, le=86400)
    blocks_dropped: int = Field(default=0, ge=0)


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    avatar_id: str | None
    voice_id: str | None
    avatar_name: str
    voice_name: str
    started_at: datetime
    ended_at: datetime | None
    duration_seconds: float
    avg_latency_ms: float | None
    avg_tracking_fps: float | None
    voice_seconds: float
    blocks_dropped: int


class SettingsPatch(BaseModel):
    values: dict[str, Any]


ModelState = Literal["missing", "downloading", "loading", "ready", "error"]


class SystemStatus(BaseModel):
    engine_version: str
    model_state: ModelState
    model_detail: str
    download_progress: float
    device: str
    torch_threads: int
    hardware: dict[str, Any]
    benchmark: dict[str, Any] | None
    requirements: list[dict[str, Any]]
    source_voice_ready: bool


RecordingFormat = Literal["mp4", "webm"]


class RecordingCreateIn(BaseModel):
    name: str = Field(default="", max_length=120)
    mime_type: str = Field(min_length=5, max_length=80, pattern=r"^video/(webm|mp4)(;[a-zA-Z0-9=.,\- ]*)?$")
    requested_format: RecordingFormat = "mp4"
    width: int = Field(default=0, ge=0, le=7680)
    height: int = Field(default=0, ge=0, le=4320)
    has_audio: bool = True
    avatar_name: str = Field(default="", max_length=80)
    voice_name: str = Field(default="", max_length=80)


class RecordingFinishIn(BaseModel):
    duration_seconds: float = Field(ge=0, le=86400)


class RecordingPatch(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    status: str
    status_detail: str
    format: str
    requested_format: str
    available_formats: list[str]
    duration_seconds: float
    size_bytes: int
    width: int
    height: int
    has_audio: bool
    avatar_name: str
    voice_name: str
    created_at: datetime
    finished_at: datetime | None


class VirtualCameraStatus(BaseModel):
    platform_supported: bool
    backends: list[dict[str, Any]]
    active: bool
    backend: str | None
    device: str | None
    width: int
    height: int
    fps: float
    frames_received: int
    frames_sent: int
    input_fps: float
    output_fps: float
    last_error: str
