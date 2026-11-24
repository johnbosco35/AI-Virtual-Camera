"""Avatar portraits: validated upload, gallery management and stored facial landmarks."""
from __future__ import annotations

import io
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError
from sqlalchemy.orm import Session

from config.settings import get_settings
from models import Avatar
from models.schemas import AvatarAuthorisationIn, AvatarDetailOut, AvatarLandmarksIn, AvatarOut, AvatarPatch

FORMATS = {"PNG": ("image/png", ".png"), "JPEG": ("image/jpeg", ".jpg"), "WEBP": ("image/webp", ".webp")}
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MIN_SIDE, MAX_SIDE = 128, 4096


def _now() -> datetime:
    return datetime.now(timezone.utc)


def to_out(avatar: Avatar) -> AvatarOut:
    return AvatarOut(
        id=avatar.id, name=avatar.name, mime_type=avatar.mime_type, width=avatar.width, height=avatar.height,
        has_landmarks=bool(avatar.landmarks_json), compatibility=avatar.compatibility,
        compatibility_note=avatar.compatibility_note, favourite=avatar.favourite, created_at=avatar.created_at,
        updated_at=avatar.updated_at, last_used_at=avatar.last_used_at,
        authorised=avatar.consent_at is not None, consent_subject=avatar.consent_subject or "",
        consent_relation=avatar.consent_relation or "", consent_at=avatar.consent_at,
    )


def _apply_consent(avatar: Avatar, subject: str, relation: str, confirmed: bool) -> None:
    """Record whose likeness this is. Refuses without an explicit confirmation."""
    subject = (subject or "").strip()
    if not confirmed or relation not in {"self", "authorised"} or not subject:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Confirm that this is your own face, or that the person shown has authorised you to animate it.",
        )
    avatar.consent_subject = subject[:120]
    avatar.consent_relation = relation
    avatar.consent_statement = (
        f"I confirm that this picture shows me ({subject})."
        if relation == "self"
        else f"I confirm that {subject} has authorised me to animate this picture of them and to use it as an AI avatar."
    )
    avatar.consent_at = _now()


def require_authorised(avatar: Avatar) -> None:
    if avatar.consent_at is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Confirm that you are authorised to use “{avatar.name}” before animating it.")


def authorise(db: Session, avatar_id: str, body: AvatarAuthorisationIn) -> AvatarOut:
    avatar = get_avatar(db, avatar_id)
    _apply_consent(avatar, body.consent_subject, body.consent_relation, body.consent_confirmed)
    db.commit()
    return to_out(avatar)


def to_detail(avatar: Avatar) -> AvatarDetailOut:
    landmarks = json.loads(avatar.landmarks_json) if avatar.landmarks_json else None
    return AvatarDetailOut(**to_out(avatar).model_dump(), landmarks=landmarks)


def get_avatar(db: Session, avatar_id: str) -> Avatar:
    avatar = db.get(Avatar, avatar_id)
    if avatar is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Avatar not found.")
    return avatar


def list_avatars(db: Session) -> list[AvatarOut]:
    rows = db.query(Avatar).order_by(Avatar.favourite.desc(), Avatar.last_used_at.desc().nullslast(), Avatar.created_at.desc()).all()
    return [to_out(a) for a in rows]


async def _validated_image(upload: UploadFile) -> tuple[bytes, str, str, int, int]:
    settings = get_settings()
    if Path(upload.filename or "").suffix.lower() not in ALLOWED_EXTENSIONS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a JPG, JPEG, PNG or WEBP image.")
    data = await upload.read(settings.max_image_bytes + 1)
    if not data or len(data) > settings.max_image_bytes:
        raise HTTPException(413, "Images must be 10 MB or smaller.")
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()  # structural check without a full decode
        with Image.open(io.BytesIO(data)) as image:
            fmt, (width, height) = image.format, image.size
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise HTTPException(422, "This image is damaged or not a supported format.") from exc
    if fmt not in FORMATS:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use a JPG, JPEG, PNG or WEBP image.")
    if not (MIN_SIDE <= width <= MAX_SIDE and MIN_SIDE <= height <= MAX_SIDE):
        raise HTTPException(422, f"Image sides must be between {MIN_SIDE} and {MAX_SIDE} pixels.")
    mime, extension = FORMATS[fmt]
    return data, mime, extension, width, height


