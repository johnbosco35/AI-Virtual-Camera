"""Recordings of the studio's final output (animated avatar + converted voice).

The renderer records with MediaRecorder and streams chunks here while recording, so a long session never
has to fit in memory and an app crash leaves a usable partial file. On finish the file is post-processed
with ffmpeg in the background:

* WebM from MediaRecorder has no duration or seek index -> remuxed (stream copy, fast).
* MP4 requested but the recorder could only produce WebM -> transcoded to H.264 + AAC.
* MP4 produced natively by the recorder -> remuxed with ``+faststart`` so it plays while downloading.

Exports to the other container reuse the same transcoder and are kept next to the original.
"""
from __future__ import annotations

import logging
import subprocess
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, Request, status
from sqlalchemy.orm import Session

from config.database import SessionLocal
from config.settings import get_settings
from models import Recording
from models.ai.audio_io import _ffmpeg_exe
from models.schemas import RecordingCreateIn, RecordingFinishIn, RecordingOut, RecordingPatch

log = logging.getLogger("engine.recordings")
FORMATS = ("mp4", "webm")
_jobs_lock = threading.Lock()
_jobs: set[str] = set()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dir() -> Path:
    path = get_settings().recordings_dir
    path.mkdir(parents=True, exist_ok=True)
    return path


def raw_path(recording_id: str) -> Path:
    return _dir() / f"{recording_id}.part"


def file_path(recording_id: str, fmt: str) -> Path:
    if fmt not in FORMATS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Format must be mp4 or webm.")
    return _dir() / f"{recording_id}.{fmt}"


def _available(recording: Recording) -> list[str]:
    return [fmt for fmt in FORMATS if file_path(recording.id, fmt).exists()] if recording.status == "ready" else []


def to_out(recording: Recording) -> RecordingOut:
    return RecordingOut(
        id=recording.id, name=recording.name, status=recording.status, status_detail=recording.status_detail,
        format=recording.format, requested_format=recording.requested_format, available_formats=_available(recording),
        duration_seconds=recording.duration_seconds, size_bytes=recording.size_bytes, width=recording.width,
        height=recording.height, has_audio=bool(recording.has_audio), avatar_name=recording.avatar_name,
        voice_name=recording.voice_name, created_at=recording.created_at, finished_at=recording.finished_at,
    )


def get_recording(db: Session, recording_id: str) -> Recording:
    recording = db.get(Recording, recording_id)
    if recording is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found.")
    return recording


def list_recordings(db: Session) -> list[RecordingOut]:
    return [to_out(r) for r in db.query(Recording).order_by(Recording.created_at.desc()).all()]


def create(db: Session, body: RecordingCreateIn) -> RecordingOut:
    source = "mp4" if body.mime_type.startswith("video/mp4") else "webm"
    name = body.name.strip() or f"Recording {_now().astimezone().strftime('%Y-%m-%d %H:%M')}"
    row = Recording(
        name=name, format=source, source_mime=body.mime_type, requested_format=body.requested_format,
        width=body.width, height=body.height, has_audio=int(body.has_audio),
        avatar_name=body.avatar_name, voice_name=body.voice_name, status="recording",
    )
    db.add(row)
    db.commit()
    raw_path(row.id).write_bytes(b"")
    return to_out(row)


async def append_chunk(db: Session, recording_id: str, request: Request) -> dict:
    settings = get_settings()
    recording = get_recording(db, recording_id)
    if recording.status != "recording":
        raise HTTPException(status.HTTP_409_CONFLICT, "This recording is already finished.")
    path = raw_path(recording_id)
    written = 0
    with path.open("ab") as out:
        async for piece in request.stream():
            written += len(piece)
            if written > settings.max_recording_chunk_bytes:
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Recording chunk too large.")
            out.write(piece)
    size = path.stat().st_size
    if size > settings.max_recording_bytes:
        recording.status, recording.status_detail = "failed", "The recording exceeded the maximum size."
        db.commit()
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, recording.status_detail)
    recording.size_bytes = size
    db.commit()
    return {"size_bytes": size}


def _run_ffmpeg(args: list[str]) -> None:
    result = subprocess.run(
        [_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True, text=True, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or "ffmpeg failed").strip().splitlines()[-1][:280])


def _convert(source: Path, target: Path, target_fmt: str, source_fmt: str) -> None:
    """Remux when the container already matches, otherwise transcode."""
    tmp = target.with_name(target.stem + ".tmp." + target_fmt)
    if source_fmt == target_fmt:
        extra = ["-movflags", "+faststart"] if target_fmt == "mp4" else []
        _run_ffmpeg(["-fflags", "+genpts", "-i", str(source), "-map", "0", "-c", "copy", *extra, "-f", target_fmt, str(tmp)])
    elif target_fmt == "mp4":
        _run_ffmpeg([
            "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-f", "mp4", str(tmp),
        ])
    else:
        _run_ffmpeg([
            "-i", str(source), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8",
            "-b:v", "3M", "-c:a", "libopus", "-b:a", "128k", "-f", "webm", str(tmp),
        ])
    tmp.replace(target)


