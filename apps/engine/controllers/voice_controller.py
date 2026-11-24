"""Voice profiles: preloaded library, consent-gated personal enrolment, previews and file conversion."""
from __future__ import annotations

import logging
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from config.settings import get_settings
from models import VoiceKind, VoiceProfile
from models.ai import audio_io, preview_source
from models.ai.tone_converter import tone_model
from models.schemas import VoiceOut, VoicePatch

log = logging.getLogger("engine.voices")
SOURCE_VOICE_ID = "source-self"
FALLBACK_SOURCE = "en-default"
_preview_lock = threading.Lock()

# Preloaded library: tone-colour embeddings of the OpenVoice V2 base speakers (MIT licensed).
LIBRARY = [
    ("en-us", "Harbor", "Clear, neutral American English timbre.", "English (US)", "neutral,clear,narration"),
    ("en-br", "Wren", "Bright British English timbre with crisp articulation.", "English (UK)", "bright,crisp"),
    ("en-au", "Coral", "Warm Australian English timbre.", "English (AU)", "warm,friendly"),
    ("en-india", "Saffron", "Smooth Indian English timbre.", "English (IN)", "smooth,calm"),
    ("en-default", "Atlas", "Balanced default English timbre; a safe all-rounder.", "English", "balanced,default"),
    ("en-newest", "Nova", "Modern, energetic English timbre.", "English", "energetic,modern"),
    ("es", "Sol", "Spanish base-speaker timbre.", "Spanish", "warm,expressive"),
    ("fr", "Lumière", "French base-speaker timbre.", "French", "soft,elegant"),
    ("jp", "Sakura", "Japanese base-speaker timbre.", "Japanese", "light,gentle"),
    ("kr", "Haneul", "Korean base-speaker timbre.", "Korean", "light,clear"),
    ("zh", "Jade", "Mandarin Chinese base-speaker timbre.", "Chinese", "smooth,bright"),
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _data_path(relative: str | None) -> Path | None:
    return get_settings().data_dir / relative if relative else None


def _relative(path: Path) -> str:
    return path.relative_to(get_settings().data_dir).as_posix()


def to_out(voice: VoiceProfile) -> VoiceOut:
    embedding = _data_path(voice.embedding_path)
    return VoiceOut(
        id=voice.id, kind=voice.kind, name=voice.name, description=voice.description, language=voice.language,
        tags=[t for t in voice.tags.split(",") if t], sample_seconds=voice.sample_seconds, favourite=voice.favourite,
        has_sample=bool(voice.sample_path and _data_path(voice.sample_path).is_file()),
        has_preview=bool(voice.preview_path and _data_path(voice.preview_path).is_file()),
        ready=bool(embedding and embedding.is_file()),
        consent_subject=voice.consent_subject, consent_relation=voice.consent_relation, consent_at=voice.consent_at,
        source=voice.source, created_at=voice.created_at, last_used_at=voice.last_used_at,
    )


# ---------------------------------------------------------------------- library
def seed_library(db: Session) -> None:
    if not tone_model.files_present():
        return
    for key, name, description, language, tags in LIBRARY:
        voice_id = f"lib-{key}"
        path = tone_model.base_speaker_path(key)
        if db.get(VoiceProfile, voice_id) is None and path.is_file():
            db.add(VoiceProfile(
                id=voice_id, kind=VoiceKind.LIBRARY, name=name, description=description, language=language, tags=tags,
                embedding_path=_relative(path), source=f"OpenVoice V2 base speaker '{key}' (MIT licence)",
            ))
    db.commit()


def list_voices(db: Session, kind: str | None = None, favourite: bool | None = None) -> list[VoiceOut]:
    query = db.query(VoiceProfile).filter(VoiceProfile.kind != VoiceKind.SOURCE)
    if kind:
        query = query.filter(VoiceProfile.kind == kind)
    if favourite is not None:
        query = query.filter(VoiceProfile.favourite == favourite)
    voices = query.order_by(VoiceProfile.kind, VoiceProfile.created_at.desc()).all()
    return [to_out(v) for v in voices]


def get_voice(db: Session, voice_id: str) -> VoiceProfile:
    voice = db.get(VoiceProfile, voice_id)
    if voice is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Voice not found.")
    return voice


def update_voice(db: Session, voice_id: str, patch: VoicePatch) -> VoiceOut:
    voice = get_voice(db, voice_id)
    if voice.kind == VoiceKind.LIBRARY and (patch.name is not None or patch.description is not None):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Library voices can be favourited but not renamed.")
    for field, value in patch.model_dump(exclude_none=True).items():
        setattr(voice, field, value)
    db.commit()
    return to_out(voice)


def mark_used(db: Session, voice_id: str) -> None:
    voice = db.get(VoiceProfile, voice_id)
    if voice:
        voice.last_used_at = _now()
        db.commit()


# ---------------------------------------------------------------------- embeddings
def load_embedding(voice: VoiceProfile) -> torch.Tensor:
    path = _data_path(voice.embedding_path)
    if not path or not path.is_file():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Voice '{voice.name}' has no embedding yet.")
    return tone_model.load_embedding(path)


def source_voice(db: Session) -> VoiceProfile | None:
    voice = db.get(VoiceProfile, SOURCE_VOICE_ID)
    if voice and voice.embedding_path and _data_path(voice.embedding_path).is_file():
        return voice
    return None


def source_embedding(db: Session) -> torch.Tensor | None:
    voice = source_voice(db)
    return load_embedding(voice) if voice else None


def fallback_source_embedding() -> torch.Tensor:
    return tone_model.load_embedding(tone_model.base_speaker_path(FALLBACK_SOURCE))


# ---------------------------------------------------------------------- uploads
async def _read_sample(upload: UploadFile) -> np.ndarray:
    settings = get_settings()
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in audio_io.SUPPORTED_AUDIO_EXTENSIONS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use WAV, MP3, FLAC, OGG, M4A, OPUS or WEBM audio.")
    data = await upload.read(settings.max_audio_bytes + 1)
    if len(data) > settings.max_audio_bytes:
        raise HTTPException(413, "Audio files must be 40 MB or smaller.")
    try:
        audio = await run_in_threadpool(audio_io.decode_audio, data, tone_model.sample_rate)
    except audio_io.AudioDecodeError as exc:
        raise HTTPException(422, str(exc)) from exc
    speech = await run_in_threadpool(audio_io.trim_silence, audio, tone_model.sample_rate)
    seconds = len(speech) / tone_model.sample_rate
    if seconds < settings.min_voice_seconds:
        raise HTTPException(422, f"Only {seconds:.1f} s of speech was found. Provide at least {settings.min_voice_seconds:.0f} s of clear speech.")
    if seconds > settings.max_voice_seconds:
        speech = speech[: int(settings.max_voice_seconds * tone_model.sample_rate)]
    return audio_io.peak_normalise(speech)


def _require_model() -> None:
    if not tone_model.ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, tone_model.status.detail or "The voice model is not ready yet.")


