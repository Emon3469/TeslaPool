# Demo script

Two ways to run the evaluator demo. Both work against local, Docker Compose, or Render.

## A. One command (narrated)

```bash
npm run demo                                   # API on http://localhost:3000 (npm run dev)
BASE_URL=http://localhost:4000 npm run demo    # docker compose
BASE_URL=https://<service>.onrender.com npm run demo
```
It registers fresh users (safe to re-run) and prints each decision with its reasons. The same story is asserted in `tests/e2e/demo-scenario.test.ts`.

## B. Step by step with curl

Requires `curl` and `jq` (bash / Git Bash). `CTX` pins traffic, weather and time of day so numbers are reproducible.

```bash
API=http://localhost:3000/api/v1          # or http://localhost:4000/api/v1 with docker compose
CTX='{"traffic":"MEDIUM","weather":"CLEAR","timeOfDay":"OFF_PEAK"}'
RUN=$RANDOM                                # unique emails per run
post() { curl -s -X POST "$API$1" -H 'content-type: application/json' ${3:+-H "authorization: Bearer $3"} -d "${2:-{\}}"; }
get()  { curl -s "$API$1" -H "authorization: Bearer $2"; }
```

### 1. Register

```bash
for who in jashim:DRIVER nusrat:PASSENGER rafiq:PASSENGER shirin:PASSENGER; do
  name=${who%%:*}; role=${who##*:}
  post /auth/register "{\"name\":\"${name^}\",\"email\":\"$name.$RUN@demo.dev\",\"password\":\"demo-password-123\",\"role\":\"$role\"}" | jq -c '.data.user | {name, role}'
done
```

### 2. Login

```bash
login() { post /auth/login "{\"email\":\"$1.$RUN@demo.dev\",\"password\":\"demo-password-123\"}" | jq -r .data.accessToken; }
JASHIM=$(login jashim); NUSRAT=$(login nusrat); RAFIQ=$(login rafiq); SHIRIN=$(login shirin)
```
(Seeded alternative: `jashim@teslapool.dev`, `nusrat@teslapool.dev`, `rafiq@teslapool.dev`, `shirin@teslapool.dev` with the demo passwords in the README (`Passenger@2026`, `Driver@2026`, `Admin@2026`). The seeded Jashim is already online with Bullet.)

### 3. Jashim registers Bullet and goes online

```bash
BULLET=$(post /vehicles "{\"name\":\"Bullet\",\"vehicleType\":\"AUTO_RICKSHAW\",\"registrationNumber\":\"DEMO-$RUN\"}" $JASHIM | jq -r .data.id)
POOL=$(post /driver/online "{\"vehicleId\":\"$BULLET\"}" $JASHIM | jq -r .data.pool.id)
get /driver/status $JASHIM | jq -c '.data | {online, pool: {status: .pool.status, vehicle: .pool.vehicle.name, availableSeats: .pool.availableSeats}}'
# {"online":true,"pool":{"status":"OPEN","vehicle":"Bullet","availableSeats":3}}
```

### 4. Nusrat requests Banani → Mohakhali (ETA + fare prediction + pool search)

```bash
N=$(post /rides "{\"pickupZone\":\"Banani\",\"dropoffZone\":\"Mohakhali\",\"context\":$CTX}" $NUSRAT)
echo $N | jq -c '.data | {estimatedDistanceKm, distanceSource, estimatedDurationMinutes, fare: .fareBreakdown, pricing: .quote.fare.reason, mlAdvisory: .quote.fare.mlPredictedFarePoysha, options: [.poolOptions[] | .headline]}'
N_ID=$(echo $N | jq -r .data.rideRequestId)
post /rides/$N_ID/match '' $NUSRAT | jq -c '.data | {decision, route: .match.route}'
# {"decision":"MATCHED","route":["BANANI","MOHAKHALI"]}
```
Fare: 3.4 km at medium traffic = 17 min → base 5000 + distance 6800 + time 850 = **12650 poysha (৳126.50)**, checkable by hand, `reason: DETERMINISTIC_PRICING`. With the ML sidecar running, the ETA shown may be the model's (e.g. 18.3 min) and `mlAdvisory` shows the model's fare, but the price stays the formula.

