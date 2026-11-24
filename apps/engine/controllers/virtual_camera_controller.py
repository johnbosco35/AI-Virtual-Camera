"""Virtual camera output: the studio's final rendered frames -> a system webcam device other apps can select.

Windows 10 has no public API for creating a camera from user mode (the Media Foundation virtual camera API
needs Windows 11), so the frames go to an installed DirectShow virtual-camera filter through ``pyvirtualcam``:

* ``obs``           OBS Studio's "OBS Virtual Camera" (installed with OBS 26+; OBS itself need not run)
* ``unitycapture``  Unity Capture filter (open source, registered with regsvr32)

Only frames sent by the renderer are output: the final animated avatar. The raw webcam never reaches this
module. When no frame arrives for a second (studio closed, app minimised), a "paused" card is shown instead
of a frozen avatar.

Protocol (``/ws/virtual-camera``)
  client -> {"type": "start", "width", "height", "fps", "backend": "auto"|"obs"|"unitycapture", "format": "i420"|"rgba"}
  server -> {"type": "ready", "backend", "device", "width", "height", "fps", "format", "framePort", "frameToken"}
            | {"type": "error", "message"}
  client -> binary frames: I420 (width*height*3/2 bytes, converted on the GPU by the renderer; the default,
            because the local WebSocket path moves only ~18 MB/s on a slow 2-core CPU) or RGBA (width*height*4)
  server -> {"type": "stats", ...} about once per second

Frames can also arrive on a plain TCP socket (127.0.0.1:framePort): the client sends the 16-byte token,
then each frame as a 4-byte little-endian length plus the bytes. The desktop shell uses this path: the
asyncio WebSocket stack moves only ~7-18 MB/s on a slow 2-core CPU, a blocking socket reading straight
into a preallocated buffer is not the bottleneck.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import secrets
import socket
import struct
import sys
import threading
import time
from dataclasses import dataclass, field

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from config.security import websocket_token_ok

log = logging.getLogger("engine.vcam")

BACKENDS = {
    # name: (label, DirectShow filter CLSID used to detect the installation)
    "obs": ("OBS Virtual Camera", "{A3FCE0F5-3493-419F-958A-ABA1250EC20B}"),
    "unitycapture": ("Unity Video Capture", "{5C2CD55C-92AD-4999-8666-912BD3E70010}"),
}
STALE_SECONDS = 1.0
ALLOWED_SIZES = {(640, 360), (960, 540), (1280, 720), (1920, 1080)}


def _filter_registered(clsid: str) -> bool:
    if sys.platform != "win32":
        return False
    import winreg

    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, rf"CLSID\{clsid}\InprocServer32", 0, winreg.KEY_READ | view):
                return True
        except OSError:
            continue
    return False


def _pyvirtualcam_available() -> bool:
    try:
        import pyvirtualcam  # noqa: F401
    except Exception:  # noqa: BLE001
        return False
    return True


def backends() -> list[dict]:
    module = _pyvirtualcam_available()
    return [
        {"id": key, "label": label, "installed": _filter_registered(clsid), "usable": module and _filter_registered(clsid)}
        for key, (label, clsid) in BACKENDS.items()
    ]


def _placeholder(width: int, height: int) -> np.ndarray:
    """Dark card with a short message, shown when the studio stops sending frames."""
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGBA", (width, height), (9, 12, 19, 255))
    draw = ImageDraw.Draw(image)
    try:
        font = ImageFont.truetype("segoeui.ttf", max(14, height // 22))
    except OSError:
        font = ImageFont.load_default()
    text = "Avatar Studio · camera paused"
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(((width - (box[2] - box[0])) / 2, (height - (box[3] - box[1])) / 2), text, fill=(160, 166, 184, 255), font=font)
    return np.asarray(image, dtype=np.uint8).copy()


def rgba_to_i420(rgba: np.ndarray) -> np.ndarray:
    """BT.601 limited-range I420 (same matrix as the renderer's GPU converter)."""
    rgb = rgba[..., :3].astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    y = 16 + 0.257 * r + 0.504 * g + 0.098 * b
    sub = rgb.reshape(rgb.shape[0] // 2, 2, rgb.shape[1] // 2, 2, 3).mean(axis=(1, 3))
    sr, sg, sb = sub[..., 0], sub[..., 1], sub[..., 2]
    u = 128 - 0.148 * sr - 0.291 * sg + 0.439 * sb
    v = 128 + 0.439 * sr - 0.368 * sg - 0.071 * sb
    return np.concatenate([np.clip(np.rint(p), 0, 255).astype(np.uint8).ravel() for p in (y, u, v)])


FRAME_BYTES = {"rgba": lambda w, h: w * h * 4, "i420": lambda w, h: w * h * 3 // 2}


@dataclass
class _Output:
    width: int
    height: int
    fps: float
    backend: str
    format: str = "i420"
    device: str = ""
    latest: np.ndarray | None = None
    latest_at: float = 0.0
    frames_received: int = 0
    frames_sent: int = 0
    input_fps: float = 0.0
    output_fps: float = 0.0
    error: str = ""
    stop: threading.Event = field(default_factory=threading.Event)
    ready: threading.Event = field(default_factory=threading.Event)
    lock: threading.Lock = field(default_factory=threading.Lock)


class VirtualCameraService:
    """At most one output at a time (a DirectShow virtual camera has a single writer)."""

    def __init__(self, camera_factory=None):
        self._factory = camera_factory or self._pyvirtualcam_factory
        self._output: _Output | None = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self.last_error = ""

    @staticmethod
    def _pyvirtualcam_factory(width: int, height: int, fps: float, backend: str | None, fmt: str = "i420"):
        import pyvirtualcam

        pixel = pyvirtualcam.PixelFormat.I420 if fmt == "i420" else pyvirtualcam.PixelFormat.RGBA
        return pyvirtualcam.Camera(width=width, height=height, fps=fps, fmt=pixel, backend=backend, print_fps=False)

    # ------------------------------------------------------------------ lifecycle
    def start(self, width: int, height: int, fps: float, backend: str, fmt: str = "i420") -> _Output:
        if fmt not in FRAME_BYTES:
            raise ValueError("Frame format must be i420 or rgba.")
        if (width, height) not in ALLOWED_SIZES:
            raise ValueError("Unsupported virtual camera size.")
        if not 10 <= fps <= 60:
            raise ValueError("Frame rate must be between 10 and 60.")
        with self._lock:
            self._stop_locked()
            output = _Output(width=width, height=height, fps=fps, backend=backend, format=fmt)
            thread = threading.Thread(target=self._run, args=(output,), daemon=True, name="virtual-camera")
            self._output, self._thread = output, thread
            thread.start()
        output.ready.wait(timeout=10)
        if output.error:
            self.stop(output)
            raise RuntimeError(output.error)
        if not output.ready.is_set():
            self.stop(output)
            raise RuntimeError("The virtual camera did not start in time.")
        return output

    def stop(self, output: _Output | None = None) -> None:
        with self._lock:
            if output is None or output is self._output:
                self._stop_locked()

    def _stop_locked(self) -> None:
        if self._output is not None:
            self._output.stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=3)
        self._output, self._thread = None, None

    def push(self, output: _Output, frame: bytes) -> None:
        expected = FRAME_BYTES[output.format](output.width, output.height)
        if len(frame) != expected:
            raise ValueError(f"Frame must be {expected} bytes of {output.format.upper()}, got {len(frame)}.")
        array = np.frombuffer(frame, dtype=np.uint8)
        if output.format == "rgba":
            array = array.reshape(output.height, output.width, 4)
        with output.lock:
            output.latest = array
            output.latest_at = time.monotonic()
            output.frames_received += 1

    # ------------------------------------------------------------------ sender thread
    def _run(self, output: _Output) -> None:
        order = [output.backend] if output.backend != "auto" else [b["id"] for b in backends() if b["usable"]] or list(BACKENDS)
        camera = None
        errors = []
        for name in order:
            try:
                camera = self._factory(output.width, output.height, output.fps, name, output.format)
                output.backend = name
                output.device = getattr(camera, "device", "") or BACKENDS.get(name, (name,))[0]
                break
            except Exception as error:  # noqa: BLE001 - tried in order, reported together
                errors.append(f"{BACKENDS.get(name, (name,))[0]}: {error}")
        if camera is None:
            output.error = "No virtual camera driver could be opened. " + " | ".join(errors) if errors else "No virtual camera driver is installed."
            self.last_error = output.error
            output.ready.set()
            return
        self.last_error = ""
        # Prepared before signalling ready, so the first real frame is sent without delay.
        placeholder = _placeholder(output.width, output.height)
        if output.format == "i420":
            placeholder = rgba_to_i420(placeholder)
        output.ready.set()
        window_start, window_in, window_out = time.monotonic(), output.frames_received, 0
        try:
            while not output.stop.is_set():
                with output.lock:
                    frame = output.latest
                    fresh = frame is not None and time.monotonic() - output.latest_at < STALE_SECONDS
                camera.send(frame if fresh else placeholder)
                output.frames_sent += 1
                window_out += 1
                now = time.monotonic()
                if now - window_start >= 1.0:
                    output.input_fps = (output.frames_received - window_in) / (now - window_start)
                    output.output_fps = window_out / (now - window_start)
                    window_start, window_in, window_out = now, output.frames_received, 0
                camera.sleep_until_next_frame()
        except Exception as error:  # noqa: BLE001
            output.error = f"The virtual camera stopped: {error}"
            self.last_error = output.error
            log.exception("virtual camera sender failed")
        finally:
            try:
                camera.close()
            except Exception:  # noqa: BLE001
                pass

    # ------------------------------------------------------------------ status
    def status(self) -> dict:
        output = self._output
        return {
            "platform_supported": sys.platform == "win32",
            "backends": backends(),
            "active": output is not None and output.ready.is_set() and not output.error,
            "backend": output.backend if output else None,
            "device": output.device if output else None,
            "width": output.width if output else 0,
            "height": output.height if output else 0,
            "fps": output.fps if output else 0,
            "frames_received": output.frames_received if output else 0,
            "frames_sent": output.frames_sent if output else 0,
            "input_fps": round(output.input_fps, 1) if output else 0,
            "output_fps": round(output.output_fps, 1) if output else 0,
            "last_error": (output.error if output and output.error else self.last_error),
        }


service = VirtualCameraService()


class FrameSocket:
    """Token-authenticated local TCP listener that feeds frames to one output (see the module docstring)."""

    def __init__(self, svc: VirtualCameraService, output: _Output):
        self.svc, self.output = svc, output
        self.token = secrets.token_bytes(16)
        self.received = 0
        self.closed = threading.Event()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(1)
        self.listener.settimeout(0.5)
        self.port = self.listener.getsockname()[1]
        self.thread = threading.Thread(target=self._run, daemon=True, name="virtual-camera-frames")
        self.thread.start()

    def _stopped(self) -> bool:
        return self.closed.is_set() or self.output.stop.is_set()

    def _recv_into(self, conn: socket.socket, view: memoryview) -> bool:
        got = 0
        while got < len(view):
            if self._stopped():
                return False
            try:
                n = conn.recv_into(view[got:])
            except socket.timeout:
                continue
            if n == 0:
                return False
            got += n
        return True

    def _run(self) -> None:
        expected = FRAME_BYTES[self.output.format](self.output.width, self.output.height)
        frame = bytearray(expected)
        header = bytearray(4)
        token = bytearray(16)
        while not self._stopped():
            try:
                conn, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            conn.settimeout(0.5)
            conn.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
            try:
                if not self._recv_into(conn, memoryview(token)) or not hmac.compare_digest(bytes(token), self.token):
                    continue
                while self._recv_into(conn, memoryview(header)):
                    (length,) = struct.unpack("<I", header)
                    if length != expected:
                        log.warning("frame socket: wrong frame size %s (expected %s)", length, expected)
                        break
                    if not self._recv_into(conn, memoryview(frame)):
                        break
                    self.svc.push(self.output, bytes(frame))
                    self.received += 1
            except OSError:
                pass
            finally:
                conn.close()

    def close(self) -> None:
        self.closed.set()
        try:
            self.listener.close()
        except OSError:
            pass


async def handle_stream(websocket: WebSocket, svc: VirtualCameraService | None = None) -> None:
    svc = svc or service
    if not websocket_token_ok(websocket):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    try:
        start = await websocket.receive_json()
    except (WebSocketDisconnect, ValueError):
        return
    if start.get("type") != "start":
        await websocket.send_json({"type": "error", "message": "The first message must be a start message."})
        await websocket.close(code=1003)
        return
    try:
        output = await asyncio.to_thread(
            svc.start, int(start.get("width", 1280)), int(start.get("height", 720)), float(start.get("fps", 30)), str(start.get("backend", "auto")),
            str(start.get("format", "i420")),
        )
    except (ValueError, RuntimeError) as error:
        await websocket.send_json({"type": "error", "message": str(error)})
        await websocket.close(code=1011)
        return
    frames = FrameSocket(svc, output)
    await websocket.send_json({
        "type": "ready", "backend": output.backend, "device": output.device, "width": output.width, "height": output.height,
        "fps": output.fps, "format": output.format, "framePort": frames.port, "frameToken": frames.token.hex(),
    })
    last_stats, last_count = time.monotonic(), output.frames_received
    try:
        while True:
            try:
                message = await asyncio.wait_for(websocket.receive(), timeout=1.0)
            except asyncio.TimeoutError:
                message = None
            if message is not None:
                if message["type"] == "websocket.disconnect":
                    break
                if message.get("bytes") is not None:
                    svc.push(output, message["bytes"])
                elif message.get("text") and '"stop"' in message["text"]:
                    break
            if output.error:
                await websocket.send_json({"type": "error", "message": output.error})
                break
            now = time.monotonic()
            if now - last_stats >= 1.0:
                input_fps = (output.frames_received - last_count) / (now - last_stats)
                last_stats, last_count = now, output.frames_received
                status = svc.status()
                await websocket.send_json({"type": "stats", "inputFps": round(input_fps, 1), "outputFps": status["output_fps"], "framesSent": status["frames_sent"]})
    except (WebSocketDisconnect, RuntimeError):
        pass
    except ValueError as error:
        try:
            await websocket.send_json({"type": "error", "message": str(error)})
        except Exception:  # noqa: BLE001
            pass
    finally:
        frames.close()
        await asyncio.to_thread(svc.stop, output)
        try:
            await websocket.close()
        except Exception:  # noqa: BLE001
            pass
