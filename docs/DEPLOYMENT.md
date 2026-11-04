# Production deployment plan

Nothing below has been exercised; treat it as the plan to follow and verify.

| Piece | Recommendation |
| --- | --- |
| Website | Static build on a CDN host (Cloudflare Pages, Netlify, or S3 + CloudFront). HTTPS only, HSTS |
| API | Container (`apps/api/Dockerfile`) on a managed platform or VPS behind a TLS-terminating proxy. Set `TRUST_PROXY` to the number of proxies. Run 2+ instances only after moving rate limits to a shared store |
| MongoDB | Managed replica set (Atlas or equivalent). Private networking or IP allowlist, per-service user with least privilege, continuous backups with point-in-time recovery |
| Payments | TronGrid API key in the secret store. A receive-only wallet; its keys are never on the server. Start on Nile, then switch `TRON_NETWORK=mainnet` |
| Installers | Private object storage. Replace the local-disk streaming in `releaseService` with short-lived signed URLs |
| Secrets | Platform secret manager. Never commit `.env`. Rotate `JWT_SECRET` freely; do **not** rotate `SERVER_SECRET` without a migration, because it derives activation codes |
| Admin access | Separate hostname, IP allowlist or VPN, strong unique passwords. Add MFA before launch |
| Domains | `example.com` (site), `api.example.com` (API). Restrict `CORS_ORIGINS` to the site origin |

## Release steps

1. `npm ci && npm test` (must pass).
2. `npm run db:init-indexes` against production (verifies the TTL index).
3. Deploy, then check `GET /api/health/ready` returns 200 (database up and TTL index present).
4. Seed the product and create the first superadmin with the one-off scripts.
5. Do a testnet purchase end to end before switching to mainnet.

## Backup and recovery

- Atlas continuous backup, restore drills each quarter.
- Priority collections: `orders`, `payments`, `entitlements`, `deviceactivations`, `auditlogs`. `videosessions` and `usednonces` are disposable.
- After any restore, run payment reconciliation (`POST /api/admin/payments/reconcile`) so payments made during the gap are applied.