def _probe_duration(path: Path) -> float | None:
    """Duration from ffmpeg's own report (ffprobe is not bundled)."""
    result = subprocess.run(
        [_ffmpeg_exe(), "-hide_banner", "-i", str(path)], capture_output=True, text=True,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    for line in result.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:") and "N/A" not in line.split(",")[0]:
            h, m, s = line.split(",")[0].split()[1].split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return None


def _job(recording_id: str, target_fmt: str, finalize: bool) -> None:
    with SessionLocal() as db:
        recording = db.get(Recording, recording_id)
        if recording is None:
            return
        try:
            if finalize:
                source, source_fmt = raw_path(recording_id), recording.format
            else:
                source_fmt = recording.format
                source = file_path(recording_id, source_fmt)
            target = file_path(recording_id, target_fmt)
            _convert(source, target, target_fmt, source_fmt)
            if finalize:
                # Keep the recorder's own container too when it differs (no quality loss, instant export).
                if target_fmt != source_fmt:
                    _convert(source, file_path(recording_id, source_fmt), source_fmt, source_fmt)
                source.unlink(missing_ok=True)
                recording.format = target_fmt
                probed = _probe_duration(target)
                if probed:
                    recording.duration_seconds = probed
            recording.size_bytes = file_path(recording_id, recording.format).stat().st_size
            recording.status, recording.status_detail = "ready", ""
        except Exception as error:  # noqa: BLE001 - reported to the user
            log.exception("recording post-processing failed")
            if finalize:
                # Keep the raw file playable even if ffmpeg failed.
                fallback = file_path(recording_id, recording.format)
                if raw_path(recording_id).exists() and not fallback.exists():
                    raw_path(recording_id).replace(fallback)
                recording.status = "ready" if fallback.exists() else "failed"
            else:
                recording.status = "ready"
            recording.status_detail = f"Conversion to {target_fmt.upper()} failed: {error}"
        finally:
            recording.finished_at = recording.finished_at or _now()
            db.commit()
            with _jobs_lock:
                _jobs.discard(recording_id)


def _start_job(recording_id: str, target_fmt: str, finalize: bool) -> None:
    with _jobs_lock:
        if recording_id in _jobs:
            raise HTTPException(status.HTTP_409_CONFLICT, "This recording is already being processed.")
        _jobs.add(recording_id)
    threading.Thread(target=_job, args=(recording_id, target_fmt, finalize), daemon=True, name=f"rec-{recording_id[:8]}").start()


def finish(db: Session, recording_id: str, body: RecordingFinishIn) -> RecordingOut:
    recording = get_recording(db, recording_id)
    if recording.status != "recording":
        raise HTTPException(status.HTTP_409_CONFLICT, "This recording is already finished.")
    if not raw_path(recording_id).exists() or raw_path(recording_id).stat().st_size == 0:
        recording.status, recording.status_detail = "failed", "No video data was received."
        recording.finished_at = _now()
        db.commit()
        return to_out(recording)
    recording.duration_seconds = body.duration_seconds
    recording.status, recording.status_detail = "processing", ""
    db.commit()
    _start_job(recording_id, recording.requested_format, finalize=True)
    return to_out(recording)


def export(db: Session, recording_id: str, fmt: str) -> RecordingOut:
    recording = get_recording(db, recording_id)
    file_path(recording_id, fmt)  # validates fmt
    if recording.status != "ready":
        raise HTTPException(status.HTTP_409_CONFLICT, "The recording is not ready yet.")
    if file_path(recording_id, fmt).exists():
        return to_out(recording)
    recording.status, recording.status_detail = "processing", f"Converting to {fmt.upper()}…"
    db.commit()
    _start_job(recording_id, fmt, finalize=False)
    return to_out(recording)


def media(db: Session, recording_id: str, fmt: str | None) -> tuple[Path, str, str]:
    recording = get_recording(db, recording_id)
    fmt = fmt or recording.format
    path = file_path(recording_id, fmt)
    if recording.status != "ready" or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This recording is not available in that format.")
    safe = "".join(c for c in recording.name if c.isalnum() or c in " -_").strip() or "recording"
    return path, f"video/{fmt}", f"{safe}.{fmt}"


def rename(db: Session, recording_id: str, body: RecordingPatch) -> RecordingOut:
    recording = get_recording(db, recording_id)
    recording.name = body.name.strip()
    db.commit()
    return to_out(recording)


def delete(db: Session, recording_id: str) -> None:
    recording = get_recording(db, recording_id)
    with _jobs_lock:
        if recording_id in _jobs:
            raise HTTPException(status.HTTP_409_CONFLICT, "Wait until processing has finished.")
    for path in (raw_path(recording_id), *(file_path(recording_id, f) for f in FORMATS)):
        path.unlink(missing_ok=True)
    db.delete(recording)
    db.commit()


def recover_interrupted() -> None:
    """At startup: recordings still marked as recording/processing were cut off by a crash or quit."""
    with SessionLocal() as db:
        for recording in db.query(Recording).filter(Recording.status.in_(("recording", "processing"))).all():
            raw = raw_path(recording.id)
            target = file_path(recording.id, recording.format)
            if raw.exists() and raw.stat().st_size > 0 and not target.exists():
                raw.replace(target)
            recording.status = "ready" if target.exists() else "failed"
            recording.status_detail = "The app closed while recording; this is the part that was saved."
            recording.finished_at = recording.finished_at or _now()
            if target.exists():
                recording.size_bytes = target.stat().st_size
        db.commit()
