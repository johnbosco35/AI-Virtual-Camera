from fastapi import APIRouter

from controllers import face_controller, virtual_camera_controller
from models.schemas import VirtualCameraStatus

router = APIRouter(prefix="/virtual-camera", tags=["outputs"])


@router.get("/status", response_model=VirtualCameraStatus)
def virtual_camera_status():
    return virtual_camera_controller.service.status()


face_router = APIRouter(prefix="/face", tags=["animation"])


@face_router.get("/status")
def face_status():
    """Neural reenactment (LivePortrait): weights present, loaded state and device."""
    return face_controller.status()


@face_router.post("/download", status_code=202)
def face_download():
    face_controller.start_download()
    return face_controller.status()
