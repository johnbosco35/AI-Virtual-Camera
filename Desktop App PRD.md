AI Virtual Camera: Desktop App PRD
Version 0.2 (draft) · 2 November 2026 · Companion document: Backend PRD

1. Purpose and scope
   This PRD defines the Windows desktop app of the AI Virtual Camera platform: the Electron application, the native virtual camera and virtual microphone components, and the installer and update flow. It covers work that is not yet built or not yet verified. Every requirement is for the real, live product: no demo modes, mock services or placeholder features ship to customers.
   The backend (API, database, payments, licensing, admin API, operations) is specified in the Backend PRD. The customer website and the administrator dashboard interface are outside both documents and need their own PRD.
   Priority key: P0 = core, build first. P1 = needed for the full v1. P2 = later.
   Size key: S = under a day, M = a few days, L = a week or more (single developer).
2. Product summary
   The desktop app lets a customer animate an avatar with their webcam, optionally change their voice and the background, record a video to save, or go live in other video apps through a native Windows camera. Three activation codes unlock three features: Video, Voice and Background. The backend decides what is allowed; the app enforces it locally and shows the state clearly.
   Goals
   • Real-time, face-tracked avatar animation that runs entirely on the customer's PC.
   • A native Windows camera device that other apps can select, backed by an honest, tested compatibility list.
   • Studio features: record and save a video, change the voice, change the background.
   • A secure, recoverable install, update and uninstall experience.
   Non-goals for this version
   • Claiming support for any video-call app before it is tested.
   • Uploading webcam frames, audio, recordings or face data to any server.
   • Mobile or macOS clients.
   User: the customer, who installs the app, activates it with codes, and runs sessions.
3. Current baseline
   Area
   State
   Hardened Electron shell: sandbox, context isolation, validated IPC, strict CSP
   Written. Never run.
   Device key (Ed25519, protected by the OS keystore) and signed challenges
   Written. Never run.
   API client and licensing service: activate, start, heartbeat, end, resume after restart, offline policy
   Written. Never run. Contains a development mock mode that must not ship (QA-7).
   Webcam preview, camera picker, disconnect handling, server-driven countdown
   Written. Never run.
   Native virtual camera
   Design and an unbuilt registration tool only
   First task before new work: install dependencies, launch the app against a running backend, and fix what breaks (QA-1).