### 5–6. Rafiq tops up TeslaPay, requests Banani → Gulshan1; Jashim accepts him

```bash
post /wallet/top-up '{"amountPoysha":50000}' $RAFIQ > /dev/null
R=$(post /rides "{\"pickupZone\":\"Banani\",\"dropoffZone\":\"Gulshan1\",\"paymentMethod\":\"TESLAPAY\",\"context\":$CTX}" $RAFIQ)
R_ID=$(echo $R | jq -r .data.rideRequestId)
get /pools/$POOL/requests $JASHIM | jq -c '.data[] | {passengerFirstName, waitingSeconds, headline: .decision.headline}'
post /pools/$POOL/accept "{\"rideRequestId\":\"$R_ID\"}" $JASHIM | jq '{route: .data.route, detourKm: .data.detourKm, why: [.data.checks[].message], fare: .data.fare}'
```
(Alternatively Rafiq can match himself: `post /rides/$R_ID/match '' $RAFIQ`, as below.)

### 5–6 (passenger-initiated variant). Rafiq requests Banani → Gulshan1 and is matched

### 5–6. Rafiq requests Banani → Gulshan1 and is matched

```bash
# (skip if Jashim already accepted Rafiq above)
post /rides/$R_ID/match '' $RAFIQ | jq '.data.match | {route, detourKm, score, capacity, reasonCodes, fare: {solo: .fare.soloFareBdt, pooled: .fare.fareBdt, discountPercent: .fare.discountPercent}, alternatives: [.alternatives[] | {route, feasible, violations}]}'
```
Expected:
```json
{
  "route": ["BANANI", "GULSHAN", "MOHAKHALI"],
  "detourKm": 1.1,
  "capacity": { "total": 3, "before": 1, "requested": 1, "after": 2, "available": 2 },
  "reasonCodes": ["POOL_JOINABLE", "CAPACITY_AVAILABLE", "PICKUP_COMPATIBLE", "DESTINATION_COMPATIBLE", "STOP_LIMIT_SATISFIED", "DETOUR_WITHIN_LIMIT"],
  "fare": { "discountPercent": 25 },
  "alternatives": [
    { "route": ["BANANI", "MOHAKHALI", "GULSHAN"], "feasible": false, "violations": ["DETOUR_TOO_HIGH"] },
    { "route": ["BANANI", "GULSHAN", "BANANI", "MOHAKHALI"], "feasible": true, "violations": [] },
    { "route": ["BANANI", "MOHAKHALI", "BANANI", "GULSHAN"], "feasible": true, "violations": [] }
  ]
}
```
The two 4-stop orders (serve one passenger, return, serve the other) are feasible but score worse: no shared riding, more vehicle-km. Why the chosen order: dropping Rafiq first costs Nusrat 1.1 km (≤ 1.5 km allowed); dropping Nusrat first would cost Rafiq 2.9 km. Nusrat's fare also drops (she now shares 2.5 of her 4.5 km): see her `ROUTE_UPDATED` event in step 12.

### 7–8. Shirin wants 2 seats: CAPACITY_EXCEEDED

```bash
S=$(post /rides "{\"pickupZone\":\"Banani\",\"dropoffZone\":\"Mohakhali\",\"requestedSeats\":2,\"context\":$CTX}" $SHIRIN)
S_ID=$(echo $S | jq -r .data.rideRequestId)
post /pools/$POOL/join "{\"rideRequestId\":\"$S_ID\"}" $SHIRIN | jq '.error | {code, message, details: {requested: .details.requested, available: .details.available}, checks: [.details.decision.checks[] | {rule, passed, code}]}'
```
Expected (HTTP 409):
```json
{
  "code": "CAPACITY_EXCEEDED",
  "message": "The requested number of seats is not available.",
  "details": { "requested": 2, "available": 1 },
  "checks": [
    { "rule": "POOL_STATE",           "passed": true,  "code": "POOL_JOINABLE" },
    { "rule": "CAPACITY",             "passed": false, "code": "CAPACITY_EXCEEDED" },
    { "rule": "PICKUP_DISTANCE",      "passed": true,  "code": "PICKUP_COMPATIBLE" },
    { "rule": "DESTINATION_DISTANCE", "passed": true,  "code": "DESTINATION_COMPATIBLE" },
    { "rule": "STOP_LIMIT",           "passed": true,  "code": "STOP_LIMIT_SATISFIED" },
    { "rule": "DETOUR",               "passed": true,  "code": "DETOUR_WITHIN_LIMIT" }
  ]
}
```
The route is perfect, and it doesn't matter: capacity is a deterministic rule no score or model can override.

