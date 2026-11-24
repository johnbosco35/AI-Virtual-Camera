from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from config.database import get_db
from controllers import voice_controller
from models.schemas import VoiceOut, VoicePatch

router = APIRouter(prefix="/voices", tags=["voices"])


@router.get("", response_model=list[VoiceOut])
def list_voices(kind: str | None = Query(default=None, pattern="^(library|personal)$"), favourite: bool | None = None, db: Session = Depends(get_db)):
    return voice_controller.list_voices(db, kind, favourite)


@router.post("", response_model=VoiceOut, status_code=201)
async def create_voice(
    file: UploadFile = File(...),
    name: str = Form(..., min_length=1, max_length=80),
    description: str = Form(default="", max_length=400),
    consent_subject: str = Form(..., min_length=1, max_length=120),
    consent_relation: str = Form(..., pattern="^(self|authorised)$"),
    consent_confirmed: bool = Form(...),
    db: Session = Depends(get_db),
):
    return await voice_controller.create_personal_voice(db, file, name, description, consent_subject, consent_relation, consent_confirmed)


@router.get("/source", response_model=VoiceOut | None)
def get_source_voice(db: Session = Depends(get_db)):
    voice = voice_controller.source_voice(db)
    return voice_controller.to_out(voice) if voice else None


@router.put("/source", response_model=VoiceOut)
async def set_source_voice(file: UploadFile = File(...), db: Session = Depends(get_db)):
    return await voice_controller.set_source_voice(db, file)


@router.delete("/source", status_code=204)
def clear_source_voice(db: Session = Depends(get_db)):
    voice_controller.clear_source_voice(db)
    return Response(status_code=204)


@router.get("/{voice_id}", response_model=VoiceOut)
def get_voice(voice_id: str, db: Session = Depends(get_db)):
    return voice_controller.to_out(voice_controller.get_voice(db, voice_id))


@router.patch("/{voice_id}", response_model=VoiceOut)
def update_voice(voice_id: str, body: VoicePatch, db: Session = Depends(get_db)):
    return voice_controller.update_voice(db, voice_id, body)


@router.put("/{voice_id}/sample", response_model=VoiceOut)
async def replace_sample(voice_id: str, file: UploadFile = File(...), consent_confirmed: bool = Form(...), db: Session = Depends(get_db)):
    return await voice_controller.replace_sample(db, voice_id, file, consent_confirmed)


@router.delete("/{voice_id}", status_code=204)
def delete_voice(voice_id: str, db: Session = Depends(get_db)):
    voice_controller.delete_voice(db, voice_id)
    return Response(status_code=204)


@router.get("/{voice_id}/preview")
def get_preview(voice_id: str, db: Session = Depends(get_db)):
    # Sync route: FastAPI runs it in the threadpool, so first-time preview rendering never blocks streaming.
    return FileResponse(voice_controller.preview_path(db, voice_id), media_type="audio/wav", headers={"X-AI-Generated": "true"})


@router.get("/{voice_id}/sample")
def get_sample(voice_id: str, db: Session = Depends(get_db)):
    return FileResponse(voice_controller.sample_path(db, voice_id), media_type="audio/wav")


@router.post("/{voice_id}/convert")
async def convert_clip(voice_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    wav = await voice_controller.convert_upload(db, voice_id, file)
    return Response(wav, media_type="audio/wav", headers={"X-AI-Generated": "true"})
