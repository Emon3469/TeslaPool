# API contract (for frontend developers)

**Building a frontend? Start with [frontend.md](frontend.md)** (typed client, screens → endpoints, error handling).

Interactive, always-current contract: **`/api/docs`** (Swagger UI) and **`/api/docs/openapi.json`** (OpenAPI 3, generated from the same zod schemas that validate requests: use it with `openapi-typescript` to generate client types).

Base path: `/api/v1`. JSON only. Money: integer **poysha** (`amountPoysha`), with `amountBdt` for display.

## Conventions

**Success envelope**
```json
{ "success": true, "data": { }, "meta": { "requestId": "…", "page": 1, "limit": 20, "total": 3, "totalPages": 1 } }
```
**Error envelope**
```json
{ "success": false, "error": { "code": "CAPACITY_EXCEEDED", "message": "The requested number of seats is not available.", "details": { "requested": 2, "available": 1, "decision": { } }, "requestId": "…" } }
```
- Branch on `error.code`, never on `message`.
- `X-Request-ID`: send one (8–128 chars `[A-Za-z0-9._:-]`) or receive a generated one; it is echoed in the header, in `meta.requestId`/`error.requestId`, and in server logs.
- Pagination: `?page=1&limit=20`, `limit ≤ 100`.
- Idempotency: send `Idempotency-Key: <uuid>` on `POST /rides`, `/rides/:id/match`, `/rides/:id/cancel`, `/pools/:id/join`, `/pools/:id/leave`. A retry with the same key and body returns the original response with `Idempotent-Replayed: true`. Same key + different body → `422 IDEMPOTENCY_KEY_REUSED`; while the first is still running → `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`.
- Rate limiting: `429 RATE_LIMIT_EXCEEDED`, with `RateLimit` / `RateLimit-Policy` headers.
- Unknown JSON fields are rejected (`400 VALIDATION_ERROR` with `details.errors[]` = `{ field, message, code }`).

## Authentication flow