### 9–11. Driver lifecycle

```bash
for id in $N_ID $R_ID; do post /rides/$id/arrive '' $JASHIM > /dev/null; done
for id in $N_ID $R_ID; do post /rides/$id/start  '' $JASHIM > /dev/null; done
post /rides/$R_ID/complete '' $JASHIM | jq -c '.data | {status, finalFare}'
post /rides/$N_ID/complete '' $JASHIM | jq -c '.data | {status, finalFare}'
get /pools/$POOL $JASHIM | jq -r .data.status          # COMPLETED
```
Try an illegal move: `post /rides/$N_ID/cancel '' $NUSRAT` → `409 INVALID_STATE_TRANSITION` (`COMPLETED` is terminal).

### 12. Inspect the immutable ride history

```bash
get /rides/$N_ID/events $NUSRAT | jq -c '.data[] | [.eventType, .from, .to, .metadata.cause]'
# ["RIDE_REQUESTED",null,"REQUESTED",null]
# ["STATUS_CHANGED","REQUESTED","MATCHED","POOL_JOINED"]
# ["ROUTE_UPDATED",null,null,"JOIN"]
# ["STATUS_CHANGED","MATCHED","DRIVER_ARRIVED","DRIVER_ARRIVED"]
# ["STATUS_CHANGED","DRIVER_ARRIVED","STARTED","STARTED"]
# ["STATUS_CHANGED","STARTED","COMPLETED","COMPLETED"]
get /rides/$S_ID/events $SHIRIN | jq -c '.data[] | [.eventType, .metadata.decision.reasonCodes]'
# ["RIDE_REQUESTED",null]
# ["MATCH_REJECTED",["CAPACITY_EXCEEDED"]]
```

### 13. "Why?": plain-language explanations

```bash
get /rides/$N_ID/explanation $NUSRAT | jq '.data | {summary, fare: .fare.lines, timeline: [.timeline[].description]}'
get /rides/$S_ID/explanation $SHIRIN | jq '.data | {summary, rejections: [.rejections[] | .reasons]}'
# Shirin: "Not matched: Only 1 seat left, 2 requested"
```

### 14. Driver view: compatible requests → accept

```bash
POOL2=$(post /pools "{\"vehicleId\":\"$VEHICLE\"}" $JASHIM | jq -r .data.id)       # a new pool (the first one is COMPLETED)
get /pools/$POOL2/requests $JASHIM | jq -c '.data[] | {passengerFirstName, waitingSeconds, headline: .decision.headline}'
post /pools/$POOL2/accept "{\"rideRequestId\":\"<a waiting rideRequestId>\"}" $JASHIM | jq -c '.data | {decision, headline}'
```

### 15. Impact dashboard (live from the DB)

```bash
curl -s $API/stats/impact | jq '.data | {rides, matching, pooling, occupancy, integrity}'
# integrity.capacityViolations is recounted from raw memberships: 0
```

## Talking points

| Claim | Proof |
|---|---|
| Explainability | step 6 reason codes + rejected alternative; step 8 per-rule checks; step 13 plain-language explanation |
| Concurrency correctness | `npm run test:concurrency`: 10 riders race for 1 seat → exactly 1 wins, `occupied ≤ capacity` (also a DB CHECK) |
| ML safety | `quote.fare` shows baseline, ML value, band, decision; ±20% guardrail |
| Financial correctness | every amount is integer poysha (`amountPoysha`), discounts in basis points |
| Failure tolerance | `docker compose stop ml` → rides still created, `/health/ready` = `ready_degraded` |
| Auditability | step 12; `UPDATE ride_events …` is rejected by a trigger |
