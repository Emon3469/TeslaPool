# Architecture

> **TeslaPool uses ML where the system faces uncertainty (ETA and fare prediction), while deterministic domain rules enforce capacity, route feasibility and ride-state safety, with PostgreSQL transactions guaranteeing consistency under concurrent requests.**

```
                UNCERTAINTY                    RULES                      CONSISTENCY
                    │                            │                            │
  request ──► ┌─────────────┐   estimates   ┌──────────────┐   decision  ┌──────────────┐
              │ ML advisor  │ ────────────► │ Domain engine│ ──────────► │ PostgreSQL   │
              │ ETA · fare  │  (guarded)    │ capacity,    │  (re-run    │ row locks,   │
              │ sidecar     │               │ route, state │  under lock)│ constraints  │
              └─────────────┘               └──────────────┘             └──────────────┘
                 PREDICT                        DECIDE                      GUARANTEE
```

## System shape

A **modular monolith**: one Express + TypeScript process with strict internal module boundaries, plus an **optional** Python inference sidecar.

```
teslapool-backend/
├── src/
│   ├── main.ts                 process lifecycle, graceful shutdown
│   ├── app.ts                  composition root (the only place concrete classes are wired)
│   ├── config/env.ts           every business constant, validated at startup
│   ├── common/                 envelope, errors, logger, request context, db tx helper, middleware
│   ├── auth/ users/ vehicles/  identity, profiles, fleet
│   ├── geography/              zone vocabulary, zone graph, DistanceProvider interface
│   ├── route-engine/           pure stop-order enumeration, detour, scoring
│   ├── pools/                  pure matching engine + transactional pool service
│   ├── rides/                  ride state machine + ride service (create, lifecycle, cancel)
│   ├── fares/                  pure integer fare engine + ML guardrail
│   ├── predictions/            MlPredictor interface, sidecar client, PredictionService
│   ├── ride-events/            append-only audit writer
│   ├── health/                 liveness + readiness
│   └── docs/                   OpenAPI registry (generated from the same zod schemas that validate)
├── prisma/                     schema, migrations (incl. hand-written constraints), seed
└── ml/                         training, evaluation, model artifacts, FastAPI inference sidecar
```

**Dependency rule.** `geography`, `route-engine`, `pools/matching-engine`, `pools/pool-state`, `rides/ride-state-machine` and `fares/fare-engine` are **pure**: no I/O, no clock, no randomness, no global config (rules are passed in). Services orchestrate them with Prisma. ML is reachable only through the `MlPredictor` interface.

## Request flow: matching a passenger

```
POST /rides/:id/match
  │ authenticate (JWT → DB user) → authorize (owner) → validate (zod, strict)
  │
  │  ADVISORY (no locks)
  ├─ load joinable pools (bounded: MATCH_CANDIDATE_LIMIT, same vehicle type, active vehicle)
  ├─ for each pool: evaluateCandidate()  ── all 6 hard rules, every stop order, score
  ├─ rank: matched first, lowest score
  │
  │  AUTHORITATIVE (per candidate, best first, max 3 attempts)
  └─ BEGIN
       SELECT … FROM pools WHERE id=$1 FOR UPDATE          -- lock order: pool → ride
       SELECT … FROM ride_requests WHERE id=$2 FOR UPDATE
       re-read pool + active memberships (fresh state)
       evaluateCandidate() AGAIN on fresh state            -- the transaction is the authority
       insert membership · update co-riders' sequences/detours/fares
       update pool occupancy, derived status, route, version
       insert ride_events (STATUS_CHANGED + ROUTE_UPDATED for co-riders)
     COMMIT
       └─ if the fresh evaluation rejects (e.g. someone took the last seat): try the next candidate
```

Predictions are made **before** any transaction (at ride creation). No network call ever happens while a row lock is held.

## Decisions (the "why")

