from fastapi import APIRouter, Depends, WebSocket

from config.security import require_token
from controllers import conversion_controller, face_controller, virtual_camera_controller
from routes import avatar_routes, output_routes, recording_routes, session_routes, system_routes, voice_routes

api_router = APIRouter(prefix="/api", dependencies=[Depends(require_token)])
api_router.include_router(system_routes.router)
api_router.include_router(avatar_routes.router)
api_router.include_router(voice_routes.router)
api_router.include_router(session_routes.router)
api_router.include_router(recording_routes.router)
api_router.include_router(output_routes.router)
api_router.include_router(output_routes.face_router)

ws_router = APIRouter()


@ws_router.websocket("/ws/convert")
async def convert_stream(websocket: WebSocket):
    # The token is checked inside the controller (WebSockets cannot use HTTP dependencies for headers).
    await conversion_controller.handle_stream(websocket)


@ws_router.websocket("/ws/face")
async def face_stream(websocket: WebSocket):
    await face_controller.handle_stream(websocket)


@ws_router.websocket("/ws/virtual-camera")
async def virtual_camera_stream(websocket: WebSocket):
    await virtual_camera_controller.handle_stream(websocket)


__all__ = ["api_router", "ws_router"]
