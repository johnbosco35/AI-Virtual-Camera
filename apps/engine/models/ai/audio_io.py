"""Audio decoding, resampling and encoding helpers (FFmpeg is used for compressed formats)."""
from __future__ import annotations

import io
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf
import soxr

SUPPORTED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".oga", ".opus", ".m4a", ".aac", ".webm", ".wma"}


class AudioDecodeError(ValueError):
    pass


def _ffmpeg_exe() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # pragma: no cover - depends on the install
        raise AudioDecodeError("FFmpeg is not available to decode this audio format.") from exc


def decode_audio(data: bytes, target_sr: int) -> np.ndarray:
    """Decode any supported audio file to mono float32 at ``target_sr``."""
    try:
        audio, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
        mono = audio.mean(axis=1)
        return resample(mono, sr, target_sr)
    except Exception:
        pass
    # Compressed or container formats: let FFmpeg decode to raw PCM.
    process = subprocess.run(
        [_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-ac", "1", "-ar", str(target_sr), "-f", "f32le", "pipe:1"],
        input=data,
        capture_output=True,
        timeout=120,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    if process.returncode != 0 or not process.stdout:
        raise AudioDecodeError("This audio file could not be decoded. Use WAV, MP3, FLAC, OGG, M4A or WEBM.")
    return np.frombuffer(process.stdout, dtype=np.float32).copy()


def resample(audio: np.ndarray, source_sr: int, target_sr: int) -> np.ndarray:
    if source_sr == target_sr:
        return audio.astype(np.float32, copy=False)
    return soxr.resample(audio.astype(np.float32, copy=False), source_sr, target_sr, quality="HQ").astype(np.float32)


def trim_silence(audio: np.ndarray, sr: int, threshold_dbfs: float = -45.0, frame_ms: int = 30) -> np.ndarray:
    """Remove leading/trailing silence and long internal pauses so embeddings focus on speech."""
    frame = max(1, int(sr * frame_ms / 1000))
    usable = len(audio) // frame * frame
    if usable == 0:
        return audio
    frames = audio[:usable].reshape(-1, frame)
    rms = np.sqrt((frames**2).mean(axis=1) + 1e-12)
    voiced = 20 * np.log10(rms) > threshold_dbfs
    if not voiced.any():
        return audio[:0]
    # Keep voiced frames plus a little padding on each side.
    keep = voiced.copy()
    for shift in (1, 2, 3):
        keep[:-shift] |= voiced[shift:]
        keep[shift:] |= voiced[:-shift]
    return frames[keep].reshape(-1)


def peak_normalise(audio: np.ndarray, peak: float = 0.95) -> np.ndarray:
    current = float(np.max(np.abs(audio))) if audio.size else 0.0
    if current < 1e-6:
        return audio
    return (audio * (peak / current)).astype(np.float32)


def encode_wav(audio: np.ndarray, sr: int) -> bytes:
    buffer = io.BytesIO()
    sf.write(buffer, np.clip(audio, -1, 1), sr, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def write_wav(path: Path, audio: np.ndarray, sr: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, np.clip(audio, -1, 1), sr, subtype="PCM_16")


def read_wav(path: Path, target_sr: int) -> np.ndarray:
    audio, sr = sf.read(path, dtype="float32", always_2d=True)
    return resample(audio.mean(axis=1), sr, target_sr)


def dbfs(audio: np.ndarray) -> float:
    if audio.size == 0:
        return -120.0
    return float(20 * np.log10(np.sqrt(np.mean(audio**2)) + 1e-9))
