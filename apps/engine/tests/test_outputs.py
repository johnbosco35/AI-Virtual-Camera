"""Recordings (chunked upload, ffmpeg post-processing, export) and the virtual camera service/protocol."""
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

import main
from controllers import virtual_camera_controller as vcam
from models.ai.audio_io import _ffmpeg_exe

AUTH = {"X-AVS-Token": "test-token"}


def make_webm(seconds: float = 2.0) -> bytes:
    """A real VP8/Opus WebM like MediaRecorder produces (ffmpeg test pattern + tone)."""
    path = Path(tempfile.mkdtemp()) / "clip.webm"
    subprocess.run(
        [_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15",
         "-f", "lavfi", "-i", "sine=frequency=440", "-t", str(seconds), "-c:v", "libvpx", "-c:a", "libopus", "-f", "webm", "-y", str(path)],
        check=True,
    )
    return path.read_bytes()


class RecordingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ctx = TestClient(main.app)
        cls.client = cls.ctx.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.ctx.__exit__(None, None, None)

    def wait_ready(self, recording_id, timeout=60):
        deadline = time.time() + timeout
        while time.time() < deadline:
            r = self.client.get(f"/api/recordings/{recording_id}", headers=AUTH).json()
            if r["status"] not in ("recording", "processing"):
                return r
            time.sleep(0.2)
        self.fail("recording did not finish processing")

    def upload(self, data: bytes, requested: str):
        r = self.client.post("/api/recordings", headers=AUTH, json={
            "mime_type": "video/webm;codecs=vp8,opus", "requested_format": requested, "width": 320, "height": 180,
            "avatar_name": "Ada", "voice_name": "Narrator",
        })
        self.assertEqual(r.status_code, 201, r.text)
        rec = r.json()
        self.assertEqual(rec["status"], "recording")
        # MediaRecorder delivers timesliced chunks; send in three parts.
        third = len(data) // 3
        for piece in (data[:third], data[third:2 * third], data[2 * third:]):
            r = self.client.post(f"/api/recordings/{rec['id']}/chunks", headers={**AUTH, "content-type": "application/octet-stream"}, content=piece)
            self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["size_bytes"], len(data))
        r = self.client.post(f"/api/recordings/{rec['id']}/finish", headers=AUTH, json={"duration_seconds": 2.0})
        self.assertEqual(r.json()["status"], "processing")
        return self.wait_ready(rec["id"])

    def test_webm_recording_transcoded_to_mp4_and_both_formats_kept(self):
        rec = self.upload(make_webm(), "mp4")
        self.assertEqual(rec["status"], "ready", rec["status_detail"])
        self.assertEqual(rec["format"], "mp4")
        self.assertEqual(sorted(rec["available_formats"]), ["mp4", "webm"])
        self.assertAlmostEqual(rec["duration_seconds"], 2.0, delta=0.3)
        media = self.client.get(f"/api/recordings/{rec['id']}/media?format=mp4&download=true", headers=AUTH)
        self.assertEqual(media.status_code, 200)
        self.assertEqual(media.headers["content-type"], "video/mp4")
        self.assertIn("attachment", media.headers["content-disposition"])
        self.assertEqual(media.content[4:8], b"ftyp")
        # Range requests work (seeking in the player).
        part = self.client.get(f"/api/recordings/{rec['id']}/media", headers={**AUTH, "Range": "bytes=0-99"})
        self.assertEqual(part.status_code, 206)
        self.assertEqual(len(part.content), 100)

    def test_webm_recording_export_rename_delete(self):
        rec = self.upload(make_webm(1.0), "webm")
        self.assertEqual(rec["status"], "ready", rec["status_detail"])
        self.assertEqual(rec["available_formats"], ["webm"])
        r = self.client.post(f"/api/recordings/{rec['id']}/export?format=mp4", headers=AUTH)
        self.assertEqual(r.json()["status"], "processing")
        rec = self.wait_ready(rec["id"])
        self.assertEqual(sorted(rec["available_formats"]), ["mp4", "webm"])
        r = self.client.patch(f"/api/recordings/{rec['id']}", headers=AUTH, json={"name": "Team call"})
        self.assertEqual(r.json()["name"], "Team call")
        self.assertEqual(self.client.delete(f"/api/recordings/{rec['id']}", headers=AUTH).status_code, 204)
        self.assertEqual(self.client.get(f"/api/recordings/{rec['id']}", headers=AUTH).status_code, 404)

    def test_finish_without_data_fails_cleanly_and_chunks_after_finish_are_rejected(self):
        rec = self.client.post("/api/recordings", headers=AUTH, json={"mime_type": "video/webm", "requested_format": "webm"}).json()
        r = self.client.post(f"/api/recordings/{rec['id']}/finish", headers=AUTH, json={"duration_seconds": 0})
        self.assertEqual(r.json()["status"], "failed")
        r = self.client.post(f"/api/recordings/{rec['id']}/chunks", headers=AUTH, content=b"x")
        self.assertEqual(r.status_code, 409)

    def test_rejects_non_video_mime_and_bad_formats(self):
        r = self.client.post("/api/recordings", headers=AUTH, json={"mime_type": "text/html", "requested_format": "mp4"})
        self.assertEqual(r.status_code, 422)
        r = self.client.post("/api/recordings", headers=AUTH, json={"mime_type": "video/webm", "requested_format": "avi"})
        self.assertEqual(r.status_code, 422)

    def test_new_output_settings_are_validated(self):
        r = self.client.patch("/api/settings", headers=AUTH, json={"values": {"output_resolution": "540p", "output_fps": 24, "preserve_background": False}})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["output_resolution"], "540p")
        self.assertEqual(self.client.patch("/api/settings", headers=AUTH, json={"values": {"output_resolution": "4k"}}).status_code, 422)
        self.assertEqual(self.client.patch("/api/settings", headers=AUTH, json={"values": {"output_fps": 500}}).status_code, 422)
        self.client.patch("/api/settings", headers=AUTH, json={"values": {"output_resolution": "720p", "output_fps": 30, "preserve_background": True}})


