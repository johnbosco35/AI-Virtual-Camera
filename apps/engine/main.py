"""AI Avatar Studio engine: local FastAPI service for voice conversion and studio data.

Run:  python main.py                 (serve on 127.0.0.1:8765)
      python main.py --download-models
"""
from __future__ import annotations

import argparse
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from config.database import init_db  # noqa: E402
from config.settings import get_settings  # noqa: E402
from controllers import recording_controller, system_controller  # noqa: E402
from controllers.virtual_camera_controller import service as virtual_camera  # noqa: E402
from routes import api_router, ws_router  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    recording_controller.recover_interrupted()
    system_controller.startup()
    yield
    virtual_camera.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="AI Avatar Studio Engine", version=system_controller.ENGINE_VERSION, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=settings.allowed_origin_regex,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["content-type", "x-avs-token"],
        expose_headers=["x-ai-generated"],
    )

    @app.get("/health")
    def health():
        return {"ok": True, "version": system_controller.ENGINE_VERSION}

    app.include_router(api_router)
    app.include_router(ws_router)
    return app


app = create_app()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-models", action="store_true", help="download OpenVoice V2 weights and exit")
    args = parser.parse_args()
    if args.download_models:
        from models.ai.tone_converter import tone_model

        tone_model.download()
        print(tone_model.status.state, tone_model.status.detail)
        sys.exit(0 if tone_model.ready else 1)

    import uvicorn

    s = get_settings()
    # Raw video frames and PCM do not compress; per-message deflate would cost more CPU than the whole conversion.
    uvicorn.run(app, host=s.host, port=s.port, log_level="info", ws_max_size=s.ws_max_bytes, ws_per_message_deflate=False)
