# Avatar Studio

A Windows desktop app that turns any portrait into a live avatar. The avatar is driven by your webcam and speaks with a voice of your choice. Upload a photo, illustration or painting. The webcam tracks your face, and the portrait follows your head, eyes, brows and mouth in real time. When you speak, your words are converted into the selected voice profile (speech-to-speech, not text-to-speech), and the avatar's mouth is driven by the converted audio. Everything runs locally.

```
apps/desktop   Electron + React + TypeScript + Vite + Tailwind: UI, webcam, tracking, WebGL avatar renderer
apps/engine    Python FastAPI + PyTorch: OpenVoice V2 voice conversion, SQLite + file storage, WebSocket streaming
apps/api       (legacy) licensing/payment server from the earlier virtual-camera prototype; not used by the studio
native/        (legacy) virtual-camera driver design notes
```

## How it works

| Stage | Technology | Where |
| --- | --- | --- |
| Face tracking | MediaPipe Face Landmarker (478 landmarks, 52 blendshapes), One-Euro filtered | Web Worker (GPU delegate, CPU fallback) |
| Portrait analysis | MediaPipe IMAGE mode → landmarks + compatibility score, stored with the avatar | same worker |
| Face animation | Landmark-driven mesh reenactment: Horn head-pose solve against a captured neutral pose; expression deltas transferred onto the avatar's own landmarks; 3D head rotation with parallax; rings carry hair and neck; procedural mouth interior | WebGL2 (`lib/reenactment.ts`, `lib/avatarRenderer.ts`) |
| Voice conversion | OpenVoice V2 tone-colour converter (zero-shot, MIT), block streaming with context and cross-fade | engine, `/ws/convert` |
| Lip-sync | Visemes (jaw, round, wide) from the *converted* audio's spectrum, scheduled on the Web Audio clock; face delayed by the measured voice latency | engine + renderer |
| Static background | MediaPipe multiclass segmentation (person + hair) → push-pull "clean plate"; only subject pixels of the warped mesh are drawn over the unmoved original | worker + WebGL2 (`lib/backgroundPlate.ts`) |
| Neural animation (optional) | LivePortrait (MIT) relative-motion reenactment of the portrait from aligned webcam crops; blended back over the original picture. **Needs a CUDA GPU** | engine `/ws/face` + renderer |
| Virtual camera | GPU compose + I420 encode in the renderer's WebGL context → Electron main → local TCP socket → `pyvirtualcam` → Unity Capture or OBS Virtual Camera (DirectShow) | renderer, shell, engine |
| Virtual microphone | Converted voice only → an output device such as VB-CABLE "CABLE Input"; call apps select "CABLE Output" | renderer (Web Audio) |
| Recording | MediaRecorder of the final output + converted voice, 1 s chunks streamed to the engine; ffmpeg remux / H.264 transcode | renderer + engine |
| Storage | SQLite (`studio.sqlite3`) + files (portraits, voice samples, embeddings, previews) | engine data folder |

Why not LivePortrait or First Order Motion? Both need a CUDA GPU for interactive frame rates; on a CPU they run at a few frames per second. The landmark-driven WebGL reenactment runs at display rate on integrated graphics and stays faithful to the uploaded picture. See `docs/ENGINEERING_REPORT.md` for limits and the upgrade path.

## Features

- **Dashboard:** setup checklist, recently used avatars, available voices, recent sessions with latency and tracking stats.
- **Avatar Studio:** animated avatar with AI-generated labels, webcam preview, camera selector, tracking quality and expression meters. Voice panel with voice picker, mic and AI-output meters, conversion status and latency, output device. Controls: start, pause animation, stop, mute, camera on/off, reset avatar position (recalibrate neutral), change avatar, change voice (works mid-session), fullscreen.
- **My Avatars:** drag-and-drop or multi-file upload (JPG/JPEG/PNG/WEBP), automatic landmark analysis with a compatibility score and notes, face-mesh preview, rename, favourite, replace, delete.
- **Voice Library:** 11 preloaded profiles with locally rendered AI previews, search and language filters, favourites, and "Try with my voice" (record a clip, hear your words in that voice).
- **My Voices:** create profiles from an upload (WAV, MP3, FLAC, OGG, M4A, WEBM) or a microphone recording. Each requires a recorded authorisation (own voice, or a named person who authorised it). Preview, play the original sample, rename, favourite, replace (re-confirms consent), delete.
- **Recordings:** record / pause / resume / stop in the studio; play, rename, delete, save as MP4 (H.264 + AAC) or WebM, show in folder. Recordings contain only the animated avatar and the converted voice.
- **Outputs (Settings):** keep the original background static, output size / frame rate / framing, virtual camera driver detection and setup links, virtual microphone device and delay, recording format and quality.
- **Settings:** animation engine (standard mesh or neural LivePortrait on CUDA), devices, mirroring, smoothing, expression and head strength, lip-sync source (webcam / converted voice / hybrid), face-to-voice sync, noise suppression, echo cancellation, monitoring, microphone voice calibration, block size, engine and hardware checks with benchmark, privacy controls.

