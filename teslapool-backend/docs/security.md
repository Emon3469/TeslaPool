# Security

Threat model: public HTTP API used by passengers, drivers and a future web/mobile frontend. Assets: user accounts, ride/location data, prices, pool integrity (no overbooking), audit history.

## Controls

| Area | Control | Where |
|---|---|---|
| Passwords | Argon2id (19 MiB, t=2, p=1, OWASP minimum); never returned or logged | `src/auth/password.ts` |
| Browser sessions | JWT in an **HttpOnly**, `SameSite=Lax` (configurable), `Secure`-in-production cookie: XSS can't read it. **CSRF:** cookie-authenticated `POST`/`PATCH` must carry an `Origin` (or `Referer`) in the allow-list, else `403 CSRF_ORIGIN_REJECTED`; Bearer requests are unaffected (browsers don't attach them automatically); `SameSite=none` is refused without `Secure` | `src/auth/session-cookie.ts`, `auth.middleware.ts` |
| Tokens | HS256 JWT, **algorithm pinned** on verify (no `alg=none` / confusion), `iss` + `aud` checked, 1 h expiry; secret ≥ 32 chars, **startup fails in production with the dev default** | `src/auth/tokens.ts`, `src/config/env.ts` |
| Session truth | every request re-loads the user: deactivated accounts and role changes apply immediately; the role claim in the token is **not** trusted for authorization | `auth.middleware.ts` |
| RBAC | `requireRole(...)` per route; ADMIN cannot be self-registered | module routers |
| Object-level authz (IDOR) | ride: owner / admin / driver of its pool; vehicle: owner / admin; pool view: driver / admin / member; lifecycle: driver of **that** pool; join: own ride only | services |
| Privacy | response DTOs whitelist fields; co-riders see first name + zones only, never email, phone, ride id or fare | `*.dto.ts`, `pools.module.ts` |
| Validation | zod `.strict()` everywhere: unknown fields rejected (mass assignment impossible), UUIDs, enums, ranges, lengths, Dhaka bounding box for coordinates, seat limits | `*.module.ts` |
| Derived values | distance, ETA, fare and surge are **server-computed**; clients cannot submit prices or surge | `rides.service.ts` |
| SQL injection | Prisma parameterised queries; the only raw SQL is tagged-template `FOR UPDATE` (parameterised) and a `CREATE DATABASE` in test setup with a regex-validated identifier | `common/db.ts` |
| Brute force / abuse | rate limits: auth 20 / 15 min / IP; rides 30 / min / user; predictions 60 / min / user; global 300 / min / IP (all configurable) | `rate-limit.middleware.ts` |
| Enumeration / timing | login always performs one Argon2 verification (dummy hash for unknown emails) and returns the same message | `auth.module.ts` |
| Replay | `Idempotency-Key` on ride create, match, join, leave, cancel: per-user scope, payload hash (reuse with a different body → 422), in-flight lock (→ 409), 24 h TTL | `idempotency.middleware.ts` |
| Oversized / malformed input | 32 KB JSON limit (413), strict JSON parsing (400 `MALFORMED_JSON`), 30 s request timeout | `app.ts`, `main.ts` |
| Headers | Helmet: `nosniff`, frame denial, HSTS, referrer policy, CORP; API CSP `default-src 'none'`; `x-powered-by` removed | `app.ts` |
| CORS | explicit allow-list from `CORS_ORIGINS`; `*` refused in production | `app.ts`, `env.ts` |
| Error hygiene | uniform envelope; no stack traces, SQL, Prisma messages or hostnames in responses (verified by test); full detail logged server-side under the request id | `error.middleware.ts` |
| Log injection | incoming `X-Request-ID` accepted only if `[A-Za-z0-9._:-]{8,128}`, otherwise replaced | `request-context.middleware.ts` |
| Money | Integer poysha only; TeslaPay balance maintained by a DB trigger from an append-only ledger (overdraft impossible, sign-checked entries, one payment/earning per ride via unique index); payments append-only; simulated top-ups bounded (৳1–৳10,000) and idempotency-keyed | `payments/`, migration `…000100` |
| Integrity | DB CHECKs, partial unique indexes, `RESTRICT` foreign keys, append-only triggers on event tables, a capacity-guard trigger (no overbooking even without the app lock) and a DB-owned occupancy counter | migrations |
| Secrets | none committed; `.env` git-ignored; `.env.example` has placeholders; Render generates `JWT_SECRET` | `.gitignore`, `render.yaml` |
| Container | multi-stage, production deps only, runs as non-root `node`; ML sidecar runs as uid 10001 | `Dockerfile`, `ml/Dockerfile` |

## CSP and the future frontend

The API only serves JSON, so it sends the strictest CSP (`default-src 'none'; frame-ancestors 'none'`). A Next.js frontend is served from its **own** origin with its own CSP, so nothing here constrains it. The Swagger UI at `/api/docs` gets a relaxed, self-only policy (`script-src 'self'`, inline styles allowed) because it is an HTML page.

## Attack checklist (spec §72)

| Attack | Mitigation | Test |
|---|---|---|
| Brute-force login / credential stuffing | IP rate limit, Argon2 cost, generic errors | config; `auth-security.test.ts` |
| JWT tampering / `alg=none` / wrong audience / expiry | pinned HS256, iss/aud, exp | `auth-security.test.ts` |
| Forged role claim | role read from DB | `auth-security.test.ts` |
| IDOR on rides, vehicles, pools | object-level checks | `rides.test.ts`, `pools.test.ts` |
| Mass assignment (`role`, `isActive`, fares, surge) | strict schemas, explicit mapping | `auth-security.test.ts`, `rides.test.ts` |
| SQL injection | parameterised only | code review (no string-built SQL) |
| Malformed / oversized payloads | 400 / 413 | `auth-security.test.ts` |
| Privilege escalation to ADMIN | not self-assignable | `auth-security.test.ts` |
| CSRF on cookie sessions | Origin allow-list for cookie-authenticated writes, SameSite | `innovations.test.ts` |
| Replayed mutations | idempotency keys + DB uniqueness | `rides.test.ts`, `last-seat.test.ts` |
| Race conditions (overbooking) | row locks + CHECK + partial unique | `last-seat.test.ts` |

## Known gaps / accepted risks

- **Rate limiting is per instance** (in-memory). With several replicas, use a shared store (Redis) for `express-rate-limit`.
- **No refresh tokens / revocation list.** Access tokens are short-lived (1 h) and account deactivation is enforced per request; refresh-token rotation is a planned addition.
- **Registration reveals whether an email exists** (`EMAIL_ALREADY_REGISTERED`), a usability tradeoff mitigated by rate limiting. Login does not reveal it.
- **`npm audit`**: 3 "high" findings, all the same advisory in `deepmerge-ts`, used only by the Prisma **CLI** config loader to merge our own trusted config; not reachable from request input. The suggested fix is a Prisma downgrade, so it is accepted and tracked.
- **Seed accounts** use one password per role (`SEED_PASSENGER_PASSWORD` / `SEED_DRIVER_PASSWORD` / `SEED_ADMIN_PASSWORD`); the documented defaults are for reviewer demos only. `SEED_ON_START` defaults to `false`.
- **Email codes**: only an HMAC of each 6-digit code is stored; 10-minute expiry, 5 attempts reserved atomically, 60 s resend cooldown, previous code voided on resend; password-reset requests always answer 202 (no account enumeration). The Brevo API key travels only in the `api-key` header and is never logged.