class NeuralAnimationTests(unittest.TestCase):
    def test_status_and_cpu_refusal(self):
        import torch
        with TestClient(main.app) as client:
            status = client.get("/api/face/status", headers=AUTH).json()
            self.assertIn("weights", status)
            self.assertEqual(status["cuda"], torch.cuda.is_available())
            if not torch.cuda.is_available():
                with client.websocket_connect("/ws/face?token=test-token") as ws:
                    ws.send_json({"type": "start"})
                    message = ws.receive_json()
                    self.assertEqual(message["type"], "error")
                    self.assertIn("CUDA", message["message"])
            r = client.patch("/api/settings", headers=AUTH, json={"values": {"animation_engine": "neural"}})
            self.assertEqual(r.status_code, 200)
            self.assertEqual(client.patch("/api/settings", headers=AUTH, json={"values": {"animation_engine": "deepfake"}}).status_code, 422)
            client.patch("/api/settings", headers=AUTH, json={"values": {"animation_engine": "mesh"}})


class FakeCamera:
    """Stands in for pyvirtualcam.Camera and records what would reach the driver."""

    instances = []

    def __init__(self, width, height, fps, backend, fmt="i420"):
        if backend == "broken":
            raise RuntimeError("driver not installed")
        self.width, self.height, self.fps, self.backend, self.fmt = width, height, fps, backend, fmt
        self.device = "Fake Cam"
        self.sent = []
        self.closed = False
        FakeCamera.instances.append(self)

    def send(self, frame):
        assert frame.dtype == np.uint8
        expected = self.width * self.height * 4 if self.fmt == "rgba" else self.width * self.height * 3 // 2
        assert frame.size == expected, (frame.size, expected)
        self.sent.append(frame.copy())

    def sleep_until_next_frame(self):
        time.sleep(1 / self.fps)

    def close(self):
        self.closed = True


