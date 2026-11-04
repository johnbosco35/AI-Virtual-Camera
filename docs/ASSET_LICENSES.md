# Desktop asset licenses

## Face tracking

- **MediaPipe Tasks Vision runtime and WebAssembly runtime:** `@mediapipe/tasks-vision` 1.2.0, Copyright Google LLC, Apache License 2.0. The installed package declares `Apache-2.0`; its license text is included with the desktop's bundled files at `apps/desktop/public/mediapipe/LICENSE.txt`.
- **Face Landmarker model bundle:** Google AI Edge MediaPipe Face Landmarker, float16, Apache License 2.0, downloaded from the official [Face Landmarker model bundle](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task). SHA-256: `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`. The bundle combines face detection, face mesh and blendshape models. Refer to the official [Face Landmarker documentation and model cards](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker) for model details and attribution.

The model and runtime are bundled locally. They are loaded from the installed application; webcam frames and landmark results are not uploaded or persisted.

## Built-in avatars

Aria, Sol, and Milo are original vector illustrations authored in `apps/desktop/src/components/AvatarPreview.tsx`. They use no third-party images, fonts, or avatar packs. No separate asset license has been assigned; redistribution rights remain with the project owner.

## Built-in backgrounds

The avatar-scene, soft abstract blur, solid color, midnight, sunset, mint, mountain, and city backgrounds are original shapes and gradients drawn in `apps/desktop/src/components/ThreeAvatarCanvas.tsx`. They use no third-party images or fonts. No separate asset license has been assigned; redistribution rights remain with the project owner. Custom background files are selected by the user, decoded locally, and kept in memory only.
