from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from config.database import get_db
from controllers import session_controller
from models.schemas import SessionEndIn, SessionOut, SessionStartIn

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionOut])
def recent_sessions(limit: int = Query(default=10, ge=1, le=100), db: Session = Depends(get_db)):
    return session_controller.recent_sessions(db, limit)


@router.post("", response_model=SessionOut, status_code=201)
def start_session(body: SessionStartIn, db: Session = Depends(get_db)):
    return session_controller.start_session(db, body)


@router.post("/{session_id}/end", response_model=SessionOut)
def end_session(session_id: str, body: SessionEndIn, db: Session = Depends(get_db)):
    return session_controller.end_session(db, session_id, body)


@router.delete("", status_code=204)
def clear_history(db: Session = Depends(get_db)):
    session_controller.clear_history(db)
    return Response(status_code=204)
