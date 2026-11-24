"""Neural reenactment stream (LivePortrait) over a WebSocket.

Protocol (``/ws/face``)
  client -> text   {"type": "start", "expressionGain": float, "headGain": float}
  client -> binary 1 tag byte + JPEG of a 256x256 aligned face crop:
                   0x01 source (the portrait, once), 0x02 neutral reference (the user at rest), 0x03 live frame
                   live frames carry a 4-byte little-endian sequence number after the tag
  server -> text   {"type": "ready", "device"} | {"type": "error", "message"} | {"type": "stats", "ms", "fps"}
  server -> binary 0x03 + 4-byte sequence + JPEG of the animated 512x512 crop

Only the newest live frame is processed: if inference is slower than the camera, frames are skipped rather
than queued, so the face never lags further behind.
"""
from __future__ import annotations

import asyncio
import json
import logging
import struct
import threading
import time

from fastapi import WebSocket, WebSocketDisconnect

from config.security import websocket_token_ok
from models.ai.face_generator import decode_jpeg, encode_jpeg, face_generator, weights_present

log = logging.getLogger("engine.face")
TAG_SOURCE, TAG_NEUTRAL, TAG_FRAME = 1, 2, 3
_download_lock = threading.Lock()


def status() -> dict:
    import torch

    s = face_generator.status
    return {
        "weights": weights_present(), "state": s.state, "detail": s.detail, "device": s.device,
        "cuda": torch.cuda.is_available(),
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        "last_ms": None if s.last_ms is None else round(s.last_ms, 1), "frames": s.frames,
    }


def start_download() -> None:
    def job() -> None:
        with _download_lock:
            try:
                face_generator.download()
            except Exception:  # noqa: BLE001 - status carries the message
                log.exception("LivePortrait download failed")

    if face_generator.status.state != "downloading":
        threading.Thread(target=job, daemon=True, name="liveportrait-download").start()


async def handle_stream(websocket: WebSocket) -> None:
    if not websocket_token_ok(websocket):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        start = json.loads(await websocket.receive_text())
    except (WebSocketDisconnect, ValueError):
        return
    if start.get("type") != "start":
        await websocket.send_json({"type": "error", "message": "The first message must be a start message."})
        await websocket.close(code=1003)
        return
    import torch

    if not torch.cuda.is_available() and not start.get("allowCpu"):
        await websocket.send_json({"type": "error", "message": "Neural animation needs an NVIDIA (CUDA) GPU for live use; on this PC it would take minutes per frame."})
        await websocket.close(code=1011)
        return
    try:
        await asyncio.to_thread(face_generator.load)
    except Exception as error:  # noqa: BLE001
        await websocket.send_json({"type": "error", "message": str(error)})
        await websocket.close(code=1011)
        return
    gains = {"expression": float(start.get("expressionGain", 1.0)), "head": float(start.get("headGain", 1.0))}
    await websocket.send_json({"type": "ready", "device": face_generator.device.type})

    state: dict = {"source": None, "neutral": None, "latest": None}
    wake = asyncio.Event()
    closed = asyncio.Event()

    async def worker() -> None:
        frames, window = 0, time.monotonic()
        while not closed.is_set():
            await wake.wait()
            wake.clear()
            item, state["latest"] = state["latest"], None
            if item is None or state["source"] is None or state["neutral"] is None:
                continue
            seq, jpeg = item
            try:
                def run():
                    driving = face_generator.driving_info(decode_jpeg(jpeg))
                    image = face_generator.animate(state["source"], state["neutral"], driving, gains["expression"], gains["head"])
                    return encode_jpeg(image)
                out = await asyncio.to_thread(run)
                await websocket.send_bytes(bytes([TAG_FRAME]) + struct.pack("<I", seq) + out)
            except (WebSocketDisconnect, RuntimeError):
                return
            except Exception as error:  # noqa: BLE001
                log.exception("face frame failed")
                await websocket.send_json({"type": "error", "message": f"Animation failed: {error}", "fatal": False})
            frames += 1
            now = time.monotonic()
            if now - window >= 1.0:
                await websocket.send_json({"type": "stats", "ms": face_generator.status.last_ms, "fps": round(frames / (now - window), 1)})
                frames, window = 0, now

    task = asyncio.create_task(worker())
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            data = message.get("bytes")
            if data:
                tag, payload = data[0], data[1:]
                if tag == TAG_SOURCE:
                    state["source"] = await asyncio.to_thread(lambda: face_generator.prepare_source(decode_jpeg(payload)))
                elif tag == TAG_NEUTRAL:
                    state["neutral"] = await asyncio.to_thread(lambda: face_generator.driving_info(decode_jpeg(payload)))
                elif tag == TAG_FRAME and len(payload) > 4:
                    (seq,) = struct.unpack("<I", payload[:4])
                    state["latest"] = (seq, payload[4:])
                    wake.set()
            elif message.get("text"):
                body = json.loads(message["text"])
                if body.get("type") == "stop":
                    break
                if body.get("type") == "gains":
                    gains["expression"] = float(body.get("expressionGain", gains["expression"]))
                    gains["head"] = float(body.get("headGain", gains["head"]))
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        closed.set()
        wake.set()
        task.cancel()
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
