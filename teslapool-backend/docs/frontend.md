# Frontend integration guide (Next.js)

> **Reference implementation:** [`../teslapool-frontend`](../../teslapool-frontend/README.md). It goes same-origin instead of calling the API directly: Next.js rewrites `/api/v1/*` to `BACKEND_URL`, so the session cookie is first-party and no `NEXT_PUBLIC_API_URL` is needed.

Everything a frontend needs, in the order you'll need it. Full contract: [api.md](api.md) and the live Swagger UI at `/api/docs`.

## 1. Point the frontend at the API

| Environment | API base URL | Notes |
|---|---|---|
| `npm run dev` | `http://localhost:3000` | set the frontend to another port (e.g. `next dev -p 3001`) and add it to `CORS_ORIGINS` |
| `docker compose up` | `http://localhost:4000` | frontend on `http://localhost:3000` is already allowed |
| Render | `https://<service>.onrender.com` | set `CORS_ORIGINS` to your deployed frontend origin |

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://localhost:4000
```
CORS allows `Authorization`, `Content-Type`, `Idempotency-Key`, `X-Request-ID`, exposes `X-Request-ID`, `Idempotent-Replayed`, `RateLimit*`, and allows credentials.

**Auth, pick one:**
- **Cookie (recommended for browsers):** login/register set an HttpOnly `tp_session` cookie. Call the API with `credentials: 'include'` and never touch the token. Writes are CSRF-checked by `Origin` (automatic in browsers). Log out with `POST /auth/logout`. The reference web app proxies `/api/v1` through its own origin, so `AUTH_COOKIE_SAMESITE=lax` works in production. Only a browser app that calls the API directly from another site needs `AUTH_COOKIE_SAMESITE=none`.
- **Bearer:** keep `accessToken` in memory and send `Authorization: Bearer …` (mobile apps, scripts).

## 2. Generate types (no hand-written interfaces)

The OpenAPI contract is committed at `openapi/openapi.json` (regenerate with `npm run openapi:export`) and served at `/api/docs/openapi.json`.

```bash
npm i -D openapi-typescript && npm i openapi-fetch
npx openapi-typescript ../teslapool-backend/openapi/openapi.json -o src/lib/api-types.ts
```

## 3. A typed client in ~25 lines

```ts
// src/lib/api.ts
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './api-types';

let token: string | null = null;              // keep in memory (or an httpOnly cookie via a Next route handler)
export const setToken = (t: string | null) => { token = t; };

const auth: Middleware = {
  onRequest({ request }) {
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
};

export const api = createClient<paths>({ baseUrl: process.env.NEXT_PUBLIC_API_URL, credentials: 'include' }); // cookie sessions
api.use(auth);

/** Every response is { success, data, meta } or { success: false, error: { code, message, details, requestId } }. */
export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown, public requestId?: string) { super(message); }
}
export function unwrap<T>(r: { data?: { data: T }; error?: unknown }): T {
  if (r.error) {
    const e = (r.error as { error: { code: string; message: string; details?: unknown; requestId?: string } }).error;
    throw new ApiError(e.code, e.message, e.details, e.requestId);
  }
  return r.data!.data;
}
```

Usage:
```ts
const { accessToken, user } = unwrap(await api.POST('/api/v1/auth/login', { body: { email, password } }));
setToken(accessToken);

