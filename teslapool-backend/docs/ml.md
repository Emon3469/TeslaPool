# Machine learning

**Scope:** ML estimates two uncertain quantities, **ETA** and **fare**. It never decides capacity, detour, stops, ownership, authorization or state transitions. Every ML output passes a deterministic guardrail and has a deterministic fallback.

**Pricing is deterministic by default.** PRD §5 requires that an evaluator can compute Nusrat's and Rafiq's fares by hand, which is impossible if a tree ensemble sets the price. So by default (`FARE_PRICING_MODE=deterministic`) the charged fare is always the itemised formula, priced on the deterministic duration; the fare model's estimate is logged in `prediction_events` and reported in the quote (`mlPredictedFarePoysha`, `mlWithinGuardrail`) as an **advisory market signal**. With `FARE_PRICING_MODE=ml_guarded` the model may set the price inside the ±20% band. The ML **ETA** shown to riders is used in both modes (inside its plausibility band).

**Vehicle types:** the PRD's "Tesla" is Dhaka slang for an auto-rickshaw, so the API's `AUTO_RICKSHAW` maps directly to the dataset's "CNG Auto-Rickshaw" class (no proxy or invented class).

```
request-time features ──► ETA model ──► predicted minutes ──┐
        │                                                    ├─► fare model ──► ML fare (BDT)
        └────────────────────────────────────────────────────┘
                                   │                                 │
                     ETA guard [0.5×, 2.0×] of              fare guard ±20% of the
                     deterministic ETA                      deterministic baseline
                                   ▼                                 ▼
                              final ETA  ──────────►  baseline = base + km·rate + min·rate
                                                                     ▼
                                                                final fare (integer poysha)
```

## Data

`ml/datasets/dhaka_small_vehicle_fares.csv`: **100 trips**, 3 vehicle types (CNG auto-rickshaw 40, rickshaw 33, bike ride-share 27), 10 Dhaka zones, distance, actual duration, traffic, weather, time of day, surge, fare. No nulls.

This is enough for a **prototype signal**, not production accuracy. All numbers below are from cross-validation on 100 rows and carry wide error bars (see the ± columns).

## Leakage rule

`Duration_Minutes` is the **actual** trip duration, known only after the trip. It is never a request-time feature:

- it is the **target** of the ETA model;
- the deployable fare model receives the ETA model's **prediction** instead (`predicted_duration_min`), and is trained on **out-of-fold** ETA predictions so its training inputs look like serving inputs;
- models trained *with* actual duration appear only in the leakage analysis below, clearly marked as not deployable.

Request-time features: `Distance_KM`, `Surge_Multiplier`, `traffic_ord`, `is_same_zone`, `dist_x_{low,medium,high,gridlock}` (distance × traffic indicator, which lets a model learn minutes-per-km per congestion level without using target statistics), plus one-hot `Vehicle_Type`, `Pickup_Zone`, `Dropoff_Zone`, `Traffic_Condition`, `Weather`, `Time_of_Day`. Shared code: `ml/preprocessing/features.py` is imported by **both** training and serving, so feature engineering cannot drift.

## Method

- `RepeatedKFold(n_splits=5, n_repeats=3, random_state=42)`: 15 folds, mean ± std.
- Candidates: Ridge, RandomForest, ExtraTrees, GradientBoosting (small, regularised; **no deep learning**, the dataset is far too small).
- Selection: lowest mean CV MAE. Metrics: **MAE, RMSE, R²** (no "accuracy %" for regression).
- Deterministic baselines are evaluated on the same folds for an honest comparison (ETA min/km medians are re-estimated inside each training fold).

Reproduce: `npm run ml:train` (`python ml/training/train.py`). Outputs `ml/evaluation/metrics.json`, `ml/evaluation/report.md`, and the artifacts under `ml/models/`.

## Results (current artifacts)

### ETA: request-time features only

| Model | MAE (min) | RMSE (min) | R² |
|---|---|---|---|
| **Ridge** ✅ `eta-v1` | **4.38 ± 1.13** | 6.19 ± 1.72 | 0.976 ± 0.011 |
| GradientBoosting | 5.45 ± 2.77 | 8.80 ± 4.75 | 0.952 ± 0.039 |
| ExtraTrees | 6.31 ± 2.74 | 9.81 ± 4.26 | 0.937 ± 0.043 |
| RandomForest | 8.69 ± 2.88 | 13.00 ± 4.52 | 0.896 ± 0.047 |
| *Deterministic fallback (distance × min/km)* | *5.06* | *10.25* | *0.926* |

**Finding:** without the interaction features, every ML model *lost* to the one-line heuristic (best was GradientBoosting at 6.45 min). Duration here is close to `distance × congestion factor`, which trees approximate poorly. With the interactions, Ridge beats the heuristic by ~13%: a real but modest gain. We ship it because it wins in CV, and the heuristic remains the fallback.

### Fare: deployable (request-time features + predicted ETA)

