"""HTTP API tests (routes → controllers → models) against a temporary database."""
import io
import unittest

from fastapi.testclient import TestClient
from PIL import Image

import main

AUTH = {"X-AVS-Token": "test-token"}


def png_bytes(size=(256, 256), color=(200, 160, 140)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


class ApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ctx = TestClient(main.app)
        cls.client = cls.ctx.__enter__()  # runs the lifespan (creates tables)

    @classmethod
    def tearDownClass(cls):
        cls.ctx.__exit__(None, None, None)

    def test_health_is_public_but_api_requires_the_token(self):
        self.assertEqual(self.client.get("/health").status_code, 200)
        self.assertEqual(self.client.get("/api/avatars").status_code, 401)
        self.assertEqual(self.client.get("/api/avatars", headers={"X-AVS-Token": "wrong"}).status_code, 401)
        self.assertEqual(self.client.get("/api/avatars?token=test-token").status_code, 200)

    def test_status_reports_missing_model_and_requirements(self):
        status = self.client.get("/api/system/status", headers=AUTH).json()
        self.assertEqual(status["model_state"], "missing")
        self.assertTrue(any(r["id"] == "cpu" for r in status["requirements"]))

    def test_avatar_lifecycle(self):
        r = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": "true"}, files={"file": ("my_portrait.png", png_bytes(), "image/png")})
        self.assertEqual(r.status_code, 201, r.text)
        avatar = r.json()
        self.assertTrue(avatar["authorised"])
        self.assertEqual(avatar["consent_relation"], "self")
        self.assertEqual(avatar["name"], "my portrait")
        self.assertFalse(avatar["has_landmarks"])
        self.assertTrue(avatar["compatibility_note"].startswith("Analysing"))

        landmarks = [[0.5, 0.5, 0.0]] * 478
        r = self.client.put(f"/api/avatars/{avatar['id']}/landmarks", headers=AUTH, json={"landmarks": landmarks, "compatibility": 0.8, "compatibility_note": "ok"})
        self.assertTrue(r.json()["has_landmarks"])
        detail = self.client.get(f"/api/avatars/{avatar['id']}", headers=AUTH).json()
        self.assertEqual(len(detail["landmarks"]), 478)

        r = self.client.patch(f"/api/avatars/{avatar['id']}", headers=AUTH, json={"name": "Renamed", "favourite": True})
        self.assertEqual(r.json()["name"], "Renamed")
        image = self.client.get(f"/api/avatars/{avatar['id']}/image", headers=AUTH)
        self.assertEqual(image.headers["content-type"], "image/png")

        unconfirmed = self.client.put(f"/api/avatars/{avatar['id']}/image", headers=AUTH, files={"file": ("new.png", png_bytes((300, 300)), "image/png")})
        self.assertEqual(unconfirmed.status_code, 403, "a replacement picture needs a fresh confirmation")
        r = self.client.put(f"/api/avatars/{avatar['id']}/image", headers=AUTH, data={"consent_confirmed": "true"}, files={"file": ("new.png", png_bytes((300, 300)), "image/png")})
        self.assertEqual(r.json()["width"], 300)
        self.assertFalse(r.json()["has_landmarks"], "replacing the picture must invalidate its landmarks")

        self.assertEqual(self.client.delete(f"/api/avatars/{avatar['id']}", headers=AUTH).status_code, 204)
        self.assertEqual(self.client.get(f"/api/avatars/{avatar['id']}", headers=AUTH).status_code, 404)

    def test_avatar_validation(self):
        bad_type = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": "true"}, files={"file": ("x.gif", b"GIF89a", "image/gif")})
        self.assertEqual(bad_type.status_code, 415)
        fake = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": "true"}, files={"file": ("x.png", b"not an image", "image/png")})
        self.assertEqual(fake.status_code, 422)
        tiny = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": "true"}, files={"file": ("x.png", png_bytes((32, 32)), "image/png")})
        self.assertEqual(tiny.status_code, 422)
        r = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": "true"}, files={"file": ("ok.png", png_bytes(), "image/png")})
        bad_landmarks = self.client.put(f"/api/avatars/{r.json()['id']}/landmarks", headers=AUTH, json={"landmarks": [[0, 0, 0]] * 10, "compatibility": 0.5})
        self.assertEqual(bad_landmarks.status_code, 422)

    def test_portraits_require_authorisation(self):
        r = self.client.post("/api/avatars", headers=AUTH, files={"file": ("someone.png", png_bytes(), "image/png")})
        self.assertEqual(r.status_code, 403, "uploads without authorisation are refused")
        r = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Ada", "consent_relation": "stolen", "consent_confirmed": "true"}, files={"file": ("a.png", png_bytes(), "image/png")})
        self.assertEqual(r.status_code, 403)
        r = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Ada", "consent_relation": "authorised", "consent_confirmed": "true"}, files={"file": ("a.png", png_bytes(), "image/png")})
        self.assertEqual(r.status_code, 201, r.text)
        self.assertIn("Ada", r.json()["consent_subject"])

    def test_unauthorised_legacy_portrait_cannot_start_a_session_until_confirmed(self):
        from config.database import SessionLocal
        from models import Avatar
        r = self.client.post("/api/avatars", headers=AUTH, data={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": "true"}, files={"file": ("legacy.png", png_bytes(), "image/png")})
        avatar_id = r.json()["id"]
        with SessionLocal() as db:  # simulate a portrait uploaded before authorisation existed
            row = db.get(Avatar, avatar_id)
            row.consent_at, row.consent_subject, row.consent_relation = None, "", ""
            db.commit()
        self.assertFalse(self.client.get(f"/api/avatars/{avatar_id}", headers=AUTH).json()["authorised"])
        self.assertEqual(self.client.post("/api/sessions", headers=AUTH, json={"avatar_id": avatar_id}).status_code, 403)
        r = self.client.put(f"/api/avatars/{avatar_id}/authorisation", headers=AUTH, json={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": False})
        self.assertEqual(r.status_code, 403)
        r = self.client.put(f"/api/avatars/{avatar_id}/authorisation", headers=AUTH, json={"consent_subject": "Me", "consent_relation": "self", "consent_confirmed": True})
        self.assertTrue(r.json()["authorised"])
        self.assertEqual(self.client.post("/api/sessions", headers=AUTH, json={"avatar_id": avatar_id}).status_code, 201)

    def test_voice_cloning_requires_authorisation(self):
        form = {"name": "Someone", "consent_subject": "Someone", "consent_relation": "authorised", "consent_confirmed": "false"}
        r = self.client.post("/api/voices", headers=AUTH, data=form, files={"file": ("s.wav", b"RIFF0000WAVE", "audio/wav")})
        self.assertEqual(r.status_code, 403)
        form["consent_relation"] = "stolen"
        form["consent_confirmed"] = "true"
        r = self.client.post("/api/voices", headers=AUTH, data=form, files={"file": ("s.wav", b"RIFF0000WAVE", "audio/wav")})
        self.assertEqual(r.status_code, 422)

    def test_voice_creation_needs_the_model(self):
        form = {"name": "Me", "consent_subject": "Me", "consent_relation": "self", "consent_confirmed": "true"}
        r = self.client.post("/api/voices", headers=AUTH, data=form, files={"file": ("s.wav", b"RIFF0000WAVE", "audio/wav")})
        self.assertEqual(r.status_code, 503)

    def test_settings_roundtrip_and_validation(self):
        r = self.client.patch("/api/settings", headers=AUTH, json={"values": {"smoothing": 0.8, "lip_sync_mode": "audio"}})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["smoothing"], 0.8)
        self.assertEqual(self.client.patch("/api/settings", headers=AUTH, json={"values": {"nope": 1}}).status_code, 422)
        self.assertEqual(self.client.patch("/api/settings", headers=AUTH, json={"values": {"benchmark": {}}}).status_code, 422)
        self.assertEqual(self.client.patch("/api/settings", headers=AUTH, json={"values": {"smoothing": "high"}}).status_code, 422)

    def test_sessions_record_history_with_utc_times(self):
        started = self.client.post("/api/sessions", headers=AUTH, json={}).json()
        self.assertTrue(started["started_at"].endswith(("+00:00", "Z")), started["started_at"])
        ended = self.client.post(f"/api/sessions/{started['id']}/end", headers=AUTH, json={"duration_seconds": 12.5, "avg_latency_ms": 420, "avg_tracking_fps": 28, "voice_seconds": 6, "blocks_dropped": 0}).json()
        self.assertEqual(ended["duration_seconds"], 12.5)
        self.assertIsNotNone(ended["ended_at"])
        recent = self.client.get("/api/sessions", headers=AUTH).json()
        self.assertEqual(recent[0]["id"], started["id"])

    def test_websocket_rejects_missing_token_and_unready_model(self):
        from starlette.websockets import WebSocketDisconnect

        with self.assertRaises(WebSocketDisconnect):
            with self.client.websocket_connect("/ws/convert") as ws:
                ws.receive_text()
        with self.client.websocket_connect("/ws/convert?token=test-token") as ws:
            ws.send_json({"type": "start", "voiceId": "lib-en-us", "sampleRate": 48000})
            message = ws.receive_json()
            self.assertEqual(message["type"], "error")


if __name__ == "__main__":
    unittest.main()
