"""Local-only access control: the desktop shell passes a per-launch token to the engine and the renderer."""
from __future__ import annotations

import hmac

from fastapi import HTTPException, Request, WebSocket, status

from config.settings import get_settings


def _token_ok(candidate: str | None) -> bool:
    expected = get_settings().token
    if not expected:
        return True
    return bool(candidate) and hmac.compare_digest(candidate, expected)


def require_token(request: Request) -> None:
    """HTTP dependency. Media elements cannot send headers, so ``?token=`` is accepted too."""
    candidate = request.headers.get("x-avs-token") or request.query_params.get("token")
    if not _token_ok(candidate):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing or invalid engine token.")


def websocket_token_ok(websocket: WebSocket) -> bool:
    return _token_ok(websocket.query_params.get("token"))
