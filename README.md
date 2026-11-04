# AI Virtual Camera

Portfolio project: a Windows desktop app with a local webcam-driven avatar preview, plus a customer website and licensing flow. The native virtual camera and live-call output are not implemented.

## Status

| Area | State |
| --- | --- |
| Electron shell, sandbox, CSP, permission + navigation lockdown | Implemented |
| Validated IPC (Zod) with narrow preload bridge | Implemented |
| Webcam capture, device picker, disconnect handling | Implemented |
| Activation and session countdown | **Mocked** (`src/services/license.ts`) |
| Face tracking + Three.js avatar preview (MediaPipe, local worker) | Implemented; hardware acceptance remains unverified |
| Original built-in avatars and consent-gated custom picture preview | Implemented; custom face-mesh reenactment is experimental, visibly AI-labeled, and memory-only |
| Voice controls and cable passthrough | Microphone selection, local level meter, mute, and optional unchanged-voice routing to a user-installed cable; voice conversion and personal-voice enrollment unavailable |
| Avatar backgrounds | Eight original local preview scenes and validated in-memory image upload; apply remains locked until backend feature authorization exists |
| PRD desktop navigation screens | Reachable from navigation; checkout, recording, and native-camera actions remain unavailable |
| Native Windows virtual camera (Media Foundation) | Design + registration skeleton only (`native/virtualcam`), not built |
| Backend API (orders, USDT TRC-20 verification, licensing, sessions, admin) | Written, tests included, **not yet run** (`apps/api`) |
| Compatibility matrix, test procedures, deployment/operations/release docs | Written (`docs/`); every platform `NOT_TESTED` |
| Customer website, API client package | Not started |
| Desktop device key + real API client | Not started (desktop still uses the mock) |

Custom-picture reenactment warps the detected face mesh locally in the preview; it is experimental and may distort. It does not create an outgoing camera stream or send video to a call partner. TypeScript and production web/Electron bundles compile, but installer packaging could not complete in this environment because Windows denied symlink creation during electron-builder setup. Webcam behavior and hardware acceptance criteria have not been verified on target hardware. See `docs/DEFINITION_OF_DONE.md` for the honest per-requirement status.

The face-tracking model and WebAssembly runtime are bundled with the desktop app; see [docs/ASSET_LICENSES.md](docs/ASSET_LICENSES.md).

## Develop

```bash
npm install
cp apps/desktop/.env.example apps/desktop/.env
npm run dev:desktop
```