4. Workstreams
   4.1 Face tracking and avatar rendering
   Why: this is the core feature customers see and use in every session.
   ID
   Requirement
   Priority
   Size
   FT-1
   Run MediaPipe Face Landmarker on the webcam stream locally, in a Web Worker so the UI stays responsive.
   P0
   M
   FT-2
   Extract head rotation, eye blink, eyebrow raise, mouth open and basic expression blendshapes each frame.
   P0
   M
   FT-3
   Smooth tracking output (configurable strength) to reduce jitter without noticeable lag.
   P0
   S
   FT-4
   Show a tracking quality indicator (face found, confidence, lighting warning, face too small or out of frame).
   P0
   S
   FT-5
   Handle failure states with plain messages: no face, poor lighting, camera unplugged, model failed to load.
   P0
   S
   FT-6
   Bundle the model and WASM files with the app (no runtime download) and record their licenses.
   P1
   S
   FT-7
   Target 30 fps at 720p on a mid-range laptop; show measured fps and CPU in the settings screen.
   P1
   M
   Acceptance: with a webcam, blinking, mouth opening and head turning visibly move the avatar within about 100 ms. Unplugging the camera shows a recovery message and does not crash. No frame or landmark data is written to disk or sent over the network (verified with a file and network monitor).
   4.2 Avatars and media handling
   ID
   Requirement
   Priority
   Size
   AV-1
   Three.js renderer that maps FT-2 output onto an avatar and renders to a canvas at the target frame rate.
   P0
   M
   AV-2
   Ship two or three original stylized avatars (3D or layered 2D) with documented asset licenses.
   P0
   M
   AV-3
   Avatar selection screen with live preview thumbnails.
   P0
   S
   AV-4
   Optional custom image import (PNG, JPEG, WebP only): validate type, size (for example 10 MB max), dimensions and decode safety, and process locally.
   P2
   M
   AV-5
   Custom images require an on-screen consent attestation, and output can carry a visible AI-generated indicator.
   P2
   S
   AV-6
   State the animation limits honestly in the UI: results vary by image and lighting; not every image animates well.
   P1
   S
   Design note: version 1 ships built-in avatars only. Animating arbitrary photos of real people is deliberately deferred because it enables impersonation; if added later it must ship with AV-5.
   4.3 Screens
   The app has twelve required screens plus the studio screens. Six of the original twelve exist in some form.
   ID
   Screen
   State
   Priority
   Size
   DS-1
   Device verification (bound or unbound, last verified, clear mismatch message)
   Missing
   P0
   S
   DS-2
   Avatar selection
   Missing
   P0
   S
   DS-3
   Camera and tracking settings (camera, resolution, mirror, smoothing, quality readout)
   Only a camera picker
   P0
   S
   DS-4
   Virtual camera status (installed, running, version, repair button)
   Small card only
   P1
   S
   DS-5
   Privacy and permissions (what is processed locally, what the server sees, camera and microphone permission help)
   One line in Help
   P1
   S
   DS-6
   Error and recovery states (offline, activation conflict, native component missing, expired session)
   Partial
   P1
   M
   DS-7
   Purchase entry: open the website checkout from the app (allow-listed external link)
   Missing
   P1
   S
   DS-8
   Session end teardown: stop capture, tracking, rendering and timers, and release the camera and microphone
   Missing
   P0
   S
   DS-9
   Voice screen (see VO-1)
   Missing
   P1
   S
   DS-10
   Background screen (see BG-1)
   Missing
   P1
   S
   DS-11
   Studio screen: preview, record, go live (see REC-1)
   Missing
   P0
   M
   Acceptance: every screen is reachable from navigation, keyboard accessible, with no dead ends in any error state.
   4.4 Voice: default voices and personal voice
   Voice lets the customer speak through a chosen voice: the app converts their live speech into the selected voice on the PC and sends it to the call. There are two sources, built-in default voices and the customer's own enrolled voice. Voice impersonation is a common fraud method, so every requirement carries a safeguard, and the personal-voice parts ship last.
   Design decisions
   • Local processing: microphone audio, voice samples and models never leave the PC.
   • Default voices are original or fully licensed, with the voice source's written consent and license recorded for each.
   • Personal voice means enrolling your own voice. The app does not accept voice samples or models of other people. Importing third-party model files is excluded, partly for safety: some model formats (Python pickle) can run code when loaded.
   • Same session rules: voice works only while the session is authorized and stops at expiry.
   ID
   Requirement
   Priority
   Size
   VO-1
   Voice screen: list of default voices with name, short description, preview button and a selected marker, plus a 'my own voice, unchanged' option.
   P1
   S
   VO-2
   Ship 3 to 5 default voices, each with a documented license and recorded consent from its source. None may imitate a real person or public figure.
   P1
   M
   VO-3
   Real-time voice conversion running locally with ONNX Runtime (CPU first, optional GPU). Models are bundled and hash-checked on load.
   P1
   L
   VO-4
   Microphone selection, input level meter, mute, and a clear 'voice is on' indicator while active.
   P1
   S
   VO-5
   Voice and microphone capture stop immediately when the session ends or expires; no audio is written to disk.
   P1
   S
   VO-6
   Personal voice enrollment: the customer records or uploads a sample of their own voice (WAV, MP3 or FLAC with size and duration limits, decoded safely).
   P2
   M
   VO-7
   Consent and liveness check before a personal voice is created: the app shows a random phrase the customer must read live, and the live recording must match the sample. Fail closed.
   P2
   M
   VO-8
   Enrolled voices are stored only on the PC, encrypted with the OS keystore, with a delete button that wipes them.
   P2
   S
   VO-9
   No import of third-party voice models. Only bundled models in non-executable formats (ONNX, safetensors) are loaded.
   P1
   S
   VO-10
   Disclosure setting for AI-generated voice, on by default for personal voices. Research an inaudible audio watermark as a later option.
   P2
   M
   VO-11
   Optional lip-sync: drive the avatar's mouth from the audio to complement face tracking.
   P2
   M
   Virtual microphone. Calls can only receive the converted voice through a microphone device, so this needs its own component, separate from the virtual camera.
   ID
   Requirement
   Priority
   Size
   VM-1
   Route converted audio to other apps as a virtual microphone. Decision needed: (a) require a licensed third-party virtual audio cable, or (b) build an audio driver, which needs Microsoft driver signing and is much more work. Recommended: (a) first.
   P1
   L
   VM-2
   Keep audio and avatar mouth within 100 ms of each other; document known drift.
   P1
   M
   VM-3
   Add audio columns to the compatibility matrix. PASS means the app received live converted audio for 15 minutes, with the same evidence rules as video.
   P1
   M
   Acceptance
   • A default voice preview plays within 1 second of pressing it.
   • Conversion latency stays under 250 ms on a mid-range laptop CPU.
   • Voice output stops within 1 second of session expiry or End Session.
   • A personal voice cannot be created without passing the live phrase check.
   • No third-party model file can be loaded. A file and network monitor shows no audio written to disk or sent to a server.
   Risks and open questions
   • Impersonation fraud. Mitigations: own-voice-only enrollment, live phrase check, no third-party models, AI-voice disclosure, Terms, abuse reporting. A live check reduces misuse but cannot remove it, so decide whether personal voice ships at all. Recommended for launch: default voices only, with personal voice following once the safeguards are verified.
   • Low-end PCs. Detect hardware, offer a lighter model, and say when quality will suffer.
   • Virtual microphone approach. Decide between a third-party audio cable and our own driver (VM-1) before starting.
   • Consent and model licenses. Record consent for every default voice and check each model's license permits bundling and commercial use.
   • Languages. Decide which languages the default voices support.
   4.5 Background changing
   Background changing lets the customer choose what appears behind the avatar. It is an add-on unlocked by its own activation code (section 4.7) and works only inside an authorized session.
   Design decisions
   • Backgrounds are drawn in the local renderer. No background image is uploaded anywhere.
   • The default is the avatar scene background. Replacing the background of the real webcam picture is a separate mode (BG-5) and needs a product decision first.
   ID
   Requirement
   Priority
   Size
   BG-1
   Background screen: none, blur, solid colour, gradient or a built-in image, with a live preview behind the current avatar.
   P1
   S
   BG-2
   Ship 6 to 10 built-in backgrounds that are original or licensed, with each license recorded.
   P1
   S
   BG-3
   Custom image upload (PNG, JPEG or WebP, up to 10 MB and 4096 px per side). Validate type, size and dimensions, decode safely, store only on the PC, and allow deletion.
   P1
   M
   BG-4
   Render the background in the same scene as the avatar so both share one frame and the 30 fps target still holds.
   P1
   M
   BG-5
   Optional live-camera mode: replace the real background with MediaPipe Image Segmenter. This adds a second mode (real video instead of an avatar), so decide before building.
   P2
   L
   BG-6
   Locked state: without an activated Background code the screen offers a preview but cannot apply anything, and links to code entry. The backend enforces this at session start, not only the interface.
   P1
   S
   Acceptance
   • A background change appears within one frame and survives switching cameras.
   • Wrong file types, oversized files and corrupt images are rejected with a clear message.
   • A session started without the Background code cannot apply a background, even if the interface is modified.
   • A network monitor shows no image leaving the PC.
   4.6 Record, download and go live
   A Studio screen lets customers see their own face as an animated avatar, record a video of it, save the file to their PC, or go live with the same avatar in other video apps. Recording works without the native virtual camera, so it can ship before the live camera output.
   Design decisions
   • Opt-in per take. Nothing is recorded unless the customer presses Record, and no recordings are kept by default.
   • Everything stays on the PC. The backend never receives the video or audio.
   • Recording needs the Video code. It runs inside an authorized session and counts against the same 900 seconds (decision below). Saving a finished recording after the session ends is always allowed.
   • Go Live reuses the same setup. The avatar, voice and background chosen for the recording carry over to the live output.
   ID
   Requirement
   Priority
   Size
   REC-1
   Studio screen: live avatar preview, Record, Stop and Go Live buttons, recording timer, session countdown, audio level meter and tracking-quality indicator.
   P0
   M
   REC-2
   Record the rendered avatar at 30 fps and 720p with microphone audio (converted voice when the Voice add-on is on, chosen background when the Background add-on is on) using the browser recording API on the app's own canvas. Output WebM.
   P0
   M
   REC-3
   Review the take before saving. Save opens the Windows save dialog through a validated IPC call, so the main process writes only to the location the customer chose. Discard deletes the take.
   P0
   S
   REC-4
   Keep the take in memory or a temporary file inside the app's own folder, and delete it on discard, on save, on app exit and, after a crash, at the next launch. No hidden copies.
   P0
   S
   REC-5
   Recording stops automatically at session expiry or End Session. The take stays available to save, and the camera and microphone are released.
   P0
   S
   REC-6
   Go Live: one button that moves from the Studio to the virtual camera output with the same settings. It needs the explicit Start step and the native camera (NC-1 to NC-6), and it tells the customer which camera to pick in the other app.
   P1
   S
   REC-7
   MP4 export (H.264 and AAC) through a bundled encoder whose license permits commercial use, because many apps and phones prefer MP4.
   P1
   M
   REC-8
   Check free disk space before recording, offer 720p (default) or 1080p, and show an estimated file size.
   P1
   S
   REC-9
   Mark recordings as AI-generated: a metadata tag and an optional visible badge, on by default when a personal voice is used. Later, signed content credentials.
   P2
   M
   Acceptance
   • A 60-second take with face movement, voice and background saves and plays in Windows Media Player and in a browser, with audio and picture within 100 ms of each other.
   • After Discard, no recording file remains in the app's folders or the temp folder.
   • Recording stops within 1 second of session expiry, and the take can still be saved.
   • A network monitor shows no video or audio leaving the PC.
   • Go Live selects the virtual camera output once the native camera exists, and never starts without pressing Start.
   Risks and open questions
   • Decision: does recording count against the 900 seconds? Recommended for version 1: yes, which keeps one rule. The alternative is a separate recording allowance, which needs a new entitlement type in the backend.
   • Recording limits are enforced by the app only. The backend authorizes the session and add-ons but cannot see local recordings, so a modified copy could record without a session. State this plainly; do not oversell it.
   • Synthetic media can be shared as if real. Stylized built-in avatars, the AI-generated tag and badge (REC-9), and the Terms reduce this but cannot prevent it.
   • Encoder licensing. WebM works out of the box; MP4 needs an encoder with a suitable license (REC-7).
   • Audio sync and file size. Test long takes on low-end PCs and warn clearly when quality or space will suffer.
   4.7 Activation codes in the app
   There are three capabilities, each unlocked by its own activation code. The backend issues and validates the codes (see the Backend PRD, FC-4 to FC-8 and AC-1 to AC-8).
   Feature
   What the code unlocks
   Role in a session
   Video
   Face-tracked avatar, Studio and the virtual camera for one session of up to 900 seconds
   Required. It is the session itself.
   Voice
   Voice screen and voice conversion
   Add-on used inside a video session
   Background
   Background screen
   Add-on used inside a video session
   Rules (assumptions to confirm)
   • Each code is single-use and binds to one device when activated. A different computer needs new purchases.
   • A session always needs a Video code. Voice and Background codes apply only inside a session on the same device.
   • An add-on code is consumed when a session starts with that add-on switched on. An unused add-on stays available for a later session on that device.
   ID
   Requirement
   Priority
   Size
   FC-1
   Activation screen with three code fields (Video, Voice, Background) and a status for each: not activated, activated, used, revoked or expired. Video is required to start; add-ons are optional.
   P1
   S
   FC-3
   The Start Session step lets the customer switch add-ons on or off. Only activated, unused add-ons can be switched on.
   P1
   S
   FC-9
   Show each feature's lock state throughout the app. A locked screen offers a preview and a link to code entry. The app enables a feature only if the session response from the backend lists it.
   P1
   S
   Acceptance: a customer can activate Video, Voice and Background separately and sees each status correctly after an app restart. A modified client cannot use a feature the backend did not enable for the session.
   4.8 Native Windows virtual camera
   Why: this is what makes it a real virtual camera instead of an animation window. It is the hardest workstream and needs a Windows 11 machine (build 22000 or later) for the Media Foundation Virtual Camera API.
   ID
   Requirement
   Priority
   Size
   NC-1
   Media source COM DLL implementing the Media Foundation source interfaces, modeled on Microsoft's VCamSample.
   P1
   L
   NC-2
   Shared-memory frame ring (with correct security descriptors for the Frame Server service) and a signal event.
   P1
   L
   NC-3
   Electron-side native addon (N-API) that writes frames from the renderer into the ring.
   P1
   M
   NC-4
   Control pipe for status and version negotiation, restricted to the installing user.
   P1
   M
   NC-5
   Placeholder frame when no fresh frame arrives within 500 ms (never a frozen avatar).
   P1
   S
   NC-6
   Register and remove the camera with the registration tool; idempotent and safe to repeat.
   P1
   S
   NC-7
   Signed session grants: the backend signs {sessionId, device, enabled features, expiresAt}; the native layer shows only the placeholder without a valid unexpired grant.
   P2
   M
   NC-8
   No process injection and no tampering with other applications.
   P0
   n/a
   Acceptance: the camera appears in the Windows Camera app and receives live animated frames for 15 minutes without stalls over 200 ms. Crash, shutdown, upgrade and uninstall behave as listed in the test procedures. Known limit to state publicly: output limiting depends on a cooperating client until NC-7 exists, and even then cannot be made unbreakable.
   4.9 Installer, updates and release
   ID
   Requirement
   Priority
   Size
   IN-1
   NSIS installer via electron-builder that installs the app and the native components, with a clean uninstall and no leftover device or registry keys.
   P1
   M
   IN-2
   Authenticode code signing with the key held in a cloud signing service, never in the repository or installer.
   P1
   M
   IN-3
   Update flow: query the latest release, download through a short-lived URL, verify SHA-256 and signature, then install. Discard on mismatch.
   P1
   M
   IN-4
   App and native component version pairing with a compatibility table and a refusal on mismatch.
   P1
   S
   IN-5
   Interrupted-install recovery and rollback to the previous release.
   P1
   M
   IN-6
   Test install, upgrade, downgrade and uninstall on a clean Windows VM.
   P1
   M
   4.10 Quality and verification (desktop)
   ID
   Requirement
   Priority
   Size
   QA-1
   Install dependencies, launch the app against a running backend, fix failures, and record the real results.
   P0
   M
   QA-3
   End-to-end test of activate, start, restart, resume and end (Electron test runner).
   P1
   M
   QA-4
   Execute the hardware procedures: native camera tests, per-application compatibility, session scenarios. Record results in the compatibility matrix. Only dated PASS rows may be advertised.
   P1
   L
   QA-5
   Security review of the app: IPC surface, CSP, permission handling, local file handling, dependency audit.
   P1
   M
   QA-6
   CI pipeline running lint, typecheck and tests on every push.
   P1
   S
   QA-7
   Production builds contain no demo mode, mock services, test keys or placeholder features. The mock licensing service and its switch are removed from release builds, and a CI check fails the build if any are present.
   P0
   S
   4.11 Privacy and safety inside the app
   • Show a plain-language notice of what is processed locally and what the server sees (DS-5).
   • Show a visible indicator whenever the camera, microphone or voice conversion is active.
   • Offer an AI-generated indicator for custom images and personal voices (AV-5, VO-10, REC-9).
   • Link to the abuse-reporting contact from the Help screen.
