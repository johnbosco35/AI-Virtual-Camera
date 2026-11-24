from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from config.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


class VoiceKind:
    LIBRARY = "library"  # bundled, preloaded profiles
    PERSONAL = "personal"  # user-enrolled from an authorised sample
    SOURCE = "source"  # calibration of the user's own microphone voice


class VoiceProfile(Base):
    """A reusable tone-colour embedding plus its sample, preview and consent record."""

    __tablename__ = "voices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kind: Mapped[str] = mapped_column(String(16), index=True)
    name: Mapped[str] = mapped_column(String(80))
    description: Mapped[str] = mapped_column(String(400), default="")
    language: Mapped[str] = mapped_column(String(32), default="")
    tags: Mapped[str] = mapped_column(String(200), default="")  # comma separated
    # Paths are relative to the data directory.
    embedding_path: Mapped[str | None] = mapped_column(String(260), nullable=True)
    sample_path: Mapped[str | None] = mapped_column(String(260), nullable=True)
    preview_path: Mapped[str | None] = mapped_column(String(260), nullable=True)
    sample_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    favourite: Mapped[bool] = mapped_column(Boolean, default=False)
    # Consent / authorisation record (required for personal voices).
    consent_subject: Mapped[str] = mapped_column(String(120), default="")
    consent_relation: Mapped[str] = mapped_column(String(32), default="")  # self | authorised
    consent_statement: Mapped[str] = mapped_column(Text, default="")
    consent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    source: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
