"""Engine lifecycle: model download/load, hardware probe, benchmark and status reporting."""
from __future__ import annotations

import logging
import threading

from sqlalchemy.orm import Session

from config.database import SessionLocal
from config.settings import get_settings
from controllers import settings_controller, voice_controller
from models.ai import hardware
from models.ai.tone_converter import tone_model
from models.schemas import SystemStatus

log = logging.getLogger("engine.system")
ENGINE_VERSION = "1.0.0"
DEFAULT_BLOCK_MS = 600

_hardware: dict | None = None
_hardware_lock = threading.Lock()


def hardware_info() -> dict:
    global _hardware
    with _hardware_lock:
        if _hardware is None:
            _hardware = hardware.probe()
        return _hardware


def _after_model_ready() -> None:
    """Seed the library, then benchmark once so streaming can pick a block size."""
    if not tone_model.ready:
        return
    with SessionLocal() as db:
        voice_controller.seed_library(db)
        if settings_controller.get_value(db, "benchmark") is None:
            run_benchmark(db)


def _load_in_background() -> None:
    tone_model.load()
    _after_model_ready()


def startup() -> None:
    hardware_info()
    if tone_model.files_present():
        threading.Thread(target=_load_in_background, name="model-load", daemon=True).start()


def start_download() -> None:
    def job() -> None:
        tone_model.download()
        _after_model_ready()

    if tone_model.status.state not in {"downloading", "loading", "ready"}:
        threading.Thread(target=job, name="model-download", daemon=True).start()


def run_benchmark(db: Session) -> dict:
    result = tone_model.benchmark()
    settings_controller.set_value(db, "benchmark", result)
    log.info("Benchmark: RTF %.3f on %s", result["rtf"], result["device"])
    return result


def effective_block_ms(db: Session) -> tuple[int, bool]:
    """Block size for streaming and whether this PC can keep up in real time."""
    settings = get_settings()
    override = settings_controller.get_value(db, "block_ms_override") or settings.block_ms
    benchmark = settings_controller.get_value(db, "benchmark")
    realtime = True
    chosen = DEFAULT_BLOCK_MS
    if benchmark:
        block = hardware.choose_block_ms(benchmark["rtf"], settings.context_ms)
        realtime = block is not None
        chosen = block if block is not None else hardware.MAX_BLOCK_MS
    if override:
        chosen = int(override)
    return max(hardware.MIN_BLOCK_MS, min(hardware.MAX_BLOCK_MS, chosen)), realtime


def status(db: Session) -> SystemStatus:
    settings = get_settings()
    hw = hardware_info()
    benchmark = settings_controller.get_value(db, "benchmark")
    return SystemStatus(
        engine_version=ENGINE_VERSION,
        model_state=tone_model.status.state,  # type: ignore[arg-type]
        model_detail=tone_model.status.detail,
        download_progress=tone_model.status.progress,
        device=tone_model.device,
        torch_threads=settings.resolved_threads(),
        hardware=hw,
        benchmark=benchmark,
        requirements=hardware.requirements(hw, benchmark, tone_model.ready, settings.context_ms),
        source_voice_ready=voice_controller.source_voice(db) is not None,
    )
