# Definition of Done: honest status

Legend: **Implemented** = code exists. **Build-checked** = desktop TypeScript/build completed. **Hardware-unverified** = webcam/Windows behavior has not been verified on target hardware. **Not done** = unavailable.

Desktop typecheck and production web/Electron bundle builds completed. Installer packaging was blocked in this environment because Windows denied symlink creation during electron-builder setup. Browser smoke tests exercised screen navigation and custom-image validation. Webcam face-motion acceptance, file/network monitoring, and target-hardware testing remain outstanding.

| Requirement | Status |
| --- | --- |
| Real USDT TRC-20 payment independently verified | Written; never run against Nile or mainnet |
| One device activation per purchase | Written, test written |
| One session per purchase | Written, test written |
| Session start needs explicit customer action | Written (Start button; API needs a signed challenge) |
| Atomic entitlement consumption | Written, concurrency test written |
| Backend enforces the 900 s expiry | Written, test written |
| App restart does not reset the session | API: written, test written. Desktop app: not done (still mock) |
| Different computer needs a new purchase | Written, test written |
| `deleteAt` = `endedAt` + 5 minutes | Written, test written |
| TTL index verified | Written; real-database test written |
| TTL asynchrony understood | Documented; real-deletion test written |
| Deleting a session never restores the entitlement | Written, test written |
| Durable records preserved | Written, test written |
| Webcam frames not retained or sent over the network | Local capture/tracking path does not save frames; CSP restricts renderer connections to the app and localhost API; file/network monitor verification remains outstanding |
| Face tracking in local worker with bundled model/WASM | Implemented; build-checked; hardware-unverified |
| Three.js avatar rendering to a canvas | Implemented; build-checked; face-motion and frame-rate acceptance remain hardware-unverified |
| Three original built-in avatar choices | Implemented as project-authored SVG illustrations; not hardware-tested |
| Custom avatar picture import and face-mesh reenactment preview | Implemented experimentally: PNG/JPEG/WebP, 10 MB limit, dimensions and signature checked, explicit own-image attestation, local mesh warp, persistent AI label, memory-only; hardware-unverified and may distort |
| Camera/tracking settings and PRD navigation screens | Implemented; recording and native-camera pages clearly show unavailable functionality; no accessibility audit |
| VO-4 microphone choice, input meter, mute and active indicator | Implemented; Windows device permissions and cable routing hardware-unverified |
| VO-5 audio stops at end/expiry, no audio written to disk | Screen teardown and expiry stop implemented; file/network monitoring remains outstanding |
| Voice conversion, licensed model, personal voice, virtual microphone cable | Conversion/enrollment unavailable; unchanged-voice routing requires a user-installed licensed cable; no bundled model or cable |
| BG-1/BG-2 local background previews | Eight original canvas-rendered scenes; preview tested in browser; render performance hardware-unverified |
| BG-3 custom background image | PNG/JPEG/WebP, 10 MB limit, dimensions/signature/decode checked; in-memory only, deletable |
| BG-4 same-scene rendering | Implemented in shared Three.js avatar canvas; 30 fps target remains hardware-unverified |
| BG-6 Background add-on authorization | Not implemented: backend does not expose feature-specific grants; Apply remains disabled and selection is preview-only |
| Session end releases webcam and tracking worker | Component teardown implemented; real server expiry path and hardware verification remain outstanding |
| Native virtual camera gives real generated frames to conferencing apps | **Not done** (design and registration skeleton only; the animated canvas is an in-app preview and is not an outgoing call stream) |
| Every advertised platform passed compatibility | **Not done** (all `NOT_TESTED`; advertise none) |
| Unsupported/partial platforms documented | Process and matrix in place |
| Installer, upgrade, uninstall tested | **Not done** |
| Security and integration tests pass | Written, not run |
| Production config, monitoring, recovery documented | Documented (`DEPLOYMENT.md`, `OPERATIONS.md`, `RELEASE.md`), not exercised |

**The platform is not release-ready.** The native camera, real desktop-to-API wiring, customer website, functional recording, licensed voice conversion, feature-specific authorization, and hardware verification remain open. Custom-picture face-mesh deformation is experimental, locally preview-only, and does not transmit to a call partner.
