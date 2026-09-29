# Database

PostgreSQL 15+ (tested on 18; compose uses 17). Schema: [`prisma/schema.prisma`](../prisma/schema.prisma). Migration: [`prisma/migrations/20260928000000_init/migration.sql`](../prisma/migrations/20260928000000_init/migration.sql).

## Entity relationships

The Mermaid ERD is in the [README](../README.md#database-erd). In short:

```
users ─┬─< vehicles ─< pools >── users (driver)
       ├─< ride_requests ─┬─< pool_memberships >── pools        (≤ 1 ACTIVE membership per ride)
       │                  ├─< ride_events         (append-only)
       │                  ├─< prediction_events   (append-only)
       │                  └─o payments            (exactly one per completed ride, append-only)
       ├─< wallet_transactions (append-only TeslaPay ledger)
       └─< idempotency_keys
```

## Tables

| Table | Purpose | Notable columns |
|---|---|---|
| `users` | accounts | `email` unique + lowercase CHECK, `password_hash` (Argon2id), `role` enum, `is_active`, `wallet_balance_poysha` (≥ 0, **written only by the wallet trigger**) |
| `vehicles` | fleet | `driver_id` FK, `name` (e.g. "Bullet"), `vehicle_type` enum (`AUTO_RICKSHAW` = the PRD's "Tesla", `RICKSHAW`, `BIKE_RIDESHARE`), `capacity` CHECK 1–8, `registration_number` unique (≤ 32 chars) |
| `ride_requests` | passenger requests | zones (enum, CHECK pickup ≠ dropoff), optional coordinates (range CHECKs, both-or-neither), `requested_seats`, server-computed `estimated_distance_km` + `distance_source`, `estimated_duration_min`, `quoted_fare_poysha`, `fare_source`, frozen breakdown (`base_fare_poysha`, `distance_charge_poysha`, `time_charge_poysha`, `pricing_duration_min`, `traffic_level`; all-or-nothing CHECK), `payment_method` (CASH/TESLAPAY), `final_fare_poysha`, `status` |
| `pools` | one vehicle trip | `capacity` (snapshot of vehicle), `occupied_seats` CHECK `0 ≤ x ≤ capacity`, `planned_stops` (zones), `route_data` (full explainable plan), `total_distance_km`, `score`, `version` |
| `pool_memberships` | ride ↔ pool | `seats`, `pickup_sequence` < `dropoff_sequence`, `detour_km`, `shared_fraction`, `solo_fare_poysha`, `discount_bps` (0–10000), `fare_poysha ≤ solo_fare_poysha`, `status` (ACTIVE/LEFT/CANCELLED/COMPLETED) |
| `ride_events` | immutable audit log | `seq` (monotonic order), `event_type`, `from_status`, `to_status`, `actor_id`, `pool_id`, `metadata` JSONB |
| `prediction_events` | immutable prediction log | `model_name`, `model_version`, `prediction_type` (ETA/FARE), `prediction_value`, `used_for_decision`, `feature_snapshot` JSONB, `latency_ms` |
| `wallet_transactions` | append-only TeslaPay ledger | signed `amount_poysha` (sign must match `type`: TOP_UP/RIDE_EARNING credit, RIDE_PAYMENT debit), `balance_after_poysha` (set by trigger), unique (`ride_request_id`, `type`) so a ride is paid/earned at most once |
| `payments` | one immutable settlement per completed ride | `ride_request_id` unique, `passenger_id`, `driver_id`, `method`, `amount_poysha` ≥ 0 |
| `idempotency_keys` | replay protection | unique (`user_id`, `key`), `request_hash`, `status`, stored response, `expires_at` |

## Money

All money columns are `INTEGER` poysha (`1 BDT = 100 poysha`); discounts are integer basis points. There is no `FLOAT`/`NUMERIC` money anywhere. The API exposes both `amountPoysha` (canonical) and `amountBdt` (display).

## Constraints are part of the design

Hand-written in the migration because Prisma cannot express them:

| Constraint | Protects against |
|---|---|
| `pool_memberships_capacity_guard` trigger: locks the pool row and refuses any ACTIVE membership that would make the **real** seat sum exceed capacity | overbooking, even from code that forgets the application lock |
| `pool_memberships_sync_occupancy` trigger: recomputes `pools.occupied_seats` from ACTIVE memberships after every change | counter drift: the counter is database-owned, the app never writes it |
| `pools_occupancy_chk`: `occupied_seats BETWEEN 0 AND capacity` | an out-of-range counter |
| `pool_memberships_one_active_per_ride`: partial UNIQUE (`ride_request_id`) WHERE `status='ACTIVE'` | duplicate joins; one ride in two pools |
| `ride_requests_one_active_per_passenger`: partial UNIQUE (`passenger_id`) WHERE status is non-terminal | duplicate ride submissions |
| `pools_one_active_per_vehicle` / `_per_driver`: partial UNIQUE | a vehicle/driver in two live pools |
| `pool_memberships_fares_chk`, `_discount_chk`, `_shared_chk`, `_sequence_chk` | invalid prices and route plans |
| `ride_requests_*_chk` | impossible seats, zones, coordinates, negative fares |
| `ride_events_append_only`, `prediction_events_append_only`, `wallet_transactions_append_only`, `payments_append_only` triggers | rewriting history or money records (`UPDATE`/`DELETE` raise) |
| `wallet_transactions_apply` trigger: locks the user row, computes `balance_after`, refuses a negative balance (`TESLAPOOL_INSUFFICIENT_FUNDS`), moves `users.wallet_balance_poysha` | overdrafts and balance drift: the balance always equals the ledger sum |
| `users_wallet_non_negative_chk` | a negative balance written by any path |
| Foreign keys `ON DELETE RESTRICT` | orphaned or silently deleted history |

## Indexes (by access path)

| Index | Query it serves |
|---|---|
| `users(email)` unique | login |
| `vehicles(driver_id)` | "my vehicles" |
| `ride_requests(passenger_id, created_at DESC)` | "my rides", newest first, paginated |
| `ride_requests(status)` | operational queries |
| `pools(status, created_at)` | candidate generation (joinable pools, oldest first, bounded) |
| `pools(driver_id)`, `pools(vehicle_id)` | ownership checks, one-live-pool rules |
| `pool_memberships(pool_id, status)` | loading a pool's active members under lock |
| `pool_memberships(ride_request_id)`, `(passenger_id)` | lock-ordering lookups, leave |
| `ride_events(ride_request_id, created_at)`, `seq` unique | ride history |
| `prediction_events(model_name, model_version, created_at)` | per-model monitoring (future MAE tracking) |
| `idempotency_keys(user_id, key)` unique, `(expires_at)` | replay lookup, expiry |

## Concurrency model

Two **independent** layers prevent overbooking, and each is sufficient alone. This was verified by mutation testing: with the application's `FOR UPDATE` removed, 10 concurrent last-seat claims produced 7 winners and 8 riders in 6 seats (the counter CHECK alone did *not* catch it, since each racer wrote the same stale value). With the capacity-guard and occupancy triggers added, the same lock-free run stays correct. The regular suite runs with both layers.

- Isolation: `READ COMMITTED` + explicit `SELECT … FOR UPDATE`.
- **Global lock order: pool → ride request.** Paths that start from a ride (cancel, lifecycle) first read its active membership without a lock, lock that pool, then the ride, then re-read the membership; if it changed in between, the transaction restarts (`LockOrderRetry`).
- Deadlock / serialization failures are retried up to 3× (`withTransaction`), then surfaced as `409 CONCURRENT_UPDATE`.
- Interactive transaction timeout 10 s (`DB_TX_TIMEOUT_MS`). No network calls inside transactions.
- `ride_events.created_at` is the *transaction* timestamp (`now()`), so events written in one transaction share it; `seq` gives the true order.

## Migrations

```bash
npx prisma migrate deploy        # production / CI / container start (idempotent)
# migrations (forward-only; applied migrations are never edited):
#   20260928000000_init                                  tables, enums, CHECKs, partial uniques, append-only triggers
#   20260928010000_widen_registration_number             plates like DHAKA-METRO-TA-11-2233 (22 chars)
#   20260928020000_membership_capacity_guard             trigger: no overbooking by the real seat sum
#   20260928030000_db_owned_occupancy                    trigger: occupied_seats maintained by the DB
#   20260929000000_tesla_vehicle_type                    (superseded below)
#   20260929000100_vehicle_name_fare_breakdown_payments  vehicle name, frozen fare breakdown, wallet + payments
#   20260929000200_single_auto_rickshaw_vehicle_type     "Tesla" is slang for an auto-rickshaw: one AUTO_RICKSHAW type
npm run db:migrate:dev           # local: create a new migration after editing schema.prisma
npm run db:seed                  # demo accounts + vehicles (idempotent)
```

The app is reproducible from an empty database with `migrate deploy` (+ optional seed). The container entrypoint runs `migrate deploy` with retries on every start.

> **When adding migrations:** Prisma's diff does not know about the partial unique indexes and triggers above. If `migrate dev` generates `DROP INDEX … one_active …` statements, delete them from the new migration before applying.

## Tests

DB suites never touch development data: they use `TEST_DATABASE_URL` if set, otherwise the same database with a separate PostgreSQL **schema** (`?schema=teslapool_test`). No `CREATEDB` privilege is needed. The schema is migrated with the same `migrate deploy` path, then `TRUNCATE`d between tests (which bypasses the row-level append-only triggers by design).
