# Gaps, solutions and innovations

> **TeslaPool is a transaction-safe ride-pooling engine that explains why two passengers were matched, how much each passenger pays and why, and guarantees that vehicle capacity can never be exceeded.**

Ride pooling itself is not new (UberX Share, and earlier UberPool in Dhaka, already pool riders on compatible routes). The innovation here is **engineering you can inspect**: every decision is explainable, every seat allocation is race-safe at two independent layers, every taka is integer-exact and itemised, and every claim below is backed by a test or a live query.

## 1. Pain points → how TeslaPool solves them → proof

| # | Pain point / gap | Solution | Where | Proof |
|---|---|---|---|---|
| 1 | Overlapping but non-identical routes | Enumerate every pickup-before-dropoff stop order; hard rules on pickup/destination proximity, detour **for every passenger**, stop limit; deterministic scoring | `src/route-engine/`, `src/pools/matching-engine.ts` | `tests/unit/route-planner.test.ts`, `matching-engine.test.ts` |
| 2 | Fixed vehicle capacity | Seat-based capacity rule; 2 seats with 1 left is rejected even on a perfect route | `matching-engine.ts` | e2e demo (Shirin), `pools.test.ts` edge case 1 |
| 3 | Simultaneous requests for the last seat | **Layer 1:** `SELECT … FOR UPDATE` (pool → ride lock order) + re-run the engine on fresh state inside the transaction. **Layer 2:** DB trigger refuses any membership that would exceed capacity by the *real* seat sum; DB-owned occupancy counter | `common/db.ts`, `pools/pools.service.ts`, migrations `…020000`, `…030000` | `tests/concurrency/last-seat.test.ts` (10 racers → exactly 1 winner); mutation test: removing the lock broke it (7 winners), the triggers alone now hold |
| 4 | Every passenger needs an individual fare | Per-passenger solo fare → discount from **their own** shared-distance fraction → integer poysha; co-riders re-priced on join/leave, locked at pickup | `fares/fare-engine.ts`, `pools/pool-ops.ts` | `fare-engine.test.ts`; Nusrat 13.89% vs Rafiq 25% in the demo |
| 5 | "Why am I paying this?" | Itemised fare (base + distance + time sum exactly to the total), quote provenance (ML accepted / guardrail / fallback), pooled saving | `rides/ride-explanation.ts` → `GET /rides/:id/explanation` | `innovations.test.ts` |
| 6 | "Why was I matched with this person? Why couldn't Shirin join?" | Every `MatchDecision` carries a `headline` and a plain-language `message` per rule, plus rejected route alternatives; rejections stored as `MATCH_REJECTED` events | `pools/explain.ts`, `matching-engine.ts` | `explain.test.ts`, `innovations.test.ts` |
| 7 | Riders must see only their own data | Object-level authorization on rides, pools, explanations; co-riders see first names and zones only, never fares, emails, phones or ride ids | services, `pools.module.ts` | `rides.test.ts` (IDOR), `pools.test.ts` (privacy), `innovations.test.ts` |
| 8 | Drivers need a different view | Driver sees **compatible waiting requests** with explanations (feasible first, then score, then longest wait) and **accepts** through the same transactional join | `PoolService.compatibleRequests`, `POST /pools/:id/accept` | `innovations.test.ts` §2 |
| 9 | Invalid lifecycle transitions | Explicit state machine (exhaustively tested over all 36 pairs); pool status *derived* from rides under the same lock; no generic `PATCH status` endpoint exists | `rides/ride-state-machine.ts`, `pools/pool-state.ts` | `state-machine.test.ts`, `pools.test.ts` |
| 10 | Modifying someone else's ride | Owner / pool-driver / admin checks on every mutation; driver of another pool gets 403 | services | `pools.test.ts` edge case 3, `rides.test.ts` |
| 11 | History must stay explainable | Append-only `ride_events` / `prediction_events` (DB triggers reject UPDATE/DELETE); `seq` for true order; narrated timeline | migrations, `ride-explanation.ts` | `rides.test.ts` (immutability), `innovations.test.ts` |
| 12 | Trust and privacy barriers to sharing with strangers | Transparent explanation ("Sharing with Rafiq · Route · you save ৳X"), minimal co-rider disclosure | explanation endpoint | `innovations.test.ts` |
| 13 | Double submissions / network retries | `Idempotency-Key` (per user, payload-hashed) + partial unique indexes (one active ride per passenger, one active membership per ride) | `idempotency.middleware.ts`, migration | `rides.test.ts`, `last-seat.test.ts` |
| 14 | "Impact" claims without evidence | `GET /stats/impact`: every KPI computed live from the DB, including an integrity query that recounts capacity violations from raw memberships | `stats/stats.module.ts` | `innovations.test.ts` §3 |
| 15 | Fare must be checkable by hand (PRD §5) | Deterministic pricing by default; itemised breakdown (base + distance + time) frozen on each ride; ML advisory | `fares/fare-engine.ts`, `rides.service.ts` | `tests/e2e/prd-fare-by-hand.test.ts` (Nusrat 12650 → 10893, Rafiq 10625 → 7969, to the poysha) |
| 16 | Payment: cash or simulated TeslaPay (PRD §5) | Settlement inside the completion transaction; DB-owned wallet balance with an append-only, sign-checked ledger; overdraft impossible | `payments/`, migration `…000100` | `payments-driver.test.ts` |
| 17 | Driver goes online/offline (PRD §3) | Online ⇔ live pool; offline refused while passengers are assigned; race-safe | `driver/driver.module.ts` | `payments-driver.test.ts` |
| 18 | Story cast, not user1/driver1 (PRD §1, §16, §18) | Seed, tests and demo all use Jashim + Bullet, Nusrat, Rafiq, Shirin (second driver in tests: Kamal + Toofan) | `prisma/seed.ts`, `tests/helpers/harness.ts` | `seed.test.ts` |

