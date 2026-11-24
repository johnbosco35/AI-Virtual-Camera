from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from config.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Avatar(Base):
    """An uploaded portrait plus the facial landmarks detected in it."""

    __tablename__ = "avatars"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(80))
    filename: Mapped[str] = mapped_column(String(120))
    mime_type: Mapped[str] = mapped_column(String(32))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    # JSON array of [x, y, z] normalised MediaPipe landmarks, or null when no face was found.
    landmarks_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 0..1 estimate of how well the portrait can be animated (face size, frontal pose, detection).
    compatibility: Mapped[float] = mapped_column(Float, default=0.0)
    compatibility_note: Mapped[str] = mapped_column(String(200), default="")
    favourite: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now, onupdate=_now)
    last_used_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    # Authorisation for the likeness: whose face this is, and the statement the user confirmed.
    consent_subject: Mapped[str] = mapped_column(String(120), default="")
    consent_relation: Mapped[str] = mapped_column(String(32), default="")  # self | authorised
    consent_statement: Mapped[str] = mapped_column(Text, default="")
    consent_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
