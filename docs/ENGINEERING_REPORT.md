# Engineering report: Avatar Studio

Snapshot: 2026-11-04. Status words: **verified** (exercised end to end or by automated tests), **implemented** (code exists, not verified on real hardware), **limited** (works, with documented caveats).

## 1. What was verified

| Area | Evidence |
| --- | --- |
| Engine boots, seeds the 11-voice library, benchmarks the CPU | Real server run; `/api/system/status` |
| OpenVoice V2 conversion of real speech (offline and streamed) | SAPI speech → converted WAV; WebSocket client streaming at real-time pace, including mid-stream voice switching |
| Desktop app end to end | Production build driven over the Chrome DevTools Protocol with Chromium fake devices (a video file as webcam, a WAV as microphone): upload → landmark analysis (478 points, 100 % match) → library preview rendering → settings → studio consent → live tracking → session with buffered voice conversion → session history |
| Avatar follows head motion | Canvas frames sampled during tracking change with the webcam head pose; visual check of a frame strip |
| Expression rendering | Real WebGL renderer: rest, jaw open, blink, smile, 20° turn, visemes "aa"/"ee"/"oo", combined expression |
| Rig math | 9 vitest cases (rest identity, rigid yaw without phantom mouth motion, jaw and blink transfer, viseme jaw and rounding, no-face fallback, mesh coverage) |
| Engine | 20 unittest cases (streaming continuity, cross-fade smoothness, silence skipping, source-voice estimation, backlog bounds, visemes, block-size choice, token auth, avatar lifecycle and validation, consent enforcement, settings validation, UTC session times, WebSocket auth) |

Not verified: a physical webcam and microphone on this machine (the test runs used Chromium's fake devices), a CUDA GPU, multi-monitor fullscreen, and the electron-builder installer.

## 2. Face animation

Real-time neural reenactment (LivePortrait, FOMM) needs a CUDA GPU; on the 2-core development CPU it would run at roughly 1 fps. The implemented alternative is a landmark-driven 2D reenactment rendered with WebGL2:

1. MediaPipe Face Landmarker tracks 478 landmarks plus blendshapes in a worker, filtered with a One-Euro filter. Only new camera frames are processed (`requestVideoFrameCallback`).
2. A neutral pose is averaged from the first 12 frames ("Reset avatar position" recaptures it).
3. Horn's quaternion method on rigid landmarks gives the head rotation; the residual after un-rotating is the expression.
4. Expression deltas are scaled to the avatar's face proportions and roll, then added to the avatar's own landmarks. The avatar keeps its identity and only the motion transfers.
5. The avatar's 3D landmarks are rotated about a pivot behind the face (parallax), with gain and a 32° cap to avoid distortion.
6. Two outer rings derived from the face oval carry hair, ears and neck (the inner ring follows the face edge including the jaw); image borders stay fixed.
7. Passes: outer mesh → eyes (iris-centred fans, so gaze shifts warp the eye) → procedural mouth interior (cavity, teeth, tongue; blended in only when the mouth opens beyond the portrait's rest) → depth-tested face mesh.

Limits: very large turns (> ~25°) can show a small fold at the far cheek. Pictures without a detectable face move as a whole. Stylised faces that MediaPipe cannot detect fall back to that mode.

## 3. Voice conversion

OpenVoice V2's tone-colour converter performs zero-shot speech-to-speech: the spoken words, rhythm and intonation are kept and the timbre is replaced with the target embedding. A profile needs only an embedding extracted from at least 4 s of speech (6 s+ is recommended in the UI).

Streaming: about 20 ms PCM frames → soxr streaming resampler → blocks (benchmark-chosen) with left context → inference in a worker thread → 40 ms equal-power cross-fade. Silent blocks skip inference. The user's own source embedding comes from Settings → calibration or is estimated from live speech.

**Measured on the development PC (i5-4210U):** RTF 2.2–2.6 idle and up to ~14 while face tracking and rendering share the two cores. The decoder (HiFi-GAN) is 87 % of compute. TorchScript freezing gave no speed-up, and ONNX Runtime could not run because it needs a newer VC++ runtime than this PC has. This PC therefore runs **buffered** mode and the UI says so. Faster CPUs and CUDA GPUs run **live** mode automatically.

## 4. Lip-sync

Visemes (jaw, round, wide, energy) are computed from the converted audio's short-time spectrum (formant-band energies and centroid, with attack/release smoothing) for every 256-sample hop. They travel with the audio block and are scheduled on the Web Audio clock, so the mouth follows exactly what is heard. In live mode the webcam pose is delayed by the measured voice latency so expressions line up as well. In buffered mode, expressions stay live and the mouth follows the converted voice. Lip-sync modes: webcam, converted voice, or hybrid (the converted voice opens the mouth further).

## 5. Security and privacy

The engine binds to 127.0.0.1 and requires a random per-launch token (header, or query string for media). CORS is limited to the app origins. Electron keeps its hardened setup: sandboxed renderer, context isolation, a validated IPC bridge, navigation lockdown, and permissions limited to media, speaker selection and fullscreen. CSP allows only the local engine. Uploads are validated by type, size and decodability. Consent is required for media access and recorded for every cloned voice.

## 6. Outputs, background and neural animation (added 2026-11-05/06)

Measured on the development PC (i5-4210U, 2 cores, 4 GB RAM, Intel HD 4400, no CUDA), production build, Windows 10:

| Area | Result |
| --- | --- |
| Static background | Background probe regions changed 0–4 % of pixels during head motion (99 % with the old whole-picture warp); the face changed 99 %. Render ~41 fps (47 without) after baking the plate and the subject matte into single textures (it was 11 fps with five texture fetches per pixel). |
| Virtual camera | Unity Capture via `pyvirtualcam`; seen by Microsoft Edge as "Unity Video Capture". Frame path: GPU compose + I420 in the renderer's own WebGL context (async PBO readback) → IPC → local TCP → engine. Measured input 12–14 fps at 720p on this PC (2 fps over the original WebSocket path, which moves only 7–18 MB/s here). The driver repeats frames at 30 fps; when frames stop for 1 s a "camera paused" card is shown, never a frozen avatar. |
| Virtual microphone | VB-CABLE: digital silence before conversion starts (the raw microphone is never routed), converted voice peaks −13 dBFS once it arrives. |
| Voice conversion | **Not real time on this PC**: RTF 1.67 at idle; with tracking and rendering running, latency reached 27 s. Live voice needs a CUDA GPU or a much faster CPU. |
| Recording | Record, pause, resume, stop; WebM → H.264/AAC MP4 transcode and both containers kept; seekable (HTTP range); crash leaves the part recorded. |
| Neural animation | LivePortrait port verified for correctness on CPU (neutral drive reconstructs the portrait, mean error 4/255; a 11° driver roll tilts the portrait's head) but takes ~420 s per frame here, so the app only offers it with a CUDA GPU. Real-time speed on a GPU is **not measured**. In neural mode the mouth follows the webcam, not the converted voice's visemes. |

Tests: 35 engine (`npm run test:engine`), 20 desktop (`npm test -w apps/desktop`).

## 7. Next steps

- Optional neural reenactment path (LivePortrait ONNX on CUDA) behind the same `AvatarStage` interface.
- Measure neural animation and voice conversion on a CUDA GPU; test each call app individually.
- A native Windows 11 Media Foundation virtual camera (see `native/virtualcam`) so Media-Foundation-only apps can see the camera.
- Bundled Python runtime for the installer.
