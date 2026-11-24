"""Engine configuration. Every value can be overridden with an ``AVS_``-prefixed environment variable."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENGINE_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="AVS_", env_file=ENGINE_ROOT / ".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8765
    # Shared secret issued by the desktop shell. Empty disables the check (plain-browser development only).
    token: str = ""
    data_dir: Path = ENGINE_ROOT / "data"
    allowed_origin_regex: str = r"^(avc://bundle|https?://(localhost|127\.0\.0\.1)(:\d+)?)$"

    # Uploads
    max_image_bytes: int = 10 * 1024 * 1024
    max_audio_bytes: int = 40 * 1024 * 1024
    min_voice_seconds: float = 4.0
    max_voice_seconds: float = 300.0

    # Voice conversion (OpenVoice V2 tone-colour converter)
    hf_repo: str = "myshell-ai/OpenVoiceV2"
    device: str = "auto"  # auto | cpu | cuda
    torch_threads: int = 0  # 0 = number of physical cores
    tau: float = 0.3
    # Streaming block size. 0 = choose automatically from the startup benchmark.
    block_ms: int = 0
    context_ms: int = 320
    crossfade_ms: int = 40
    silence_dbfs: float = -48.0

    # Recordings
    max_recording_bytes: int = 8 * 1024 * 1024 * 1024
    max_recording_chunk_bytes: int = 32 * 1024 * 1024

    # Largest WebSocket message (one raw RGBA 1080p frame is 8.3 MB)
    ws_max_bytes: int = 16 * 1024 * 1024

    @property
    def db_path(self) -> Path:
        return self.data_dir / "studio.sqlite3"

    @property
    def checkpoints_dir(self) -> Path:
        return self.data_dir / "checkpoints"

    @property
    def avatars_dir(self) -> Path:
        return self.data_dir / "avatars"

    @property
    def voices_dir(self) -> Path:
        return self.data_dir / "voices"

    @property
    def recordings_dir(self) -> Path:
        return self.data_dir / "recordings"

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.checkpoints_dir, self.avatars_dir, self.voices_dir, self.recordings_dir):
            path.mkdir(parents=True, exist_ok=True)

    def resolved_threads(self) -> int:
        if self.torch_threads > 0:
            return self.torch_threads
        return max(1, (os.cpu_count() or 2) // 2)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_dirs()
    return settings