### Why a modular monolith?
One deployable, one database, one transaction boundary. The hardest correctness problem here, the last-seat race, is solved by a single ACID transaction; splitting pools and rides into services would turn it into a distributed-transaction problem with no benefit at MVP scale. Module boundaries (pure domain vs. services vs. HTTP) keep a later split possible: the matching engine has zero framework or DB dependencies.

### Why Express (not NestJS)?
Project requirement. The structure NestJS would provide is kept explicitly: a composition root (`app.ts`) for dependency injection, per-module routers, zod DTOs (`.strict()` = whitelist validation), role guards (`requireRole`), and a global error filter.

### Why PostgreSQL?
Row-level locks (`FOR UPDATE`), CHECK constraints, partial unique indexes and triggers let the database *enforce* the invariants the domain cares about, rather than trusting application code. JSONB stores explainable route plans and event metadata without a schema explosion.

### Why deterministic matching (no ML)?
Capacity, detour, stop limits and state are **rules**, not predictions. A rule must give the same answer every time, be explainable to a passenger, and be re-checkable inside a transaction. There is also no training label: the dataset has fares, not match outcomes (see [ml.md](ml.md#why-no-matching-model)). Every rejection is recorded as a `MATCH_REJECTED` event, which is exactly the labelled data a future ranking model would need.

### Why ML only for ETA and fare?
Those are genuinely uncertain quantities where data helps. Even there, ML is bounded:

| Signal | Guard | Fallback |
|---|---|---|
| ETA | accepted only within [0.5×, 2.0×] of the deterministic estimate | distance × min/km (traffic) |
| Fare | accepted only within ±20% of the deterministic baseline | `base + km·rate + min·rate` |
| Sidecar down / slow / malformed | 1.5 s timeout, 30 s circuit breaker | both deterministic |

### Why integer poysha?
`0.1 + 0.2 ≠ 0.3` in IEEE-754. Money is stored and computed as integer poysha; ratios as integer basis points; physical inputs converted to integer metres/seconds before multiplying by integer rates, with explicit half-up rounding (`divRoundHalfUp`). The ML fare (float BDT) is converted exactly once, at the boundary.

### Why transactions and row locks (not optimistic retries)?
Seat allocation is a hot row under contention (everyone wants the last seat). Pessimistic `FOR UPDATE` serialises contenders cheaply and deterministically; the loser re-evaluates on fresh state and gets a precise `CAPACITY_EXCEEDED`. The database backs this up independently: a trigger locks the pool and refuses any membership that would exceed capacity by the *real* seat sum, the occupancy counter is maintained by the database itself, and a partial unique index allows one active membership per ride. Mutation testing showed why this matters: with the app lock removed and only a counter CHECK, 10 racers produced 7 winners; with the triggers, the lock-free run stays correct. Deadlocks are prevented by a global lock order (pool → ride) and, as a last resort, retried.

### Why a derived pool status?
Pool status is computed from member ride statuses inside the same locked transaction (`derivePoolStatus`), so a pool can never say `MATCHED` while its passenger is `STARTED`. Joining is blocked from `STARTED` onwards, and after `DRIVER_ARRIVED` unless `ALLOW_LATE_JOIN=true`.

### Why immutable events?
`ride_events` and `prediction_events` reject `UPDATE`/`DELETE` with a trigger. The history of any ride (who did what, when, from which state, with which explanation) is reconstructable and cannot be quietly rewritten. It also feeds debugging, the judge demo, analytics and future fraud detection.

### Why model versioning?
Every prediction row stores `model_name`, `model_version`, the exact feature snapshot and whether it was used for the decision. "Which model priced this ride, and what did it see?" is one query. The sidecar refuses to start if the runtime scikit-learn version differs from the one recorded in the model card: models are never silently swapped.

### Why fallback logic?
Availability of the core product must not depend on the least reliable component. If the sidecar is absent, down, slow or returns garbage, rides are still created, matched and priced deterministically; `/health/ready` reports `ready_degraded`.

### Why a zone graph?
No external routing dependency, fully deterministic and testable. Two layers: **adjacency** (hops, for coarse proximity rules) and **road distance** (km, shortest path including direct roads). Everything is labelled `ZONE_GRAPH_DISTANCE`. The `DistanceProvider` interface lets a real router (`REAL_ROUTE_DISTANCE`) replace it later without touching the engine.

## Documented interpretations of the spec

| Topic | Spec says | Implementation |
|---|---|---|
| Detour limit | "1.5 km or 30% of original route" | `allowed = max(1.5 km, 0.30 × solo)`: the more permissive (1.5 km floor for short trips). Checked for **every** passenger. |
| Hop distance | Banani→Mohakhali = 2 hops, ≈3–4 km | Hops from zone adjacency; km from road distances (direct Banani–Mohakhali road 3.4 km). |
| Pickup/destination rule | "PICKUP_MAX = 1 hop" | New pickup within 1 hop of **each** existing pickup; new dropoff within 2 hops of **each** existing dropoff; symmetric (min of both directions). |
| Stop count | MAX_STOPS = 4 | Distinct consecutive stops after merging same-zone pickups/dropoffs. |
| Score "wait benefit" | `- wwait * wait_benefit` | No wait-time data exists yet, so the term is the mean **shared-ride fraction** (`SCORE_WEIGHT_SHARING`). |
| Distance term | normalized total distance | **Incremental** vehicle-km relative to the new passenger's solo trip, so pooling is compared fairly against an empty vehicle. |
| Leave pool | `POST /pools/:id/leave` | Allowed only before the driver arrives; ride returns `MATCHED → REQUESTED` (the one added transition). |
| Pool cancellation | status exists | `POST /pools/:id/cancel`: driver may cancel an **empty** OPEN pool. |
| Zones | Banani, Gulshan1, Mohakhali | All 10 dataset zones; `Gulshan1` accepted as an alias of `GULSHAN`. |
| One active ride | not specified | A passenger can hold one non-terminal ride (partial unique index): makes duplicate submissions harmless. |
| Fare changes | not specified | Co-riders' fares are re-computed on every join/leave until pickup; locked once `STARTED`; final fare stored on `COMPLETED`. |
| "Tesla" | a three-seat, battery-powered "Tesla" (Bullet) | Dhaka slang for an **auto-rickshaw**: one vehicle type `AUTO_RICKSHAW`, which maps directly to the dataset's "CNG Auto-Rickshaw" class; "Tesla" stays product vocabulary only. |
| Fare must be checkable by hand (PRD §5) | "the evaluator must be able to test the calculation by hand" | Price = itemised formula priced on the **deterministic** duration (distance × min/km for the traffic level). The ML fare is advisory unless `FARE_PRICING_MODE=ml_guarded`. The breakdown is frozen per ride. |
| Payment (PRD §5) | cash or simulated TeslaPay wallet | Both. Settlement happens inside the completion transaction; the wallet balance is database-owned (ledger trigger); no cancellation fees; driver receives 100% of TeslaPay fares (simulated). |
| Driver online/offline (PRD §3) | "go online/offline" | Online ⇔ the driver has a live pool (no separate flag that could drift). Going offline is refused while passengers are assigned. |

## Extension points (not built, by design)

| Future need | Where it plugs in |
|---|---|
| Real routing / traffic | new `DistanceProvider` (+ cache) |
| Match-quality ML | rank feasible candidates in `PoolService.evaluateOptions` **after** hard constraints; final validation stays in the transaction |
| Live GPS / WebSockets | new module subscribing to `ride_events` |
| Payments | finalise `finalFarePoysha` on `COMPLETED` (idempotency already supported) |
| Horizontal scaling | stateless API; move rate-limit store to Redis; DB locks already cross-instance safe |
| Refresh tokens | DB-backed rotating tokens next to `auth/tokens.ts` |
