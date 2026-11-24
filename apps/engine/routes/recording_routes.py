from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from config.database import get_db
from controllers import recording_controller
from models.schemas import RecordingCreateIn, RecordingFinishIn, RecordingOut, RecordingPatch

router = APIRouter(prefix="/recordings", tags=["recordings"])


@router.get("", response_model=list[RecordingOut])
def list_recordings(db: Session = Depends(get_db)):
    return recording_controller.list_recordings(db)


@router.post("", response_model=RecordingOut, status_code=201)
def create_recording(body: RecordingCreateIn, db: Session = Depends(get_db)):
    return recording_controller.create(db, body)


@router.post("/{recording_id}/chunks")
async def append_chunk(recording_id: str, request: Request, db: Session = Depends(get_db)):
    return await recording_controller.append_chunk(db, recording_id, request)


@router.post("/{recording_id}/finish", response_model=RecordingOut)
def finish_recording(recording_id: str, body: RecordingFinishIn, db: Session = Depends(get_db)):
    return recording_controller.finish(db, recording_id, body)


@router.get("/{recording_id}", response_model=RecordingOut)
def get_recording(recording_id: str, db: Session = Depends(get_db)):
    return recording_controller.to_out(recording_controller.get_recording(db, recording_id))


@router.post("/{recording_id}/export", response_model=RecordingOut)
def export_recording(recording_id: str, format: str = Query(pattern="^(mp4|webm)$"), db: Session = Depends(get_db)):
    return recording_controller.export(db, recording_id, format)


@router.get("/{recording_id}/media")
def recording_media(recording_id: str, format: str | None = Query(default=None, pattern="^(mp4|webm)$"), download: bool = False, db: Session = Depends(get_db)):
    path, mime, filename = recording_controller.media(db, recording_id, format)
    return FileResponse(path, media_type=mime, filename=filename if download else None, headers={"Cache-Control": "no-cache"})


@router.patch("/{recording_id}", response_model=RecordingOut)
def rename_recording(recording_id: str, body: RecordingPatch, db: Session = Depends(get_db)):
    return recording_controller.rename(db, recording_id, body)


@router.delete("/{recording_id}", status_code=204)
def delete_recording(recording_id: str, db: Session = Depends(get_db)):
    recording_controller.delete(db, recording_id)
    return Response(status_code=204)
