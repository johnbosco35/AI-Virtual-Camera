# Avatar Studio engine

A local FastAPI service. It runs speech-to-speech voice conversion (OpenVoice V2) and stores the studio's data: avatars, voices, sessions and settings. It listens on `127.0.0.1` only, and every request needs the per-launch token issued by the desktop shell.

## Layout (config / models / routes / controllers)

```
config/        settings (AVS_* env vars), SQLite engine + session, token check
models/        SQLAlchemy tables (avatar, voice, studio_session, app_setting), Pydantic schemas
models/ai/     AI model wrappers: tone_converter (OpenVoice V2), streaming (block streamer),
               viseme (audio lip-sync), audio_io (FFmpeg/soxr), hardware (probe + benchmark), preview_source
controllers/   request logic: avatar, voice, session, settings, system, conversion (WebSocket)
routes/        thin HTTP/WebSocket mapping onto controllers
main.py        app factory, CORS, lifespan, CLI (--download-models)
tests/         unittest suite (temporary data dir; no model weights needed)
```

## Setup

```powershell
cd apps/engine
python -m venv .venv
.venv\Scripts\python -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m pip install --no-deps git+https://github.com/myshell-ai/OpenVoice.git
.venv\Scripts\python main.py --download-models     # optional; the app can download them too
```

torch 2.5.1 is pinned because newer Windows wheels need the 14.4x Visual C++ runtime. If you have the current [VC++ redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe), any recent torch works. On an NVIDIA PC, install the CUDA build of torch instead; the engine picks up CUDA automatically.

Run on its own: `.venv\Scripts\python main.py` (set `AVS_TOKEN` to require a token). The desktop app normally starts it.

Tests: `.venv\Scripts\python -m unittest discover -s tests -t . -v`

## Real-time voice conversion

`ws://127.0.0.1:8765/ws/convert?token=…`

1. Client sends `{"type":"start","voiceId":"lib-en-us","sampleRate":48000}`, then little-endian int16 mono PCM frames.
2. The server answers with `{"type":"ready","outputSampleRate":22050,"blockMs":…,"mode":"live"|"buffered",…}`.
3. Each converted block arrives as a binary packet. The 28-byte header is `<4sIIfIHHf`: magic `AVS1`, seq, input_end, rtf, n_samples, n_visemes, flags, viseme_hop_seconds. It is followed by float32 audio and float32 visemes `[jaw, round, wide, energy]`.
4. `{"type":"voice","voiceId":…}` switches voice mid-stream; `{"type":"stop"}` ends.

Streaming works in blocks of N ms, each converted together with about 320 ms of left context and cross-faded over 40 ms. Silent blocks skip inference. Without a calibrated source voice, the speaker's own embedding is estimated from the first 2.5, 7 and 15 s of live speech. `input_end` maps every output block back to a microphone sample, so the client measures true end-to-end latency and schedules visemes on the same audio clock.

**Performance.** A startup benchmark measures the real-time factor (RTF: compute time divided by audio time) and picks the smallest block that keeps inference within 75 % of real time. Below that threshold the engine switches to **buffered** mode. Conversion stays continuous, but the voice lags while you speak and catches up during pauses, and backlog over 8 s is dropped. Rough guide, measured only on the first machine:

| Machine | RTF (1 s window) | Mode |
| --- | --- | --- |
| Intel i5-4210U (2 cores, 2014), CPU | 2.2–2.6 idle, up to ~14 with tracking running | buffered |
| Modern 6–8 core desktop CPU | expected ~0.2–0.4 | live, ~0.5–0.8 s latency |
| NVIDIA GPU (CUDA) | expected < 0.05 | live, ~0.25 s latency |

## API summary

All routes are under `/api` and require the `X-AVS-Token` header, or `?token=` for media elements.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/system/status` | model state, hardware, benchmark, requirement checks |
| POST | `/system/models/download`, `/system/benchmark` | user-initiated model download, re-benchmark |
| GET/PATCH | `/settings` | persisted preferences |
| GET/POST | `/avatars` | gallery / upload (JPG, PNG, WEBP, ≤ 10 MB, 128–4096 px) |
| GET/PATCH/DELETE | `/avatars/{id}` | detail incl. landmarks / rename, favourite / delete with file |
| PUT | `/avatars/{id}/image`, `/avatars/{id}/landmarks` | replace picture / store landmarks detected in the renderer |
| GET | `/avatars/{id}/image` | the portrait |
| GET/POST | `/voices` | library + personal voices / consent-gated enrolment |
| GET/PATCH/DELETE | `/voices/{id}` | detail / rename, favourite / delete (personal only) |
| PUT | `/voices/{id}/sample` | replace sample (re-confirms consent) |
| GET | `/voices/{id}/preview`, `/voices/{id}/sample` | AI preview (rendered on first request) / original sample |
| POST | `/voices/{id}/convert` | convert a short clip ("Try with my voice") |
| GET/PUT/DELETE | `/voices/source` | calibration of the user's own microphone voice |
| GET/POST/DELETE | `/sessions`, POST `/sessions/{id}/end` | studio session history |
