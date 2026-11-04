# API reference

Base path `/api`. JSON in, JSON out. Errors: `{ "error": { "code", "message", "details?" } }`.

## Public

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/products` | Active products with the authoritative price |
| POST | `/orders` | `{productId}` → order with exact amount, destination, expiry |
| GET | `/orders/:orderId` | Order status (`awaiting_payment`, `payment_detected`, `confirming`, `verified`, `failed`, `expired`). When verified: `entitlementId` and `activationCode` |
| POST | `/payments/verify` | `{orderId, txHash}`. Independent on-chain check. Adds `already_used` as an outcome |
| GET | `/entitlements/:id` | Needs header `x-activation-code` |
| POST | `/devices/challenge` | `{purpose}` → single-use challenge (60 s) |
| POST | `/activations` | `{activationCode, proof}` bind this device |
| POST | `/activations/verify` | `{activationCode, proof}` confirm binding on launch |
| POST | `/sessions/start` | `{entitlementId, proof}` consumes the entitlement, returns session |
| GET | `/sessions/:id` | Signed headers |
| POST | `/sessions/:id/heartbeat` | Signed headers. Never extends expiry |
| POST | `/sessions/:id/end` | Signed headers. Idempotent |
| GET | `/releases/latest` | Version, size, SHA-256 |
| POST | `/downloads` | `{orderId}` → short-lived signed URL (paid orders only) |
| GET | `/downloads/:token` | Streams the installer |

## Device proofs

Devices hold an Ed25519 key pair; the private key never leaves the device.

- **Challenge proof** (activate, verify, session start): `POST /devices/challenge`, then sign the UTF-8 string `"<challenge>|<context>"`. Context is the normalized activation code (activate, verify) or the entitlement id (session start). Body `proof = { publicKey (base64 SPKI DER), challenge, signature (base64) }`. Challenges are HMAC-signed, expire in 60 s, and work once.
- **Timestamp proof** (get, heartbeat, end): headers `x-avc-ts` (epoch ms, within ±60 s) and `x-avc-sig` = signature of `"<action>|<sessionId>|<ts>"` where action is `session:get`, `session:heartbeat` or `session:end`. Verified against the key stored at activation.

## Payment rules

- Network TRON, token USDT TRC-20, contract from configuration.
- Each pending order gets a unique exact amount (base price + 0.000001 to 0.009999 USDT). The customer must send exactly that amount. Any other amount is rejected.
- A payment counts only when the transaction is **solidified** (irreversible), succeeded, contains a `Transfer` from the configured contract to the configured address for the exact amount, and its chain timestamp falls inside the order window.
- `(network, txHash)` is unique, and one payment per order is enforced by index.
- A background reconciler also matches confirmed incoming transfers to orders, so customers who never submit a hash still get verified.

## Admin (`/api/admin`, bearer JWT, RBAC)

Login: `POST /auth/login`. Then, with the listed permission:

| Path | Permission |
| --- | --- |
| `GET/POST/PATCH /products` | `products:read` / `products:write` |
| `GET /orders`, `GET /orders/:id` | `orders:read` |
| `POST /orders/:id/manual-payment` | `payments:manual` (still verified on chain; reason required) |
| `GET /payments`, `POST /payments/reconcile` | `payments:read` / `payments:reconcile` |
| `GET /entitlements[/:id]` | `entitlements:read` |
| `POST /entitlements/:id/revoke` | `entitlements:revoke` (reason required) |
| `POST /entitlements/:id/recover` | `entitlements:recover` (reason required; refused once consumed) |
| `GET /activations`, `GET /sessions[/:id]` | `activations:read`, `sessions:read` |
| `POST /sessions/:id/terminate` | `sessions:terminate` |
| `GET/POST/PATCH /releases` | `releases:read` / `releases:write` |
| `GET /audit-logs`, `GET /stats` | `audit:read`, `stats:read` |
| `GET/POST/PATCH /admins` | `admins:manage` |

There is deliberately no endpoint that grants extra sessions.
