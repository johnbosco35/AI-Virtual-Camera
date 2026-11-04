# Manual and hardware test procedures

These need a Windows machine (Windows 11 build 22000 or later for the Media Foundation virtual camera API) and cannot be automated from the backend. Record outcomes in `compatibility-matrix.json` and the release notes.

## A. Native virtual camera

| Test | Steps | Expected |
| --- | --- | --- |
| Install and register | Run the installer on a clean VM | Camera component registered; `vcamctl status` shows installed |
| Enumeration | Open Windows Camera app and a Media Foundation enumeration tool | "AI Virtual Camera" listed |
| Frame delivery | Run the app with a test pattern | Valid frames in the supported formats (list them in the report) |
| Frame timing | Run 15 minutes at 30 fps, log timestamps | No stalls over 200 ms; drift documented |
| App shutdown | Close the app mid-stream | Consumers show the placeholder frame, not a frozen avatar |
| Camera-device shutdown | `vcamctl remove` while a consumer is open | Consumer handles disconnect without crashing |
| Reboot persistence | Reboot, if intended | Matches the documented lifetime policy |
| Upgrade and downgrade | Install N, then N+1, then N | Camera works; versions compatible per the release table |
| Uninstall | Uninstall the app | No leftover device, registry keys or files |
| Crash recovery | Kill the app process, then the Frame Server consumer | Device recovers; no orphan session output |
| Device in use | Open the camera in app A, then app B | Behavior documented (shared or exclusive) |
| Permissions | Test with Windows camera privacy off, standard user, and with antivirus | Failure messages are clear |

## B. Per-application compatibility

For each application in the matrix: select the camera in the application's own settings, confirm a live animated preview, then hold a real test call or preview for 15 minutes. Switch cameras and unplug/replug. Mark `PASS` only if every check succeeds. Record exact versions and Windows build. Google Meet: test supported browsers with a fresh camera permission prompt.

## C. Session scenarios on real hardware

| Scenario | Steps | Expected |
| --- | --- | --- |
| Normal session | Pay on testnet, activate, press Start | Output stops at or before server expiry; session at most 900 s |
| Duplicate start | Two clients or double click | One session; the second gets the same session or a refusal |
| App restart | Kill and relaunch the app mid-session | Same session resumes, original `expiresAt`, countdown not reset; refused after expiry |
| Different device | Activate the same code on another PC | `DEVICE_MISMATCH`; new purchase required |
| Reinstall | Reinstall on the original PC | Same device key proves identity; no new session |
| Network failure | Cut the network mid-session | See offline policy below |

**Offline policy (to implement in the desktop app):** the client never extends the deadline. It keeps output running only until the server-issued `expiresAt`. If heartbeats fail for more than 60 seconds it stops output (fail closed) and shows a reconnect state. On reconnect before expiry it resumes the same session via `/sessions/start`. A cached success response never creates or extends a session, because every start needs a fresh single-use challenge.

## D. Privacy checks

Confirm no frames, landmark streams or recordings are written to disk (watch the app's temp and user-data folders and `procmon` during a session), and that capture, rendering, shared memory writers and timers stop when a session ends.
