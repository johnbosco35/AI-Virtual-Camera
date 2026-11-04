# @avc/api

Express + TypeScript + MongoDB backend: orders, USDT TRC-20 verification, device-bound licensing, single-session enforcement, admin API.

## Status

Written and reviewed, **not yet executed**: dependencies could not be installed where this was authored, so run `npm install && npm test` first and fix anything that surfaces. Payment verification against the real TRON network is untested until you run it on Nile or Shasta.

## Run locally

```bash
npm install
cp .env.example .env     # fill in secrets, destination address, test token contract
npm run db:init-indexes
npm run db:seed
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-long-passphrase' npm run admin:create
npm run dev
npm test                 # first run downloads a MongoDB binary
```

Use a **receive-only** wallet address. The server never holds a private key.

## Testnet vs real payments

- `TRON_NETWORK=nile` or `shasta` needs `TRON_USDT_CONTRACT` set to a test token you control.
- `NODE_ENV=production` refuses to start unless `TRON_NETWORK=mainnet` and secrets are not placeholders.
- There is no fake payment mode in the runtime. Tests inject a stub provider; production always uses TronGrid.

## Design notes

- **Atomic consumption:** one `findOneAndUpdate` on the entitlement (`session.consumed: false → true`) decides the winner. No transactions required, so it works on a standalone MongoDB. If session creation then fails, the entitlement stays consumed, the failure is audited, and the orphan reconciler records it. Support resolves it explicitly.
- **Idempotent payments:** unique indexes plus resumable steps. A crash between steps is repaired by the reconciler.
- **Retention:** only `VideoSession` has a TTL index (`deleteAt`, `expireAfterSeconds: 0`). TTL runs about once a minute, so deletion is "scheduled", not instant. Expiry is enforced by the API and a 15 s reaper regardless. Orders, payments, entitlements, activations and audit logs have no TTL and no delete path.
- **Activation codes** are derived from the entitlement id with `SERVER_SECRET`; only a keyed hash is stored. Rotating `SERVER_SECRET` invalidates issued codes.
- **Time:** the API server clock is authoritative. Run NTP.

## Known gaps

- Release files are served from local disk; swap `releaseService` for object storage (signed URLs) in production.
- Admin auth has no refresh tokens or MFA yet.
- Device keys are only as strong as where the desktop app stores them (planned: Electron `safeStorage`, ideally TPM-backed).
- Rate limits are per-process; use a shared store behind multiple instances.
