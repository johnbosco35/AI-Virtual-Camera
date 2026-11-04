# Release, update and recovery

## Versioning

SemVer for the app (`apps/desktop/package.json`) and a separate version for the native component. A compatibility table maps each app version to the native versions it accepts. The app checks the component version over the control pipe and refuses to run against an incompatible one.

## Build and signing

- CI builds the NSIS installer with `electron-builder` and the native component with CMake.
- Sign the installer and native binaries with an Authenticode certificate held in a cloud HSM or signing service. No signing keys or backend secrets in the repository or installer.
- Publish the version, SHA-256 and size through `POST /api/admin/releases`. The installer file goes to private storage.

## Updates (not implemented)

Plan: the app asks `/api/releases/latest`, downloads through a signed URL, verifies the SHA-256 and the Authenticode signature, and only then runs the installer. Unsigned or hash-mismatched packages are discarded.

## Failure handling

- **Interrupted install:** re-run the installer; `vcamctl remove` and registration are idempotent. Verify on a clean VM.
- **Bad release:** deactivate it with `PATCH /api/admin/releases/:id {active:false}` so `/latest` returns the previous version.
- **Downgrade:** supported only if the compatibility table allows the paired native version.
- **Backend rollback:** redeploy the previous image. Indexes are additive, so rollback is safe.

## Reminder

Installers can be copied. Licensing is enforced by the backend (device key and single-session consumption), not by hiding the installer.