## Run it

Requirements: Windows 10/11, Node 20+, Python 3.10–3.12, a webcam and microphone. Headphones are recommended while monitoring the converted voice.

```powershell
npm install
npm run setup:engine      # venv, torch (CPU), engine deps, OpenVoice code + weights (~400 MB total)
npm run dev               # Vite + Electron; the shell starts the engine with a per-launch token
```

Other scripts: `npm run dev:engine` (engine alone), `npm run typecheck`, `npm test -w apps/desktop` (rig and mesh tests), `npm run test:engine` (engine API and streaming tests), `npm run build:desktop` (installer; the engine folder ships as an extra resource, but Python and its venv must be provided on the target PC).

## Performance and hardware

The engine benchmarks itself and Settings → Engine & hardware reports what the PC can do. Voice conversion needs a real-time factor below 0.75 for **live** mode (latency about block size + 80 ms). Slower PCs run **buffered** mode: still continuous speech-to-speech, but the voice lags while you talk and catches up in pauses, and the UI says so. The development machine (Intel i5-4210U, 2 cores, 4 GB) measures RTF ≈ 2.6 at idle, so it runs buffered. A modern 6–8 core CPU or any CUDA GPU should run live; that is extrapolated, not measured. Face tracking and rendering run on every machine (5–30 fps tracking depending on the CPU, 25–60 fps rendering).

## Using it in a call

1. Install a camera driver once: [Unity Capture](https://github.com/schellingb/UnityCapture) (run `Install.bat` as administrator) or [OBS Studio](https://obsproject.com) (its "OBS Virtual Camera"; OBS does not need to run). Windows 10 has no API for apps to create a camera; the Media Foundation virtual camera needs Windows 11.
2. Install a virtual audio cable once, e.g. [VB-CABLE](https://vb-audio.com/Cable/). Note: its installer may make "CABLE Output" the default Windows microphone; set your real microphone back in Sound settings.
3. Settings → Outputs: pick "CABLE Input" as the virtual microphone.
4. Studio: authorise the portrait, start a session, press **Virtual camera**.
5. In the call app choose "Unity Video Capture" (or "OBS Virtual Camera") as the camera and "CABLE Output" as the microphone. Restart the call app if it was open before the drivers were installed.

### Compatibility (what was and was not tested)

| Target | Status |
| --- | --- |
| Chromium (Microsoft Edge 1xx) reading the camera and the cable — the capture stack used by WhatsApp Web, Google Meet and Teams on the web | **Tested**: "Unity Video Capture" and "CABLE Output" listed and delivering the avatar and the converted voice |
| WhatsApp Desktop, Telegram, Zoom, Discord, WeChat, Teams desktop, Skype, OBS | **Not tested.** DirectShow cameras are visible to apps that use DirectShow or Chromium; apps that use only Media Foundation (e.g. the Windows Camera app) do not list them |

## Privacy and responsible use

- Camera and microphone are used only after explicit consent in the studio; consent can be revoked in Settings.
- Frames, audio, portraits and voice samples are processed and stored locally. The only network access is the one-time, user-initiated model download.
- Voice profiles require the voice owner's authorisation, which is stored with the profile (who, relation, statement, time).
- Animated video and converted audio are labelled "AI-GENERATED" in the app, and the virtual camera feed and recordings carry a visible "AI-generated" label.
- Portraits require the same authorisation as voices: whose face it is (own, or a named person who authorised it), stored with the avatar. Sessions, the virtual camera and recordings refuse unauthorised portraits.
- The app does not offer face swapping onto live video.
- The app offers no impersonation features. Do not use it to deceive people about who is speaking.
