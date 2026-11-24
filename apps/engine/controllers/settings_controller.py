"""Persisted user preferences (JSON values in the ``app_settings`` table)."""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.orm import Session

from models import AppSetting

DEFAULTS: dict[str, Any] = {
    "camera_device_id": None,
    "camera_resolution": "720p",
    "microphone_device_id": None,
    "audio_output_device_id": None,
    "mirror_preview": True,
    "mirror_avatar": False,
    "smoothing": 0.5,
    "expression_gain": 1.0,
    "head_motion_gain": 0.85,
    "lip_sync_mode": "hybrid",  # webcam | audio | hybrid
    "sync_video_to_voice": True,
    "noise_suppression": True,
    "echo_cancellation": True,
    "monitor_converted_voice": True,
    "selected_avatar_id": None,
    "selected_voice_id": None,
    "block_ms_override": 0,
    # Background: keep the portrait's original background static and move only the subject.
    "preserve_background": True,
    # Animation engine: mesh (WebGL, any PC) | neural (LivePortrait, needs a CUDA GPU for live use)
    "animation_engine": "mesh",
    # Final output (virtual camera and recordings)
    "output_resolution": "720p",  # 360p | 540p | 720p | 1080p
    "output_fps": 30,
    "output_framing": "fill",  # fill (crop to 16:9 around the face) | fit (whole picture)
    "virtual_camera_backend": "auto",  # auto | obs | unitycapture
    "virtual_camera_autostart": False,
    # Virtual microphone: the output device the converted voice is sent to (e.g. "CABLE Input").
    "virtual_mic_device_id": None,
    "virtual_mic_delay_ms": 0,
    "recording_format": "mp4",  # mp4 | webm
    "recording_quality": "standard",  # standard | high
}
_CHOICES: dict[str, set[Any]] = {
    "output_resolution": {"360p", "540p", "720p", "1080p"},
    "output_framing": {"fill", "fit"},
    "animation_engine": {"mesh", "neural"},
    "virtual_camera_backend": {"auto", "obs", "unitycapture"},
    "recording_format": {"mp4", "webm"},
    "recording_quality": {"standard", "high"},
    "camera_resolution": {"480p", "720p", "1080p"},
    "lip_sync_mode": {"webcam", "audio", "hybrid"},
}
_RANGES: dict[str, tuple[float, float]] = {"output_fps": (10, 60), "virtual_mic_delay_ms": (0, 1000)}
_PRIVATE_KEYS = {"benchmark"}


def get_value(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return DEFAULTS.get(key, default)
    return json.loads(row.value_json)


def set_value(db: Session, key: str, value: Any) -> None:
    row = db.get(AppSetting, key)
    encoded = json.dumps(value)
    if row is None:
        db.add(AppSetting(key=key, value_json=encoded))
    else:
        row.value_json = encoded
    db.commit()


def get_all(db: Session) -> dict[str, Any]:
    values = dict(DEFAULTS)
    for row in db.query(AppSetting).all():
        if row.key in DEFAULTS:
            values[row.key] = json.loads(row.value_json)
    return values


def update(db: Session, patch: dict[str, Any]) -> dict[str, Any]:
    unknown = set(patch) - set(DEFAULTS)
    if unknown or set(patch) & _PRIVATE_KEYS:
        raise ValueError(f"Unknown settings: {', '.join(sorted(unknown))}")
    for key, value in patch.items():
        expected = DEFAULTS[key]
        if expected is not None and value is not None and not isinstance(value, type(expected)):
            if not (isinstance(expected, float) and isinstance(value, int)):
                raise ValueError(f"Setting {key} must be {type(expected).__name__}.")
        if key in _CHOICES and value not in _CHOICES[key]:
            raise ValueError(f"Setting {key} must be one of: {', '.join(sorted(map(str, _CHOICES[key])))}.")
        if key in _RANGES and not (_RANGES[key][0] <= value <= _RANGES[key][1]):
            raise ValueError(f"Setting {key} must be between {_RANGES[key][0]:g} and {_RANGES[key][1]:g}.")
    for key, value in patch.items():
        set_value(db, key, value)
    return get_all(db)