5. Non-functional requirements
   • Performance: 30 fps at 720p tracking and rendering; end-to-end latency near 100 ms; voice conversion under 250 ms on a mid-range laptop CPU, with audio and avatar mouth within 100 ms of each other.
   • Security: keep the Electron sandbox, context isolation and validated IPC; no secrets in the renderer or installer; the private device key stays in the main process.
   • Privacy: no persistence of raw frames, landmark streams, audio or recordings except takes the customer saves; capture and background tasks stop when a session ends.
   • Reliability: the backend enforces the original expiry even if the app vanishes; a restart never resets the countdown.
   • Platform: Windows 11 build 22000 or later for the native camera. Windows 10 is unsupported unless an alternative implementation is chosen.
   • Accessibility: keyboard operable, visible focus, reduced-motion support, sufficient contrast.
6. Roadmap
   Milestone
   Contents
   Outcome
   M0: Prove the baseline
   QA-1
   The existing code runs against a live backend; real results exist
   M1: Core product
   FT-1 to FT-5, AV-1 to AV-3, DS-1 to DS-3, DS-8, REC-1 to REC-5, QA-7
   Customers can activate, see a face-tracked avatar, record, and run an authorized session with a server-controlled countdown
   M2: Full feature set
   DS-4 to DS-7, VO-1 to VO-5, VO-9, BG-1 to BG-4, BG-6, FC-1, FC-3, FC-9, REC-7, REC-8, QA-3, QA-6, FT-6, FT-7, AV-6
   Voice, background and three-code activation work end to end
   M3: Real virtual camera
   NC-1 to NC-6, IN-1 to IN-6, VM-1 to VM-3, REC-6
   The camera and microphone appear in other apps; installable and removable
   M4: Verified release
   QA-4, QA-5, NC-7, VO-6 to VO-8, VO-10, BG-5, REC-9, AV-4, AV-5, VO-11
   Only tested platforms are advertised
7. Risks and open questions
   Risk or question
   Mitigation or decision needed
   Native camera effort is large and needs Windows 11 hardware
   Treat as M3; use VCamSample as the base; do not release until the native camera passes its tests
   Target apps may reject software cameras
   Test early on a spike; document results; investigate alternatives only if needed
   Output limit can be bypassed by a modified client
   State the limit; add NC-7; do not oversell
   Device key loss locks a customer out
   Backend recovery with a mandatory reason; refused once the session is consumed
   Avatar, voice, model and background asset licensing
   Use original or clearly licensed assets; record in the repository
   Impersonation misuse (custom images, personal voice)
   Built-in avatars and default voices in v1; AV-5, VO-7, VO-10 and the Terms before any custom feature
   Virtual microphone approach, recording allowance, add-on rules
   Decisions listed in sections 4.4, 4.6 and 4.7
8. Definition of done
   Each requirement is done only when it has been built, run, and verified against its acceptance criteria, and its status is recorded as implemented, tested, partially tested, or untested. Code that has merely been generated is never reported as working.
