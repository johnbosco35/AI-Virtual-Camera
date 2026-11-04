# Engineering report

Date of this snapshot: 2026-10-25. Status wording: implemented (code exists), tested (automated test passing), untested.

## 1. Implemented features

- Desktop shell: hardened Electron, validated IPC, webcam preview with device handling, mock activation and countdown. Untested.
- Backend: orders, USDT TRC-20 verification, reconciler, device-key activation, single-session consumption, cleanup jobs, downloads, admin API with RBAC and audit log. Untested (tests written).
- Documentation, compatibility matrix with integrity test, deployment/operations/release plans.

## 2. Incomplete

Native virtual camera (media source DLL, frame transport, installer integration), face tracking and avatar rendering, desktop-to-API client and device key, customer website, auto-update, installer packaging and signing, client telemetry, admin MFA, object-storage downloads, shared rate-limit store.

## 3. Architecture

Monorepo: `apps/desktop` (Electron + React), `apps/api` (Express + Mongoose), `native/virtualcam` (C++ design and skeleton), `docs`. API layers: routes, controllers, services, models, middlewares, validators, jobs.

## 4. API

See `apps/api/docs/API.md`.

## 5. Database

Models in `apps/api/src/models`. Key indexes: unique `(network, txHash)` and `orderId` on payments; unique `orderId` and `activationCodeHash` on entitlements; partial unique active activation per entitlement; partial unique active session per entitlement; partial unique pending amount per destination; TTL on `VideoSession.deleteAt` (0 s) and `UsedNonce.expireAt`. No TTL on durable collections.

## 6. Payment workflow

Order gets an exact unique amount. Verification reads the transaction from TronGrid (solidified only), checks contract, destination, amount, success and chain-time window, then records the payment and creates one entitlement. The reconciler repairs partial steps and auto-matches incoming transfers.

## 7. Session licensing and cleanup

Start spends the entitlement with one atomic update, then creates the session with a server-set 900 s expiry. Heartbeat never extends it. End and expiry set `endedAt` and `deleteAt = endedAt + 5 min`. The TTL monitor deletes the record asynchronously. Consumption state lives on the entitlement and survives deletion.

## 8. Native camera

Design only (`native/virtualcam/DESIGN.md`) plus an unbuilt registration skeleton.

## 9. Compatibility matrix

All nine rows are `NOT_TESTED` (`docs/compatibility-matrix.json`). No real results exist.

## 10. Security considerations and limits

- Anyone can copy the installer; licensing relies on the backend.
- The 15-minute limit on **frame output** is enforced by a cooperating client. A modified client could keep writing frames locally. The native-layer signed grant in `DESIGN.md` raises the bar but cannot make it unbreakable.
- Device keys are only as safe as their local storage.
- Exact-amount payment matching means customers who send a different amount, or whose exchange deducts fees, are not auto-credited and need support.
- Admin accounts lack MFA.

## 11. Local development

See the root `README.md`, `apps/desktop`, and `apps/api/README.md`.

## 12. Production deployment

See `docs/DEPLOYMENT.md`.

## 13. Automated test results

Not run. Suites written: payments (idempotency, replay, mismatches, finality, window), activation, sessions, cleanup, TTL integration against a real mongod, API validation and admin RBAC, compatibility matrix integrity.

## 14. Release and recovery

See `docs/RELEASE.md` and `docs/OPERATIONS.md`.
