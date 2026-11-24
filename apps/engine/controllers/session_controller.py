"""Studio session history for the dashboard."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from controllers import avatar_controller, voice_controller
from models import Avatar, StudioSession, VoiceProfile
from models.schemas import SessionEndIn, SessionOut, SessionStartIn


def start_session(db: Session, body: SessionStartIn) -> SessionOut:
    avatar = db.get(Avatar, body.avatar_id) if body.avatar_id else None
    if avatar is not None:
        avatar_controller.require_authorised(avatar)
    voice = db.get(VoiceProfile, body.voice_id) if body.voice_id else None
    row = StudioSession(
        avatar_id=avatar.id if avatar else None, voice_id=voice.id if voice else None,
        avatar_name=avatar.name if avatar else "", voice_name=voice.name if voice else "",
    )
    db.add(row)
    db.commit()
    if avatar:
        avatar_controller.mark_used(db, avatar.id)
    if voice:
        voice_controller.mark_used(db, voice.id)
    return SessionOut.model_validate(row)


def end_session(db: Session, session_id: str, body: SessionEndIn) -> SessionOut:
    row = db.get(StudioSession, session_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found.")
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    row.ended_at = datetime.now(timezone.utc)
    db.commit()
    return SessionOut.model_validate(row)


def recent_sessions(db: Session, limit: int = 10) -> list[SessionOut]:
    rows = db.query(StudioSession).order_by(StudioSession.started_at.desc()).limit(max(1, min(limit, 100))).all()
    return [SessionOut.model_validate(r) for r in rows]


def clear_history(db: Session) -> None:
    db.query(StudioSession).delete()
    db.commit()
