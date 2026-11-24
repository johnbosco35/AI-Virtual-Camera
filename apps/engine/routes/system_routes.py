from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from config.database import get_db
from controllers import settings_controller, system_controller
from models.ai.tone_converter import tone_model
from models.schemas import SettingsPatch, SystemStatus

router = APIRouter(tags=["system"])


@router.get("/system/status", response_model=SystemStatus)
def get_status(db: Session = Depends(get_db)):
    return system_controller.status(db)


@router.post("/system/models/download", status_code=202)
def download_models():
    system_controller.start_download()
    return {"state": tone_model.status.state}


@router.post("/system/benchmark")
def benchmark(db: Session = Depends(get_db)):
    if not tone_model.ready:
        raise HTTPException(503, tone_model.status.detail or "The voice model is not ready.")
    return system_controller.run_benchmark(db)


@router.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    return settings_controller.get_all(db)


@router.patch("/settings")
def update_settings(body: SettingsPatch, db: Session = Depends(get_db)):
    try:
        return settings_controller.update(db, body.values)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