## 2. The five innovations (and how to demo each in under a minute)

| Innovation | What to show | Command / endpoint |
|---|---|---|
| **Explainable pool engine** | Rafiq's match: 6 ✓ reasons + the rejected alternative order ("Banani → Mohakhali → Gulshan: DETOUR_TOO_HIGH"); Shirin's ✗ "Only 1 seat left, 2 requested" | `npm run demo` steps 4–6; `GET /rides/:id/explanation` |
| **Transaction-safe capacity (two layers)** | 10 concurrent last-seat claims → exactly 1 success, `capacityViolations: 0` | `npm run test:concurrency`; `GET /stats/impact` → `integrity` |
| **Individual fare ledger** | Nusrat and Rafiq pay different, itemised, integer-exact fares; saving shown per passenger | explanation `fare.standard`, `fare.pooled.saving` |
| **Ride state machine** | `start` before `arrive` → 409 `INVALID_STATE_TRANSITION { from, to }`; cancel after `STARTED` refused | `docs/demo.md` step 11 |
| **Immutable ride timeline** | "Ride requested → Joined a pool → Another passenger joined; your fare ৳126.50 → ৳108.93 … → Trip completed, charged ৳108.93"; `UPDATE ride_events` rejected by the DB | explanation `timeline`; `rides.test.ts` |

Plus, beyond the brief: **ML only where there is uncertainty** (ETA/fare), bounded by guardrails with a deterministic fallback; see [ml.md](ml.md).

## 3. KPIs (all measured, none asserted)

`GET /api/v1/stats/impact` returns, from real data:

| Brief KPI | Field |
|---|---|
| Pool match success rate | `matching.matchSuccessRate` (rides matched / rides that attempted matching) |
| Average matching latency | `operational.matching.p50Ms / p95Ms` (this instance, since start) |
| Average passenger saving | `pooling.averageSavingPerPooledPassenger`, `totalPassengerSavings` |
| Vehicle occupancy | `occupancy.averagePassengersPerPool`, `seatUtilization` |
| Pool capacity violation count | `integrity.capacityViolations` (recounted from raw memberships) + `occupancyCounterDrift` |
| Invalid transition rejections | `operational.invalidTransitionsRejected` |
| Concurrent allocation failures | `operational.concurrency.lostRaces`, `capacityGuardHits` |
| Average API response time | `operational.http.p50Ms / p95Ms` |
| (ML) guardrail acceptance | `ml.fareAcceptanceRate` |

Example from a local demo run: 4 trips completed, 4 pooled, match success 67%, ৳88.64 saved, occupancy 2/3, **0 capacity violations**, matching p95 48 ms. These are test-dataset numbers, not claims about Dhaka traffic.

## 4. Risk register → mitigation → evidence

| Risk | Severity | Mitigation | Evidence |
|---|---|---|---|
| Pool overbooking | Critical | Row lock + in-tx re-validation + capacity trigger + DB-owned counter + CHECK | concurrency suite, mutation test, `integrity` KPI |
| Invalid state transition | High | State machine, derived pool status | `state-machine.test.ts` |
| Unauthorized ride access (IDOR) | Critical | Object-level checks, 403 | `rides.test.ts`, `pools.test.ts` |
| Fare calculation bug | High | Pure integer fare engine, itemisation sums checked | `fare-engine.test.ts`, `innovations.test.ts` |
| Bad matching rule | High | Documented deterministic rules, every rule unit-tested, explanations | `docs/architecture.md`, `matching-engine.test.ts` |
| External routing failure | Medium | No external routing dependency (zone graph behind an interface) | `geography.test.ts` |
| ML failure | Medium | Timeout + circuit breaker + deterministic fallback | `ml-and-health.test.ts`, live outage drill |
| DB unavailable | High | Readiness 503, safe error envelope, entrypoint migrate retries | `ml-and-health.test.ts` |
| Session theft / CSRF | High | HttpOnly SameSite cookie; cookie-authenticated writes need an allow-listed Origin; Bearer alternative | `innovations.test.ts` §4 |
| Scope creep | Critical | Must-haves first; no maps, payments, Redis, Kafka, microservices | this document §5 |
| AI-generated code not understood | Critical | Deterministic, documented rules; tests assert behaviour; AI usage disclosed | README |

## 5. Deliberately not built

Google Maps / real routing, real payments, live GPS, WebSockets, Redis, Kafka, Kubernetes, microservices, ML *matching* (no labels exist), blockchain. Each has a documented extension point in [architecture.md](architecture.md#extension-points-not-built-by-design); none is needed to prove the core.
