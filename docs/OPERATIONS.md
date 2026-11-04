# Operations and monitoring

Signals come from the audit log (`auditlogs`, `severity`), structured logs and `GET /api/health/ready`.

| Concern | Signal | Alert when |
| --- | --- | --- |
| Payment verification failures | audit `payment.rejected.*`, `PROVIDER_UNAVAILABLE` errors | Provider errors for over 5 minutes, or a spike in rejections |
| Duplicate transaction attempts | audit `payment.rejected.replay`, `payment.rejected.order_already_paid` | Any burst from one IP |
| Failed activations | audit `activation.device_mismatch`, `activation.unknown_code`, `device.bad_signature`, `device.challenge_replay` | Repeated per code or per IP |
| Session authorization failures | audit `session.start.device_mismatch`; HTTP 401/403/409 on `/api/sessions/*` | Spike over baseline |
| Session expiry errors | audit `session.create_failed_after_consume`, `session.orphan_recorded` | Any occurrence (support must act) |
| Missing TTL index | audit `security.ttl_index_missing`, fatal log, readiness 503 | Immediately |
| Unusual database growth | Atlas storage alerts | Collection growth outside the expected range |
| Failed cleanup | Active sessions older than `expiresAt` (query `status: active, expiresAt < now - 2 min`); job error logs | Any result |
| Virtual camera crashes, installer failures | Needs opt-in client telemetry | Not built |

## Known monitoring gaps

- No metrics endpoint yet; add counters per error code and per job run.
- Client crash and installer telemetry does not exist. If added, it must be opt-in and exclude frames and biometric data.
- The audit log is permanent by design. Archive old entries to cold storage instead of deleting them.

## Runbooks

- **Session consumed but never usable** (`session.orphan_recorded`): the entitlement stays consumed by design. Support verifies the customer, then uses an explicit, approved business process. No admin endpoint grants extra sessions.
- **Lost PC, same purchase**: support verifies identity, then an admin calls `entitlements/:id/recover` with a reason. Refused once the session is consumed.
- **Payment made, not credited**: run reconcile, or use `manual-payment` with the transaction hash (still verified on chain).