```
POST /api/v1/auth/register  { name, email, password, role: "PASSENGER" | "DRIVER", phone? }  → 201 { accessToken, tokenType, expiresIn, user }
POST /api/v1/auth/login     { email, password }                                         → 200 { accessToken, … }
then EITHER  Authorization: Bearer <accessToken>
     OR     rely on the HttpOnly `tp_session` cookie set by register/login (browsers: fetch(..., { credentials: 'include' }))
(expires in 1 h; on 401 with details.reason = TOKEN_EXPIRED, log in again)
POST /api/v1/auth/logout                                                                → clears the cookie
GET  /api/v1/auth/me                                                                     → 200 user
POST /api/v1/auth/email/verify { code }                                                  → 200 user (emailVerified: true)
```
Browsers should prefer the cookie (XSS can't read it). Cookie-authenticated `POST`/`PATCH` requests must carry an `Origin` listed in `CORS_ORIGINS` (browsers do this automatically), otherwise `403 CSRF_ORIGIN_REJECTED`. For cross-site deployments (e.g. Vercel frontend + Render API) set `AUTH_COOKIE_SAMESITE=none` (forces `Secure`). Never put the Bearer token in `localStorage`. Refresh tokens are not implemented yet.

## Endpoints

| Method | Path | Role | Purpose |
|---|---|---|---|
| POST | `/auth/register` | public | register passenger/driver |
| POST | `/auth/login` | public | get access token |
| GET | `/meta` | public | zones (+ map centres), vehicle types, enums, ride transitions, rules (cacheable) |
| POST | `/auth/logout` | public | clear the session cookie |
| GET | `/auth/me` | any | current user |
| POST | `/auth/email/verify` | any | confirm the email with the 6-digit code `{ code }` |
| POST | `/auth/email/resend` | any | email a new code (60 s cooldown, voids the old one) |
| POST | `/auth/password/forgot` | public | email a reset code `{ email }`; always 202 |
| POST | `/auth/password/reset` | public | `{ email, code, newPassword }` |
| GET | `/stats/impact` | public | impact + integrity KPIs computed live (aggregates only) |
| PATCH | `/users/me` | any | update profile (`name`, `phone` only); read it with `GET /auth/me` |
| POST | `/vehicles` | DRIVER | register vehicle (`name` e.g. "Bullet", `vehicleType` default `AUTO_RICKSHAW`, `registrationNumber`, `capacity?`) |
| GET | `/vehicles` | DRIVER / ADMIN | my vehicles (admin: all) |
| PATCH | `/vehicles/:id` | owner / ADMIN | `name`; `capacity`, `isActive` (frozen while in a live pool) |
| GET | `/driver/status` | DRIVER | online?, live pool (passengers, seats, route), my vehicles |
| POST | `/driver/online` | DRIVER | go online with `{ vehicleId }` (opens a pool; idempotent) |
| POST | `/driver/offline` | DRIVER | go offline (cancels the empty pool; `409 DRIVER_HAS_PASSENGERS` while anyone is assigned) |
| GET | `/wallet` | any | simulated TeslaPay balance + ledger (paginated) |
| POST | `/wallet/top-up` | any | simulated top-up `{ amountPoysha }` (৳1 – ৳10,000; send an `Idempotency-Key`) |
| GET | `/pools?status=ACTIVE` | any | driver: pools I drive · passenger: pools I ride in · admin: all |
| POST | `/pools` | DRIVER | open a pool with my vehicle |
| GET | `/pools/:id` | driver / ADMIN / member | pool details and route |
| GET | `/pools/:id/requests` | pool driver / ADMIN | waiting requests evaluated against this pool, explained and ranked |
| POST | `/pools/:id/accept` | pool driver / ADMIN | accept a waiting request (same transactional join) |
| POST | `/pools/:id/join` | PASSENGER | join a specific pool (transactional) |
| POST | `/pools/:id/leave` | PASSENGER | leave before the driver arrives |
| POST | `/pools/:id/cancel` | driver / ADMIN | cancel an empty OPEN pool |
| POST | `/rides` | PASSENGER | request a ride: quote + explainable pool options |
| GET | `/rides?status=ACTIVE` | any | my rides (driver: rides in my pools; admin: all); `status` = any ride status or `ACTIVE` |
| GET | `/rides/:id` | owner / pool driver / ADMIN | ride details |
| GET | `/rides/:id/events` | owner / pool driver / ADMIN | immutable history |
| GET | `/rides/:id/explanation` | owner / pool driver / ADMIN | plain-language why-matched / why-this-price / timeline |
| POST | `/rides/:id/match` | PASSENGER | auto-match to the best feasible pool |
| POST | `/rides/:id/cancel` | owner / ADMIN | cancel (REQUESTED, MATCHED, DRIVER_ARRIVED) |
| POST | `/rides/:id/arrive` · `/start` · `/complete` | pool driver / ADMIN | driver lifecycle |
| POST | `/predictions/eta` · `/predictions/fare` | any | what-if estimates |
| GET | `/health` · `/health/ready` | public | liveness · readiness |

## Ride lifecycle

```
REQUESTED ──match/join──► MATCHED ──arrive──► DRIVER_ARRIVED ──start──► STARTED ──complete──► COMPLETED
    │          ◄──leave───  │                      │
    └──cancel──► CANCELLED ◄┴──────cancel──────────┘              (no cancel once STARTED)
```
Illegal moves → `409 INVALID_STATE_TRANSITION` with `details: { from, to }`. One active (non-terminal) ride per passenger (`409 ACTIVE_RIDE_EXISTS`).

Pool status is derived: `OPEN` (empty) → `MATCHED` → `DRIVER_ARRIVED` → `STARTED` → `COMPLETED`. New passengers can join `OPEN`/`MATCHED` pools only (after `DRIVER_ARRIVED` only if the server enables late joins).

## Request a ride

```http
POST /api/v1/rides
Authorization: Bearer …            (or the HttpOnly session cookie)
Idempotency-Key: 7d0f5a8e-…
{
  "pickupZone": "Banani",
  "dropoffZone": "Mohakhali",
  "requestedSeats": 1,
  "paymentMethod": "CASH",
  "pickupLat": 23.7937, "pickupLng": 90.4066,
  "context": { "traffic": "MEDIUM", "weather": "CLEAR", "timeOfDay": "OFF_PEAK" }
}
```
Zones: `BANANI GULSHAN MOHAKHALI UTTARA MIRPUR DHANMONDI FARMGATE AZIMPUR BASHUNDHARA_RA MOTIJHEEL` (case-insensitive; `Gulshan1` → `GULSHAN`). `context` is optional (derived from the Dhaka clock if omitted). Coordinates are optional, must come in pairs and lie in Greater Dhaka. `paymentMethod`: `CASH` (default) or `TESLAPAY` (wallet must cover the quoted solo fare, else `422 INSUFFICIENT_WALLET_BALANCE`). Surge, distance and fares **cannot** be sent.

Response (real values from a live run with the ML sidecar up; default pricing mode):
```json
{
  "success": true,
  "data": {
    "rideRequestId": "5b8…",
    "status": "REQUESTED",
    "phase": "WAITING",
    "pickup":  { "zone": "BANANI",    "name": "Banani",    "lat": 23.7937, "lng": 90.4066 },
    "dropoff": { "zone": "MOHAKHALI", "name": "Mohakhali", "lat": null, "lng": null },
    "requestedSeats": 1,
    "vehicleType": "AUTO_RICKSHAW",
    "estimatedDistanceKm": 3.4,
    "distanceSource": "ZONE_GRAPH_DISTANCE",
    "estimatedDurationMinutes": 18.3,
    "estimatedFare": { "amountPoysha": 12650, "amountBdt": 126.5, "currency": "BDT" },
    "fareSource": "DETERMINISTIC",
    "fareBreakdown": {
      "base": { "amountPoysha": 5000 }, "distanceCharge": { "amountPoysha": 6800 }, "timeCharge": { "amountPoysha": 850 },
      "total": { "amountPoysha": 12650 }, "distanceKm": 3.4, "pricingDurationMinutes": 17, "trafficLevel": "MEDIUM"
    },
    "paymentMethod": "CASH",
    "payment": null,
    "pool": null,
    "finalFare": null,
    "quote": {
      "mlAvailable": true,
      "eta":  { "finalMinutes": 18.3, "deterministicMinutes": 17, "mlPredictedMinutes": 18.3, "source": "ML", "reason": "ML_WITHIN_GUARDRAIL", "modelVersion": "eta-v1" },
      "fare": { "pricingMode": "deterministic", "baselineFarePoysha": 12650, "mlPredictedFarePoysha": 16049, "mlWithinGuardrail": false,
                "guardrailApplied": false, "finalFarePoysha": 12650, "source": "DETERMINISTIC", "reason": "DETERMINISTIC_PRICING",
                "deviationBps": 2687, "allowedBand": { "minPoysha": 10120, "maxPoysha": 15180 }, "modelVersion": "fare-v1" }
    },
    "poolOptions": [ /* MatchDecision[], best first; see below */ ]
  },
  "meta": { "requestId": "…" }
}
```
- The **price is the itemised formula** (`fareBreakdown`, frozen on the ride), always priced on the deterministic duration so anyone can check it by hand. The ETA shown to the rider may come from the ML model.
- `quote.fare` reports what the ML fare model said and whether it would pass the ±20% band; it only sets the price when the server runs `FARE_PRICING_MODE=ml_guarded` (then `fareSource: "ML"`, `reason: "ML_WITHIN_GUARDRAIL"` or `"FARE_GUARDRAIL_TRIGGERED"`).
- `phase` is the passenger-facing status: `WAITING → MATCHED → IN_PROGRESS → COMPLETED / CANCELLED` (`DRIVER_ARRIVED` is still `MATCHED`).
- After completion: `finalFare` and `payment: { method, amount, settledAt }` (exactly one payment per completed ride).

`estimatedFare` is the **solo** quote. The pooled price appears in each option's `fare` and, after joining, in `ride.pool.fare`.

## Match decision (explainable)

Returned by `POST /pools/:id/join` (200), inside `POST /rides/:id/match` (`data.match`, `data.candidates[]`), in `poolOptions`, and in `error.details.decision` of a rejected join.

```json
{
  "decision": "MATCHED",
  "poolId": "…",
  "headline": "Matched: Banani → Gulshan 1 → Mohakhali",
  "reasonCodes": ["POOL_JOINABLE", "CAPACITY_AVAILABLE", "PICKUP_COMPATIBLE", "DESTINATION_COMPATIBLE", "STOP_LIMIT_SATISFIED", "DETOUR_WITHIN_LIMIT"],
  "checks": [
    { "rule": "CAPACITY", "passed": true, "code": "CAPACITY_AVAILABLE", "message": "2 seats available, 1 requested", "detail": { "capacity": 3, "occupied": 1, "available": 2, "requested": 1 } },
    { "rule": "PICKUP_DISTANCE", "passed": true, "code": "PICKUP_COMPATIBLE", "message": "Same pickup zone as current passengers", "detail": { } }
  ],
  "capacity": { "total": 3, "before": 1, "requested": 1, "after": 2, "available": 2 },
  "route": ["BANANI", "GULSHAN", "MOHAKHALI"],
  "totalDistanceKm": 4.5,
  "detourKm": 1.1,
  "score": 0.1945,
  "scoreBreakdown": { "distance": 0.44, "detour": 0.7333, "stops": 0.75, "timeVariance": 0.1618, "sharing": 0.7778, "total": 0.1945 },
  "passengers": [ { "rideRequestId": "…", "pickupSequence": 0, "dropoffSequence": 2, "soloDistanceKm": 3.4, "inVehicleDistanceKm": 4.5, "detourKm": 1.1, "allowedDetourKm": 1.5, "sharedFraction": 0.5556 } ],
  "fare": { "soloFarePoysha": 10670, "farePoysha": 8003, "discountBps": 2500, "discountPercent": 25, "sharedFraction": 1, "soloFareBdt": 106.7, "fareBdt": 80.03 },
  "alternatives": [ { "route": ["BANANI", "MOHAKHALI", "GULSHAN"], "feasible": false, "violations": ["DETOUR_TOO_HIGH"], "totalDistanceKm": 5.4, "maxDetourKm": 2.9, "stopCount": 3, "score": null }, … ]
}
```
`alternatives` lists up to 5 other stop orders, shortest vehicle route first (feasible or not).

Rejected: `decision: "REJECTED"`, `reasonCodes` lists **every** failed rule, `checks` shows the passing ones too (e.g. "capacity failed but the route was fine"), no `route`/`score`.

`POST /rides/:id/match` returns **200** in both cases: `{ decision, reasonCodes, match | null, candidatesEvaluated, candidates[] }`. With no pools at all, `reasonCodes: ["NO_POOLS_AVAILABLE"]`. The ride stays `REQUESTED` on rejection.

## Explanation (`GET /rides/:id/explanation`)

```json
{
  "summary": ["Sharing with Rafiq", "Route: Banani → Gulshan 1 → Mohakhali",
              "You share 55.6% of your ride, so you get a 13.89% pool discount: you pay ৳108.93 instead of ৳126.50 (save ৳17.57)."],
  "match": { "headline": "Matched: Banani → Mohakhali", "initiatedBy": "PASSENGER",
             "reasons": [{ "rule": "CAPACITY", "passed": true, "message": "3 seats available, 1 requested" }], "routeAtMatch": ["BANANI", "MOHAKHALI"] },
  "trip": { "route": ["BANANI", "GULSHAN", "MOHAKHALI"], "yourPickup": { "name": "Banani", "stopNumber": 1 }, "yourDropoff": { "name": "Mohakhali", "stopNumber": 3 },
            "yourDetourKm": 1.1, "driverFirstName": "Driver", "coPassengers": [{ "firstName": "Rafiq", "seats": 1, "pickup": "Banani", "dropoff": "Gulshan 1" }] },
  "fare": { "standard": { "base": {}, "distanceCharge": {}, "timeCharge": {}, "total": {} }, "quote": { "source": "DETERMINISTIC", "decision": {} },
            "pooled": { "soloFare": {}, "fare": {}, "saving": {}, "sharedPercent": 55.6, "discountPercent": 13.89, "locked": false }, "final": null, "lines": ["…"] },
  "rejections": [],
  "timeline": [{ "at": "…", "eventType": "RIDE_REQUESTED", "description": "Ride requested" }, { "description": "Joined a pool" },
               { "description": "Another passenger joined; your fare ৳126.50 → ৳108.93; your detour 0 → 1.1 km; route Banani → Gulshan 1 → Mohakhali" }]
}
```
For a rejected rider: `trip: null`, `summary: ["Not matched: Only 1 seat left, 2 requested", …]`, `rejections: [{ headline, reasons: ["Only 1 seat left, 2 requested"], reasonCodes: ["CAPACITY_EXCEEDED"] }]`.

## Impact (`GET /stats/impact`)

`rides` (total/active/completed/cancelled, cancellationRate) · `matching` (ridesMatched, ridesAttempted, matchSuccessRate, rejectedAttempts) · `pooling` (pooledPassengers, totalPassengerSavings, averageSavingPerPooledPassenger, averageDiscountPercent, averageDetourKm) · `occupancy` (averagePassengersPerPool, seatUtilization) · `integrity` (capacityViolations, occupancyCounterDrift: recounted from raw memberships) · `ml` (fareAcceptanceRate) · `operational` (in-memory: http + matching p50/p95, lostRaces, capacityGuardHits, invalidTransitionsRejected).

## Predictions

```http
POST /api/v1/predictions/fare
{ "vehicleType": "AUTO_RICKSHAW", "pickupZone": "BANANI", "dropoffZone": "MOHAKHALI",
  "traffic": "HIGH", "weather": "RAINY", "timeOfDay": "MORNING_PEAK", "surgeMultiplier": 1.3, "distanceKm": 3.4 }
```
```json
{ "predictedFareBdt": 137, "predictedFare": { "amountPoysha": 13700, "amountBdt": 137, "currency": "BDT" },
  "predictedDurationMinutes": 19, "modelVersion": "fare-v1", "fareDecision": { }, "distanceKm": 3.4, "distanceSource": "CLIENT_SUPPLIED_DISTANCE" }
```
`distanceKm` is an optional what-if override (labelled `CLIENT_SUPPLIED_DISTANCE`); omit it to use the zone graph. `/predictions/eta` takes the same body and returns `{ predictedDurationMinutes, modelVersion, source, reason, deterministicMinutes, mlPredictedMinutes, distanceKm, distanceSource }`. `modelVersion` is `rules-v1` when the deterministic estimator was used.

## Driver availability and wallet

```http
POST /api/v1/driver/online   { "vehicleId": "<Bullet's id>" }
→ { "online": true, "pool": { "status": "OPEN", "vehicle": { "name": "Bullet", "capacity": 3 }, "availableSeats": 3, "passengers": [] }, "vehicles": [...] }
POST /api/v1/driver/offline  → { "online": false, "pool": null }   |  409 DRIVER_HAS_PASSENGERS while anyone is assigned
GET  /api/v1/wallet          → { "balance": { "amountPoysha": 42031 }, "transactions": [ { "type": "RIDE_PAYMENT", "amount": { "amountPoysha": -7969 }, "balanceAfter": {…}, "rideRequestId": "…" } ] }
POST /api/v1/wallet/top-up   { "amountPoysha": 50000 }   (simulated; no gateway)
```
Online means "has a live pool", so availability can never disagree with pool state. The wallet balance is maintained by the database from an append-only ledger; an overdraft is impossible even for buggy code.

## Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `MALFORMED_JSON`, `SAME_PICKUP_AND_DROPOFF`, `IDEMPOTENCY_KEY_INVALID` | bad input |
| 401 | `UNAUTHORIZED` (`details.reason`: `TOKEN_EXPIRED`, `TOKEN_INVALID`, `ACCOUNT_INACTIVE`), `INVALID_CREDENTIALS` | authentication |
| 403 | `FORBIDDEN`, `CSRF_ORIGIN_REJECTED` | authenticated, not allowed (role or object ownership); cookie-authenticated write from a non-allowed origin |
| 404 | `RIDE_NOT_FOUND`, `POOL_NOT_FOUND`, `VEHICLE_NOT_FOUND`, `RIDE_NOT_IN_POOL`, `NOT_FOUND` | missing |
| 409 | `DRIVER_HAS_PASSENGERS`, `CAPACITY_EXCEEDED`, `POOL_ALREADY_STARTED`, `POOL_CANCELLED`, `LATE_JOIN_NOT_ALLOWED`, `DUPLICATE_MEMBERSHIP`, `INVALID_STATE_TRANSITION`, `ACTIVE_RIDE_EXISTS`, `ACTIVE_POOL_EXISTS`, `POOL_NOT_EMPTY`, `VEHICLE_UNAVAILABLE`, `EMAIL_ALREADY_REGISTERED`, `REGISTRATION_NUMBER_TAKEN`, `CONCURRENT_UPDATE`, `IDEMPOTENCY_REQUEST_IN_PROGRESS` | conflicts with current state |
| 413 | `PAYLOAD_TOO_LARGE` | body > 32 KB |
| 422 | `INSUFFICIENT_WALLET_BALANCE`, `PICKUP_TOO_FAR`, `DESTINATION_TOO_FAR`, `MAX_STOPS_EXCEEDED`, `DETOUR_TOO_HIGH`, `VEHICLE_CAPACITY_EXCEEDED`, `IDEMPOTENCY_KEY_REUSED` | business rule rejected the request |
| 429 | `RATE_LIMIT_EXCEEDED` | slow down |
| 500 / 503 | `INTERNAL_ERROR` / `SERVICE_UNAVAILABLE` | server-side; retry later, quote `requestId` |

Informational codes that appear inside decisions, never as request failures: `DETERMINISTIC_PRICING`, `ML_PREDICTION_UNAVAILABLE`, `FARE_GUARDRAIL_TRIGGERED`, `ETA_GUARDRAIL_TRIGGERED`, `ML_WITHIN_GUARDRAIL`, `NO_POOLS_AVAILABLE`.
