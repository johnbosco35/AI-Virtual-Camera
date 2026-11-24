from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from config.database import get_db
from controllers import avatar_controller
from models.schemas import AvatarAuthorisationIn, AvatarDetailOut, AvatarLandmarksIn, AvatarOut, AvatarPatch

router = APIRouter(prefix="/avatars", tags=["avatars"])


@router.get("", response_model=list[AvatarOut])
def list_avatars(db: Session = Depends(get_db)):
    return avatar_controller.list_avatars(db)


@router.post("", response_model=AvatarOut, status_code=201)
async def upload_avatar(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    consent_subject: str = Form(default="", max_length=120),
    consent_relation: str = Form(default=""),
    consent_confirmed: bool = Form(default=False),
    db: Session = Depends(get_db),
):
    return await avatar_controller.create_avatar(db, file, name, consent_subject, consent_relation, consent_confirmed)


@router.put("/{avatar_id}/authorisation", response_model=AvatarOut)
def authorise_avatar(avatar_id: str, body: AvatarAuthorisationIn, db: Session = Depends(get_db)):
    return avatar_controller.authorise(db, avatar_id, body)


@router.get("/{avatar_id}", response_model=AvatarDetailOut)
def get_avatar(avatar_id: str, db: Session = Depends(get_db)):
    return avatar_controller.to_detail(avatar_controller.get_avatar(db, avatar_id))


@router.patch("/{avatar_id}", response_model=AvatarOut)
def update_avatar(avatar_id: str, body: AvatarPatch, db: Session = Depends(get_db)):
    return avatar_controller.update_avatar(db, avatar_id, body)


@router.put("/{avatar_id}/image", response_model=AvatarOut)
async def replace_image(avatar_id: str, file: UploadFile = File(...), consent_confirmed: bool = Form(default=False), db: Session = Depends(get_db)):
    return await avatar_controller.replace_image(db, avatar_id, file, consent_confirmed)


@router.put("/{avatar_id}/landmarks", response_model=AvatarOut)
def set_landmarks(avatar_id: str, body: AvatarLandmarksIn, db: Session = Depends(get_db)):
    return avatar_controller.set_landmarks(db, avatar_id, body)


@router.get("/{avatar_id}/image")
def get_image(avatar_id: str, db: Session = Depends(get_db)):
    path, mime = avatar_controller.image_path(db, avatar_id)
    return FileResponse(path, media_type=mime, headers={"Cache-Control": "no-cache"})


@router.delete("/{avatar_id}", status_code=204)
def delete_avatar(avatar_id: str, db: Session = Depends(get_db)):
    avatar_controller.delete_avatar(db, avatar_id)
    return Response(status_code=204)
