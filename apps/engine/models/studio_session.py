from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from config.database import Base, UTCDateTime


def _now() -> datetime:
    return datetime.now(timezone.utc)


class StudioSession(Base):
    """One live studio run, kept for the dashboard's recent-sessions list."""

    __tablename__ = "studio_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    avatar_id: Mapped[str | None] = mapped_column(ForeignKey("avatars.id", ondelete="SET NULL"), nullable=True)
    voice_id: Mapped[str | None] = mapped_column(ForeignKey("voices.id", ondelete="SET NULL"), nullable=True)
    avatar_name: Mapped[str] = mapped_column(String(80), default="")
    voice_name: Mapped[str] = mapped_column(String(80), default="")
    started_at: Mapped[datetime] = mapped_column(UTCDateTime, default=_now)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    avg_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_tracking_fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    voice_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    blocks_dropped: Mapped[int] = mapped_column(Integer, default=0)
