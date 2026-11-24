from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from config.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Recording(Base):
    """A recording of the studio's final output (animated avatar + converted voice), stored on disk."""

    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(120))
    # recording -> processing -> ready | failed | interrupted
    status: Mapped[str] = mapped_column(String(16), default="recording")
    status_detail: Mapped[str] = mapped_column(String(300), default="")
    # Container of the stored file: "webm" or "mp4". A second container may exist after an export.
    format: Mapped[str] = mapped_column(String(8))
    source_mime: Mapped[str] = mapped_column(String(80))
    requested_format: Mapped[str] = mapped_column(String(8))
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    has_audio: Mapped[int] = mapped_column(Integer, default=1)
    avatar_name: Mapped[str] = mapped_column(String(80), default="")
    voice_name: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