class VirtualCameraTests(unittest.TestCase):
    def setUp(self):
        FakeCamera.instances = []
        self.service = vcam.VirtualCameraService(camera_factory=FakeCamera)

    def tearDown(self):
        self.service.stop()

    def test_outputs_latest_frame_then_placeholder_when_stale(self):
        out = self.service.start(640, 360, 30, "obs", "rgba")
        frame = np.full((360, 640, 4), 200, dtype=np.uint8)
        self.service.push(out, frame.tobytes())
        time.sleep(0.25)
        cam = FakeCamera.instances[0]
        self.assertTrue(any((f == 200).all() for f in cam.sent), "the pushed avatar frame reached the camera")
        time.sleep(vcam.STALE_SECONDS + 0.3)
        self.assertFalse((cam.sent[-1] == 200).all(), "a stale frame is replaced by the paused card, not frozen")
        self.service.stop()
        self.assertTrue(cam.closed)

    def test_i420_frames_and_placeholder(self):
        out = self.service.start(640, 360, 30, "obs", "i420")
        self.service.push(out, bytes([90]) * (640 * 360 * 3 // 2))
        time.sleep(0.5)
        cam = FakeCamera.instances[0]
        self.assertTrue(any((f == 90).all() for f in cam.sent))
        time.sleep(vcam.STALE_SECONDS + 0.3)
        self.assertFalse((cam.sent[-1] == 90).all(), "stale I420 frames are replaced by the paused card")
        # BT.601 limited range: mid grey stays neutral (U = V = 128), black maps to Y = 16.
        grey = vcam.rgba_to_i420(np.full((4, 4, 4), 128, dtype=np.uint8))
        self.assertEqual(len(grey), 24)
        self.assertTrue(all(abs(int(v) - 128) <= 1 for v in grey[16:]))
        self.assertEqual(int(vcam.rgba_to_i420(np.zeros((2, 2, 4), dtype=np.uint8))[0]), 16)

    def test_rejects_wrong_frame_size_and_unsupported_sizes(self):
        out = self.service.start(640, 360, 30, "obs")
        with self.assertRaises(ValueError):
            self.service.push(out, b"\x00" * 100)
        with self.assertRaises(ValueError):
            self.service.start(123, 45, 30, "obs")

    def test_reports_driver_errors(self):
        with self.assertRaises(RuntimeError) as ctx:
            self.service.start(640, 360, 30, "broken")
        self.assertIn("driver not installed", str(ctx.exception))
        self.assertIn("driver not installed", self.service.status()["last_error"])

    def test_websocket_protocol_end_to_end(self):
        original = vcam.service
        vcam.service = self.service
        try:
            with TestClient(main.app) as client:
                with self.assertRaises(Exception):
                    with client.websocket_connect("/ws/virtual-camera?token=wrong") as ws:
                        ws.receive_json()
                with client.websocket_connect("/ws/virtual-camera?token=test-token") as ws:
                    ws.send_json({"type": "start", "width": 640, "height": 360, "fps": 30, "backend": "obs", "format": "rgba"})
                    ready = ws.receive_json()
                    self.assertEqual(ready["type"], "ready")
                    self.assertEqual(ready["device"], "Fake Cam")
                    frame = np.full((360, 640, 4), 77, dtype=np.uint8).tobytes()
                    for _ in range(40):
                        ws.send_bytes(frame)
                        time.sleep(1 / 30)
                    stats = ws.receive_json()
                    self.assertEqual(stats["type"], "stats")
                    self.assertGreater(stats["inputFps"], 0)  # throughput itself is machine-dependent
                    status = client.get("/api/virtual-camera/status", headers=AUTH).json()
                    self.assertTrue(status["active"])
                    self.assertGreater(status["frames_received"], 20)
                    ws.send_text('{"type": "stop"}')
                time.sleep(0.2)
                self.assertTrue(FakeCamera.instances[0].closed)
                self.assertTrue(any((f == 77).all() for f in FakeCamera.instances[0].sent))
        finally:
            vcam.service = original

    def test_frame_socket_path_requires_token_and_delivers_frames(self):
        import socket as sock
        import struct
        original = vcam.service
        vcam.service = self.service
        try:
            with TestClient(main.app) as client:
                with client.websocket_connect("/ws/virtual-camera?token=test-token") as ws:
                    ws.send_json({"type": "start", "width": 640, "height": 360, "fps": 30, "backend": "obs", "format": "i420"})
                    ready = ws.receive_json()
                    size = 640 * 360 * 3 // 2
                    # Wrong token: connection is dropped, nothing delivered.
                    bad = sock.create_connection(("127.0.0.1", ready["framePort"]))
                    bad.sendall(b"x" * 16 + struct.pack("<I", size) + bytes([55]) * size)
                    bad.close()
                    good = sock.create_connection(("127.0.0.1", ready["framePort"]))
                    good.sendall(bytes.fromhex(ready["frameToken"]))
                    for _ in range(20):
                        good.sendall(struct.pack("<I", size) + bytes([66]) * size)
                        time.sleep(1 / 30)
                    time.sleep(0.3)
                    status = client.get("/api/virtual-camera/status", headers=AUTH).json()
                    self.assertGreaterEqual(status["frames_received"], 15)
                    good.close()
                    ws.send_text('{"type": "stop"}')
            sent = FakeCamera.instances[0].sent
            self.assertTrue(any((f == 66).all() for f in sent))
            self.assertFalse(any((f == 55).all() for f in sent), "frames with a wrong token never reach the camera")
        finally:
            vcam.service = original

    def test_backend_detection_reports_both_drivers(self):
        ids = [b["id"] for b in vcam.backends()]
        self.assertEqual(ids, ["obs", "unitycapture"])


if __name__ == "__main__":
    unittest.main()
