# Asset and model licences

## Face tracking (desktop)

- **MediaPipe Tasks Vision runtime and WebAssembly runtime:** `@mediapipe/tasks-vision` 1.2.0, Copyright Google LLC, Apache License 2.0. The licence text ships with the desktop's bundled files at `apps/desktop/public/mediapipe/LICENSE.txt`.
- **Face Landmarker model bundle:** Google AI Edge MediaPipe Face Landmarker, float16, Apache License 2.0, from the official [Face Landmarker model bundle](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task). SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`. It combines face detection, the 478-point face mesh and 52 blendshapes. See the [model card](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker).

The model and runtime are bundled and loaded locally. Webcam frames and landmarks are never uploaded or persisted.

## Voice conversion (engine)

- **OpenVoice V2 tone-colour converter:** MyShell.ai, [MIT licence](https://github.com/myshell-ai/OpenVoice/blob/main/LICENSE). Code is installed from `github.com/myshell-ai/OpenVoice` (only `openvoice.models`, `openvoice.mel_processing` and `openvoice.utils` are imported). Weights (`converter/checkpoint.pth`, ~131 MB, and `converter/config.json`) are downloaded on the user's request from [huggingface.co/myshell-ai/OpenVoiceV2](https://huggingface.co/myshell-ai/OpenVoiceV2) into the engine data folder; they are not committed to this repository.
- **Preloaded voice library:** the 11 tone-colour embeddings in `base_speakers/ses/*.pth` from the same OpenVoice V2 release (MIT). They describe timbre only; no recordings of the original speakers are bundled.
- **Voice previews:** rendered locally by converting one neutral sentence, spoken by the built-in Windows SAPI voice, into each profile. The SAPI clip is generated on the user's PC and never distributed.

## Audio tooling

- **FFmpeg** via `imageio-ffmpeg` (LGPL/GPL builds as distributed by imageio) decodes compressed uploads (MP3, M4A, OGG, WEBM).
- **soxr** (LGPL-2.1) resamples microphone audio in real time.

## Test fixtures

`apps/desktop/src/lib/__fixtures__/portrait-landmarks.json` holds MediaPipe landmarks detected in [File:Woman 1.jpg](https://commons.wikimedia.org/wiki/File:Woman_1.jpg) on Wikimedia Commons. That is a StyleGAN-generated face of a person who does not exist, released into the public domain. The image itself is not committed.


## Added for outputs and animation

| Asset | Licence | Use |
| --- | --- | --- |
| `apps/desktop/public/mediapipe/selfie_multiclass_256x256.tflite` (Google MediaPipe) | Apache 2.0 | Person/hair segmentation for the static background |
| LivePortrait network code, vendored in `apps/engine/models/ai/liveportrait/` (Kuaishou, KwaiVGI/LivePortrait) | MIT (licence file included) | Optional neural animation |
| LivePortrait weights, downloaded on request from huggingface.co/KwaiVGI/LivePortrait (not committed) | MIT | Optional neural animation |
| `pyvirtualcam` (Python package) | GPL-2.0 | Virtual camera bridge to the installed driver |
| Unity Capture DirectShow filter (installed separately by the user) | MIT | Virtual camera device |
| VB-CABLE (installed separately by the user) | Donationware, VB-Audio licence | Virtual microphone |