| Model | MAE (BDT) | RMSE (BDT) | R² |
|---|---|---|---|
| **ExtraTrees** ✅ `fare-v1` | **36.31 ± 11.32** | 54.69 ± 19.71 | 0.935 ± 0.041 |
| GradientBoosting | 36.92 ± 12.30 | 58.18 ± 17.89 | 0.918 ± 0.063 |
| Ridge | 43.58 ± 11.98 | 59.80 ± 17.40 | 0.917 ± 0.069 |
| RandomForest | 58.54 ± 19.58 | 86.23 ± 28.78 | 0.815 ± 0.196 |
| *Deterministic TeslaPool baseline (৳50 + ৳20/km + ৳0.5/min)* | *94.80* | *158.73* | *0.543* |

The deterministic baseline is a **pricing policy**, not a fit to this market data, so its large error against market fares is expected.

### Leakage analysis

| Fare model variant | Best MAE (BDT) | Deployable? |
|---|---|---|
| with **actual** `Duration_Minutes` | 30.70 (Ridge) | ❌ leakage: unknown at request time |
| with **predicted** ETA | 36.31 (ExtraTrees) | ✅ |
| with **no** duration feature | 36.92 (GradientBoosting) | ✅ |

Actual duration improves fare MAE by ~15%, because it carries information (the congestion the trip actually hit) that nothing at request time has. The *predicted* ETA adds almost nothing over no duration at all, because it is itself a function of the same request-time features. It is kept for architectural fidelity (fare is conditioned on the ETA the passenger is shown), not because it improves accuracy.

### Guardrail simulation (out-of-fold)

With ±20% around the deterministic baseline, the ML fare is accepted for **51%** of trips; the guarded final fare has MAE ৳91.7 against market fares.

**Interpretation:** the guardrail keeps prices close to TeslaPool's policy by design, so today ML mostly acts as a bounded adjustment. If the business wants prices closer to the market, the right levers are recalibrating the baseline constants (`FARE_*`) or widening `ML_FARE_MAX_DEVIATION`. Both are explicit configuration decisions, never something the model does on its own.

### Comparison with the earlier notebook

The brief quoted prototype numbers (Ridge ≈ ৳64.5, RF ≈ ৳60, ExtraTrees ≈ ৳58), and the original notebook reported GradientBoosting ৳32.8 from a single 5-fold split. Differences come from the feature set (interaction terms), the CV protocol (15 repeated folds vs one split) and the OOF-ETA training. The notebook artifacts in `tesla_pool_ml/` were **not** reused: their scikit-learn version was not recorded, and pickles are version-sensitive. Models were retrained reproducibly here.

## Versioning and traceability

- `ml/models/model_card.json` records model name + version (`eta-v1`, `fare-v1`), algorithm, features, target, CV metrics, dataset SHA-256, and Python / scikit-learn / pandas / numpy versions.
- The sidecar **refuses to start** if the runtime scikit-learn major.minor differs from the model card (a mismatched pickle can load and silently predict differently).
- New models get a **new version string and file**; nothing is overwritten in place.
- Every prediction is logged in `prediction_events`: `model_name`, `model_version`, `prediction_type`, `prediction_value`, **exact feature snapshot**, `used_for_decision`, `latency_ms`. Deterministic estimates are logged too (`deterministic-eta@rules-v1`, `deterministic-fare@rules-v1`), so "which model priced this ride and what did it see?" is always answerable.

## Serving

`ml/inference/app.py` (FastAPI) exposes `GET /health` and `POST /v1/predict`. It validates the closed vocabulary, rejects unknown fields (`extra="forbid"`), and returns **raw** predictions only. All guardrails live in the Node domain (`src/predictions/prediction.service.ts`, `src/fares/fare-engine.ts`).

Node client (`HttpMlPredictor`): 1.5 s timeout, strict response-shape validation, circuit breaker (30 s cooldown after a failure). Absent `ML_SIDECAR_URL` → `DisabledMlPredictor` (fully deterministic).

Failure behaviour (all covered by tests):

| Situation | Result |
|---|---|
| Sidecar not configured / down / timeout / 5xx / malformed JSON | deterministic ETA + fare, `reason: ML_PREDICTION_UNAVAILABLE`; ride flow unaffected; `/health/ready` → `ready_degraded` |
| ML ETA outside [0.5×, 2×] deterministic | deterministic ETA, `ETA_GUARDRAIL_TRIGGERED` |
| ML fare outside ±20% of baseline | deterministic fare, `FARE_GUARDRAIL_TRIGGERED` |

## Train/serve skew (known limitation)

`Distance_KM` in training is the **measured** trip distance. At request time the backend supplies the **zone-graph estimate** (`ZONE_GRAPH_DISTANCE`), e.g. Banani→Gulshan is 2.5 km on the graph but 0.9–1.2 km in several training rows. A real routing provider (behind `DistanceProvider`) or GPS-based distance would remove this skew.

## Prediction intervals

Not implemented. Nothing in the API is called a "confidence interval". A calibrated *prediction interval* could be added with split-conformal intervals from the out-of-fold residuals already computed in training; with 100 rows it would be wide and should be labelled as such.

## Why no matching model

The dataset has no match outcome, rejection reason, detour, occupancy, wait time, post-match cancellation, acceptance or satisfaction. There is **no legitimate label** for match quality, so matching stays deterministic. The system now **collects** those labels: every `MATCH_REJECTED` event stores the full explainable decision, and `STATUS_CHANGED`/`ROUTE_UPDATED` events record outcomes. A future pipeline would be *candidate generation → hard-constraint filtering → ML ranking → deterministic validation inside the transaction*.