def _store(avatar: Avatar, data: bytes, mime: str, extension: str, width: int, height: int) -> None:
    folder = get_settings().avatars_dir
    old = folder / avatar.filename if avatar.filename else None
    filename = f"{avatar.id}{extension}"
    (folder / filename).write_bytes(data)
    if old and old.name != filename:
        old.unlink(missing_ok=True)
    avatar.filename, avatar.mime_type, avatar.width, avatar.height = filename, mime, width, height
    # Landmarks belong to the old picture; the renderer re-analyses the new one.
    avatar.landmarks_json, avatar.compatibility, avatar.compatibility_note = None, 0.0, "Analysing face…"


async def create_avatar(
    db: Session, upload: UploadFile, name: str | None, consent_subject: str, consent_relation: str, consent_confirmed: bool,
) -> AvatarOut:
    probe = Avatar(name="", filename="", mime_type="", width=0, height=0)
    _apply_consent(probe, consent_subject, consent_relation, consent_confirmed)  # refuse before storing anything
    data, mime, extension, width, height = await _validated_image(upload)
    default_name = Path(upload.filename or "Avatar").stem.replace("_", " ").strip()[:80] or "Avatar"
    avatar = Avatar(name=(name or "").strip()[:80] or default_name, filename="", mime_type=mime, width=width, height=height)
    avatar.consent_subject, avatar.consent_relation = probe.consent_subject, probe.consent_relation
    avatar.consent_statement, avatar.consent_at = probe.consent_statement, probe.consent_at
    db.add(avatar)
    db.flush()
    _store(avatar, data, mime, extension, width, height)
    db.commit()
    return to_out(avatar)


async def replace_image(db: Session, avatar_id: str, upload: UploadFile, consent_confirmed: bool) -> AvatarOut:
    avatar = get_avatar(db, avatar_id)
    # A new picture needs a fresh confirmation for the same person (as with voice samples).
    _apply_consent(avatar, avatar.consent_subject or "", avatar.consent_relation or "", consent_confirmed and bool(avatar.consent_subject))
    _store(avatar, *(await _validated_image(upload)))
    db.commit()
    return to_out(avatar)


def update_avatar(db: Session, avatar_id: str, patch: AvatarPatch) -> AvatarOut:
    avatar = get_avatar(db, avatar_id)
    for field, value in patch.model_dump(exclude_none=True).items():
        setattr(avatar, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    return to_out(avatar)


def set_landmarks(db: Session, avatar_id: str, body: AvatarLandmarksIn) -> AvatarOut:
    avatar = get_avatar(db, avatar_id)
    if body.landmarks is not None:
        if len(body.landmarks) < 468 or any(len(point) != 3 for point in body.landmarks):
            raise HTTPException(422, "Expected 468 or 478 landmarks of [x, y, z].")
        avatar.landmarks_json = json.dumps([[round(c, 5) for c in point] for point in body.landmarks])
    else:
        avatar.landmarks_json = None
    avatar.compatibility = body.compatibility
    avatar.compatibility_note = body.compatibility_note
    db.commit()
    return to_out(avatar)


def mark_used(db: Session, avatar_id: str) -> None:
    avatar = db.get(Avatar, avatar_id)
    if avatar:
        avatar.last_used_at = _now()
        db.commit()


def image_path(db: Session, avatar_id: str) -> tuple[Path, str]:
    avatar = get_avatar(db, avatar_id)
    path = get_settings().avatars_dir / avatar.filename
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The image file is missing.")
    return path, avatar.mime_type


def delete_avatar(db: Session, avatar_id: str) -> None:
    avatar = get_avatar(db, avatar_id)
    (get_settings().avatars_dir / avatar.filename).unlink(missing_ok=True)
    db.delete(avatar)
    db.commit()