def _store_profile_audio(voice: VoiceProfile, speech: np.ndarray) -> None:
    folder = get_settings().voices_dir / voice.id
    folder.mkdir(parents=True, exist_ok=True)
    audio_io.write_wav(folder / "sample.wav", speech, tone_model.sample_rate)
    tone_model.save_embedding(tone_model.extract_embedding(speech), folder / "embedding.pt")
    voice.sample_path = _relative(folder / "sample.wav")
    voice.embedding_path = _relative(folder / "embedding.pt")
    voice.sample_seconds = round(len(speech) / tone_model.sample_rate, 1)
    preview = folder / "preview.wav"
    preview.unlink(missing_ok=True)
    voice.preview_path = None


async def create_personal_voice(
    db: Session, upload: UploadFile, name: str, description: str, consent_subject: str, consent_relation: str, consent_confirmed: bool,
) -> VoiceOut:
    if not consent_confirmed or consent_relation not in {"self", "authorised"} or not consent_subject.strip():
        raise HTTPException(status.HTTP_403_FORBIDDEN, "A voice can only be cloned with the explicit authorisation of the person whose voice it is.")
    _require_model()
    speech = await _read_sample(upload)
    statement = (
        f"I confirm that this recording is my own voice ({consent_subject.strip()})."
        if consent_relation == "self"
        else f"I confirm that {consent_subject.strip()} has authorised me to create and use an AI voice profile from this recording."
    )
    voice = VoiceProfile(
        kind=VoiceKind.PERSONAL, name=name.strip()[:80] or "My voice", description=description.strip()[:400],
        consent_subject=consent_subject.strip()[:120], consent_relation=consent_relation, consent_statement=statement,
        consent_at=_now(), source=f"Uploaded sample ({upload.filename})",
    )
    db.add(voice)
    db.flush()
    try:
        await run_in_threadpool(_store_profile_audio, voice, speech)
    except Exception:
        db.rollback()
        shutil.rmtree(get_settings().voices_dir / voice.id, ignore_errors=True)
        raise
    db.commit()
    return to_out(voice)


async def replace_sample(db: Session, voice_id: str, upload: UploadFile, consent_confirmed: bool) -> VoiceOut:
    voice = get_voice(db, voice_id)
    if voice.kind != VoiceKind.PERSONAL:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only personal voices can be replaced.")
    if not consent_confirmed:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Confirm that {voice.consent_subject} authorised this new sample.")
    _require_model()
    speech = await _read_sample(upload)
    await run_in_threadpool(_store_profile_audio, voice, speech)
    voice.consent_at = _now()
    voice.source = f"Uploaded sample ({upload.filename})"
    db.commit()
    return to_out(voice)


