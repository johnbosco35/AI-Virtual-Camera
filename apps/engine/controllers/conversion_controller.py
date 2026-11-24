"""Real-time speech-to-speech conversion over a WebSocket.

Protocol
--------
Client → server
  text   {"type": "start", "voiceId": str, "sampleRate": int}
  binary little-endian int16 mono PCM at ``sampleRate`` (any frame size; ~20 ms recommended)
  text   {"type": "voice", "voiceId": str}         switch voice mid-session
  text   {"type": "stop"}

Server → client
  text   {"type": "ready", "outputSampleRate", "blockMs", "latencyMs", "realtime", "calibrated", "voiceId"}
  binary converted block (see ``PACKET_HEADER``), followed by float32 audio and float32 visemes
  text   {"type": "stats", ...} about once per second, {"type": "voice", ...}, {"type": "error", "message"}
"""
from __future__ import annotations

import asyncio
import json
import logging
import struct
import time

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from config.database import SessionLocal
from config.security import websocket_token_ok
from config.settings import get_settings
from controllers import system_controller, voice_controller
from models.ai.streaming import ConvertedBlock, StreamingVoiceConverter
from models.ai.tone_converter import tone_model

log = logging.getLogger("engine.convert")

# magic, seq, input_end, rtf, n_samples, n_visemes, flags, viseme_hop_seconds  (28 bytes, 4-byte aligned)
PACKET_HEADER = struct.Struct("<4sIIfIHHf")
MAGIC = b"AVS1"
FLAG_VOICED, FLAG_CALIBRATED = 1, 2
LIVE_BACKLOG_BLOCKS = 2
BUFFERED_BACKLOG_SECONDS = 8.0
BUFFERED_CONTEXT_MS = 200


def encode_block(block: ConvertedBlock, calibrated: bool) -> bytes:
    flags = (FLAG_VOICED if block.voiced else 0) | (FLAG_CALIBRATED if calibrated else 0)
    header = PACKET_HEADER.pack(
        MAGIC, block.seq, block.input_end, float(block.rtf), len(block.audio), len(block.visemes), flags, float(block.viseme_hop_seconds),
    )
    return header + block.audio.astype("<f4").tobytes() + block.visemes.astype("<f4").tobytes()


async def _send_error(websocket: WebSocket, message: str, code: int = 1011) -> None:
    try:
        await websocket.send_json({"type": "error", "message": message})
        await websocket.close(code=code)
    except Exception:
        pass


def _target_embedding(voice_id: str):
    with SessionLocal() as db:
        voice = voice_controller.get_voice(db, voice_id)
        return voice.name, voice_controller.load_embedding(voice)


async def handle_stream(websocket: WebSocket) -> None:
    if not websocket_token_ok(websocket):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    settings = get_settings()

    try:
        start = json.loads(await websocket.receive_text())
    except (WebSocketDisconnect, ValueError):
        return
    if start.get("type") != "start":
        await _send_error(websocket, "The first message must be a start message.", 1003)
        return
    if not tone_model.ready:
        await _send_error(websocket, tone_model.status.detail or "The voice model is not ready.")
        return
    sample_rate = int(start.get("sampleRate") or 0)
    if not 8000 <= sample_rate <= 192000:
        await _send_error(websocket, "Unsupported input sample rate.", 1003)
        return

    try:
        voice_id = str(start.get("voiceId") or "")
        voice_name, target_se = await run_in_threadpool(_target_embedding, voice_id)
        with SessionLocal() as db:
            source_se = voice_controller.source_embedding(db)
            block_ms, realtime = system_controller.effective_block_ms(db)
            voice_controller.mark_used(db, voice_id)
        # Under-spec hardware: larger blocks with less context are the most efficient; latency then grows
        # while speaking and recovers during pauses (silent blocks skip inference).
        context_ms = settings.context_ms if realtime else BUFFERED_CONTEXT_MS
        streamer = StreamingVoiceConverter(
            tone_model, sample_rate, target_se, source_se, voice_controller.fallback_source_embedding(),
            block_ms=block_ms, context_ms=context_ms, crossfade_ms=settings.crossfade_ms, silence_dbfs=settings.silence_dbfs,
        )
        max_backlog = LIVE_BACKLOG_BLOCKS if realtime else max(2, int(BUFFERED_BACKLOG_SECONDS / streamer.block_seconds))
    except Exception as exc:
        await _send_error(websocket, getattr(exc, "detail", None) or str(exc))
        return

    await websocket.send_json({
        "type": "ready", "outputSampleRate": tone_model.sample_rate, "blockMs": round(streamer.block_seconds * 1000),
        "latencyMs": round(streamer.latency_estimate_ms), "realtime": realtime, "mode": "live" if realtime else "buffered", "calibrated": streamer.calibrated,
        "voiceId": voice_id, "voiceName": voice_name, "device": tone_model.device,
    })

    wake = asyncio.Event()
    closed = asyncio.Event()
    rtf_window: list[float] = []

    async def processor() -> None:
        last_stats = time.monotonic()
        while not closed.is_set():
            await wake.wait()
            wake.clear()
            while not closed.is_set():
                dropped = streamer.drop_backlog(max_backlog)
                if dropped:
                    log.warning("Dropped %d block(s): CPU cannot keep up", dropped)
                taken = streamer.take_block()
                if taken is None:
                    break
                block = await run_in_threadpool(streamer.render, taken)
                if block.voiced:
                    rtf_window.append(block.rtf)
                await websocket.send_bytes(encode_block(block, streamer.source_ready))
                now = time.monotonic()
                if now - last_stats >= 1.0:
                    last_stats = now
                    recent = rtf_window[-20:]
                    await websocket.send_json({
                        "type": "stats", "rtf": float(np.mean(recent)) if recent else 0.0, "droppedBlocks": streamer.dropped_blocks,
                        "calibrated": streamer.source_ready, "voicedSeconds": round(streamer.voiced_seconds, 1),
                        "backlogMs": round(len(streamer.pending) / streamer.sr * 1000),
                    })

    task = asyncio.create_task(processor())
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                break
            if message.get("bytes") is not None:
                streamer.feed_pcm16(message["bytes"])
                if streamer.blocks_ready():
                    wake.set()
                continue
            try:
                control = json.loads(message.get("text") or "{}")
            except ValueError:
                continue
            if control.get("type") == "stop":
                break
            if control.get("type") == "voice":
                try:
                    new_id = str(control.get("voiceId") or "")
                    name, embedding = await run_in_threadpool(_target_embedding, new_id)
                    streamer.set_target(embedding)
                    with SessionLocal() as db:
                        voice_controller.mark_used(db, new_id)
                    await websocket.send_json({"type": "voice", "voiceId": new_id, "voiceName": name})
                except Exception as exc:
                    await websocket.send_json({"type": "error", "message": getattr(exc, "detail", None) or str(exc), "fatal": False})
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("Conversion stream failed")
    finally:
        closed.set()
        wake.set()
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
        try:
            await websocket.close()
        except Exception:
            pass