const ride = unwrap(await api.POST('/api/v1/rides', {
  body: { pickupZone: 'BANANI', dropoffZone: 'MOHAKHALI', requestedSeats: 1 },
  params: { header: { 'idempotency-key': crypto.randomUUID() } },
}));
```

## 4. Bootstrap: load reference data once

`GET /api/v1/meta` (public, cacheable 5 min) gives you everything needed to build forms and maps without hard-coding:

```ts
const meta = unwrap(await api.GET('/api/v1/meta'));
meta.zones            // [{ code: 'BANANI', name: 'Banani', center: { lat, lng }, neighbours: [...] }, …]  → pickup/dropoff selects, map markers
meta.distanceKm       // zone-to-zone km matrix (ZONE_GRAPH_DISTANCE) → instant distance preview
meta.vehicleTypes     // [{ code, name, maxSeats }] → seat picker max
meta.enums            // traffic, weather, timeOfDay, rideStatus, poolStatus, roles
meta.rideTransitions  // { MATCHED: ['DRIVER_ARRIVED','CANCELLED','REQUESTED'], … } → which buttons to show
meta.rules / meta.fare // capacity, detour, stop limits; currency + poysha info for display copy
```
`center` coordinates are approximate UI anchors, not routing data.

## 5. Screens → endpoints

**Passenger**
| Screen | Calls |
|---|---|
| Sign up / log in | `POST /auth/register`, `POST /auth/login`, then `GET /auth/me` on reload |
| Home: resume current ride | `GET /rides?status=ACTIVE&limit=1` (a passenger has at most one); show `phase` (`WAITING → MATCHED → IN_PROGRESS → COMPLETED / CANCELLED`) |
| Request ride | `POST /rides { pickupZone, dropoffZone, requestedSeats, paymentMethod: 'CASH' \| 'TESLAPAY' }` → show `estimatedFare`, the itemised `fareBreakdown` (base + distance + time), `estimatedDurationMinutes`, `poolOptions[].headline` |
| Wallet | `GET /wallet` (balance + ledger) · `POST /wallet/top-up { amountPoysha }` (simulated); `422 INSUFFICIENT_WALLET_BALANCE` on a TeslaPay request means "top up or choose cash" |
| Receipt | `GET /rides/:id` → `finalFare`, `payment { method, amount, settledAt }` |
| Find pool | `POST /rides/:id/match` (auto) **or** `POST /pools/:id/join` with a chosen `poolOptions[i].poolId` |
| "Why?" panel | `GET /rides/:id/explanation` → render `summary[]`, `match.reasons[]` (✓/✗ + `message`), `fare.lines[]`, `timeline[]` |
| Trip tracking | poll `GET /rides/:id` (status, `pool.fare`, sequences) and `GET /pools/:id` (route, co-riders' first names) |
| Leave / cancel | `POST /pools/:id/leave` (before driver arrives) · `POST /rides/:id/cancel` |
| History / receipt | `GET /rides?status=COMPLETED`, `GET /rides/:id/events` |

**Driver**
| Screen | Calls |
|---|---|
| Vehicles | `GET /vehicles`, `POST /vehicles`, `PATCH /vehicles/:id` |
| Go online | `POST /driver/online { vehicleId }` (idempotent) · `GET /driver/status` for the dashboard (online?, live pool, vehicles) |
| Incoming requests | `GET /pools/:id/requests` → each has `passengerFirstName`, `waitingSeconds`, `decision.headline` |
| Accept a request | `POST /pools/:id/accept { rideRequestId }` (same errors as join) |
| Dashboard (after reload) | `GET /pools?status=ACTIVE` → route + `passengers[]` with `rideRequestId`s |
| Per passenger | `POST /rides/:rideRequestId/arrive` → `/start` → `/complete` |
| Go offline | `POST /driver/offline` (`409 DRIVER_HAS_PASSENGERS` while anyone is assigned) |
| Earnings | `GET /wallet` (TeslaPay rides credit the driver; cash is collected in person) |

There are no WebSockets yet: poll every 3–5 s on trip screens. `pool.version` increments on every change, so you can skip re-rendering when it hasn't moved.

## 5b. Impact dashboard

`GET /api/v1/stats/impact` (public aggregates) feeds a dashboard directly: trips completed, passengers pooled, total savings, average occupancy, seat utilisation, match success rate, and `integrity.capacityViolations` (expected to be 0).

## 6. Money and numbers

- Use `amountPoysha` (integer) for anything you compute or compare; show `amountBdt`: `new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT' }).format(amountBdt)`.
- `discountPercent`, `detourKm`, `estimatedDistanceKm` are for display. Never re-price on the client; the server's number is the price.

## 7. Errors: branch on `error.code`

```ts
try { await joinPool(); }
catch (e) {
  if (!(e instanceof ApiError)) throw e;
  switch (e.code) {
    case 'CAPACITY_EXCEEDED':        return toast(`Only ${(e.details as any).available} seat(s) left`);
    case 'PICKUP_TOO_FAR':
    case 'DESTINATION_TOO_FAR':
    case 'DETOUR_TOO_HIGH':
    case 'MAX_STOPS_EXCEEDED':       return showWhy((e.details as any).decision.checks); // per-rule ✓/✗ list
    case 'INVALID_STATE_TRANSITION': return refetchRide();
    case 'UNAUTHORIZED':             return redirectToLogin();   // details.reason === 'TOKEN_EXPIRED' after 1 h
    case 'RATE_LIMIT_EXCEEDED':      return retryLater();
    default:                         return toast(`${e.message} (ref ${e.requestId})`);
  }
}
```
`VALIDATION_ERROR` carries `details.errors: [{ field, message }]`: map `field` onto form inputs.

## 8. Explaining a match to users

Every `MatchDecision` has `checks[]` (`{ rule, passed, code, detail }`), `route`, `detourKm`, `capacity { before, requested, after }`, `fare { farePoysha, soloFarePoysha, discountPercent }` and `alternatives[]` (other stop orders with their violations). Every decision also has `headline` and `checks[].message` in plain language, so a "Why this pool?" panel can render `checks.map(c => (c.passed ? '✓ ' : '✗ ') + c.message)` directly. A rejected join has the same object at `error.details.decision`. For a whole-ride story (including fare and timeline) use `GET /rides/:id/explanation`.

## 9. Retries and double-clicks

Send `Idempotency-Key: crypto.randomUUID()` (generated once per user action, reused on retry) for ride creation, match, join, leave and cancel. A network retry then returns the original result (`Idempotent-Replayed: true`) instead of creating a second ride.

## 10. Demo accounts

With `SEED_ON_START=true` (docker compose default) or `npm run db:seed`: the story cast `jashim@` (driver of **Bullet**, already online), `nusrat@`, `rafiq@`, `shirin@` (passengers with TeslaPay balances) and `ops@teslapool.dev` (admin), with passwords `Passenger@2026` / `Driver@2026` / `Admin@2026` (README "Demo credentials"). New sign-ups confirm their email with a 6-digit code (`POST /auth/email/verify`); check `user.emailVerified` and `GET /meta` → `auth.emailVerification`.