def delete_voice(db: Session, voice_id: str) -> None:
    voice = get_voice(db, voice_id)
    if voice.kind == VoiceKind.LIBRARY:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Library voices cannot be deleted. Remove it from favourites instead.")
    shutil.rmtree(get_settings().voices_dir / voice.id, ignore_errors=True)
    db.delete(voice)
    db.commit()


async def set_source_voice(db: Session, upload: UploadFile) -> VoiceOut:
    """Calibrate the user's own microphone voice; improves conversion quality from the first word."""
    _require_model()
    speech = await _read_sample(upload)
    voice = db.get(VoiceProfile, SOURCE_VOICE_ID)
    if voice is None:
        voice = VoiceProfile(id=SOURCE_VOICE_ID, kind=VoiceKind.SOURCE, name="My microphone voice", consent_relation="self", consent_subject="Me")
        db.add(voice)
        db.flush()
    await run_in_threadpool(_store_profile_audio, voice, speech)
    voice.consent_at = _now()
    db.commit()
    return to_out(voice)


def clear_source_voice(db: Session) -> None:
    if db.get(VoiceProfile, SOURCE_VOICE_ID):
        delete_voice(db, SOURCE_VOICE_ID)


# ---------------------------------------------------------------------- previews and file conversion
def _preview_source(db: Session) -> tuple[np.ndarray, torch.Tensor]:
    """The neutral utterance converted into each voice for previews (SAPI on Windows, else the calibration)."""
    folder = get_settings().voices_dir
    wav, emb = folder / "_preview_source.wav", folder / "_preview_source.pt"
    if not wav.is_file() and not preview_source.synthesise_with_sapi(wav):
        calibration = source_voice(db)
        if calibration is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Record your own voice in Settings → Voice calibration to enable previews.")
        return audio_io.read_wav(_data_path(calibration.sample_path), tone_model.sample_rate), load_embedding(calibration)
    audio = audio_io.peak_normalise(audio_io.read_wav(wav, tone_model.sample_rate), 0.9)
    if not emb.is_file():
        tone_model.save_embedding(tone_model.extract_embedding(audio), emb)
    return audio, tone_model.load_embedding(emb)


def _convert_offline(audio: np.ndarray, source_se: torch.Tensor, target_se: torch.Tensor) -> np.ndarray:
    hop = tone_model.hop_length
    padded = np.pad(audio, (0, (-len(audio)) % hop))
    return audio_io.peak_normalise(tone_model.convert(padded, source_se, target_se), 0.9)


def preview_path(db: Session, voice_id: str) -> Path:
    voice = get_voice(db, voice_id)
    existing = _data_path(voice.preview_path)
    if existing and existing.is_file():
        return existing
    _require_model()
    with _preview_lock:
        audio, source_se = _preview_source(db)
        converted = _convert_offline(audio, source_se, load_embedding(voice))
        target = get_settings().voices_dir / voice.id / "preview.wav"
        audio_io.write_wav(target, converted, tone_model.sample_rate)
        voice.preview_path = _relative(target)
        db.commit()
    return target


def sample_path(db: Session, voice_id: str) -> Path:
    voice = get_voice(db, voice_id)
    path = _data_path(voice.sample_path)
    if not path or not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This voice has no stored sample.")
    return path


async def convert_upload(db: Session, voice_id: str, upload: UploadFile) -> bytes:
    """Convert a recorded/uploaded clip into the voice (used by "Try with my voice")."""
    _require_model()
    voice = get_voice(db, voice_id)
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in audio_io.SUPPORTED_AUDIO_EXTENSIONS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported audio format.")
    data = await upload.read(get_settings().max_audio_bytes + 1)
    if len(data) > get_settings().max_audio_bytes:
        raise HTTPException(413, "Audio files must be 40 MB or smaller.")
    try:
        audio = (await run_in_threadpool(audio_io.decode_audio, data, tone_model.sample_rate))[: 60 * tone_model.sample_rate]
    except audio_io.AudioDecodeError as exc:
        raise HTTPException(422, str(exc)) from exc
    target_se = load_embedding(voice)
    source_se = source_embedding(db)

    def work() -> bytes:
        speech = audio_io.trim_silence(audio, tone_model.sample_rate)
        if len(speech) < tone_model.sample_rate:
            raise HTTPException(422, "Record at least one second of speech.")
        src = source_se if source_se is not None else tone_model.extract_embedding(speech)
        converted = _convert_offline(audio_io.peak_normalise(audio, 0.9), src, target_se)
        return audio_io.encode_wav(converted, tone_model.sample_rate)

    result = await run_in_threadpool(work)
    mark_used(db, voice_id)
    return result
