# Native virtual camera: design

**Status: design and a registration tool skeleton only. The media source DLL is not written. Nothing here has been built or run.**

Electron cannot create a camera device. The camera must be a native component using the documented Windows Media Foundation Virtual Camera API (Windows 11, build 22000+, SDK 10.0.22000+). No process injection and no tampering with other applications.

## Components

1. **Media source DLL (`avc_mediasource.dll`, not written).** A COM class implementing `IMFMediaSourceEx`, `IMFMediaStream2`, `IMFGetService` and `IKsControl`, loaded by the Windows Camera Frame Server. Microsoft's `VCamSample` in the Windows-classic-samples repository is the reference to start from. It reads frames from shared memory and outputs them. When no fresh frame arrives for 500 ms it outputs a "No active session" placeholder, never a frozen avatar.
2. **Registration tool (`vcamctl`, skeleton included).** Creates and removes the virtual camera with `MFCreateVirtualCamera`, called by the installer.
3. **Frame transport.** A shared memory ring buffer (3 frames, 1280x720, NV12 and BGRA) plus a named event. The writer is the Electron main process through a small N-API addon (not written). Frame Server runs under a service account in session 0, so the section and event need explicit security descriptors and `Global\` names. This must be verified on a real machine.
4. **Control channel.** A named pipe, ACL'd to the installing user, for status and version negotiation.

## Session enforcement in the native layer (recommended, not implemented)

The backend can stop a session from being authorized, but it cannot stop a modified local client from writing frames. To make the 15-minute limit harder to bypass, the server signs a short grant `{sessionId, deviceFingerprint, expiresAt}` with a server Ed25519 key at session start. The media source embeds the matching public key, requires a valid unexpired grant in the frame header, and shows the placeholder otherwise. This raises the bar but cannot make a client-side check unbreakable. The README states this limitation.

## Lifecycle and recovery

- Register with a system lifetime so the device survives reboot (verify the admin and access requirements in the current docs).
- Installer order: install DLL, register COM class, run `vcamctl install`. Uninstall reverses it. A failed install must roll back via the installer's transaction or a repair command (`vcamctl remove` is idempotent).
- Version pairing: the app reads the component version over the control pipe and refuses to run against an incompatible one (see `docs/RELEASE.md`).

## Open questions to resolve on hardware

Pixel formats accepted by each target app, exclusive versus shared device behavior, behavior under Windows camera privacy settings, and whether each target app lists software camera sources at all.
