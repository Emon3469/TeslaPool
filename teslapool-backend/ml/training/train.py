"""
Reproducible training + evaluation for TeslaPool ETA and fare models.

    python ml/training/train.py

Outputs
  ml/models/eta/eta-v1.joblib        sklearn Pipeline (request-time features -> minutes)
  ml/models/fare/fare-v1.joblib      sklearn Pipeline (request-time features + predicted ETA -> BDT)
  ml/models/model_card.json          versions, algorithms, features, data hash, library versions
  ml/evaluation/metrics.json         every candidate's CV metrics (MAE / RMSE / R2, mean and std)
  ml/evaluation/report.md            human-readable benchmark + leakage analysis

Methodology
  * ~100 rows -> simple models only, repeated K-fold CV (5 folds x 3 repeats, fixed seed).
  * Model selection by mean CV MAE. Regression metrics only; no "accuracy %".
  * The fare model is trained on OUT-OF-FOLD ETA predictions, never on actual duration,
    so its training distribution matches what it sees at request time.
  * Leakage analysis: the same fare models trained WITH actual duration are reported
    separately, to quantify how much the (unavailable) actual duration would help.
"""
from __future__ import annotations

import hashlib
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import KFold, RepeatedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from preprocessing.features import (  # noqa: E402
    CATEGORICAL_FEATURES, ETA_TARGET, FARE_EXTRA_FEATURE, FARE_TARGET,
    NUMERIC_FEATURES, build_request_features,
)

SEED = 42
DATASET = ML_DIR / "datasets" / "dhaka_small_vehicle_fares.csv"
ETA_VERSION = "eta-v1"
FARE_VERSION = "fare-v1"

# Deterministic baselines. These MUST mirror the backend defaults in src/config/env.ts
# (FARE_* and ETA_MIN_PER_KM_*), so the report compares ML with the real fallback.
ETA_MIN_PER_KM = {"Low": 3.3, "Medium": 5.0, "High": 7.5, "Gridlock": 12.0}
FARE_BASE_BDT, FARE_PER_KM_BDT, FARE_PER_MIN_BDT = 50.0, 20.0, 0.5
GUARDRAIL_TOLERANCE = 0.20


def candidates(numeric: list[str]) -> dict[str, Pipeline]:
    def pre(scale: bool) -> ColumnTransformer:
        return ColumnTransformer([
            ("num", StandardScaler() if scale else "passthrough", numeric),
            ("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL_FEATURES),
        ])

    return {
        "Ridge": Pipeline([("pre", pre(True)), ("model", Ridge(alpha=1.0))]),
        "RandomForest": Pipeline([("pre", pre(False)), ("model", RandomForestRegressor(
            n_estimators=300, min_samples_leaf=2, random_state=SEED, n_jobs=1))]),
        "ExtraTrees": Pipeline([("pre", pre(False)), ("model", ExtraTreesRegressor(
            n_estimators=300, min_samples_leaf=2, random_state=SEED, n_jobs=1))]),
        "GradientBoosting": Pipeline([("pre", pre(False)), ("model", GradientBoostingRegressor(
            n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=SEED))]),
    }


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(np.sqrt(mean_squared_error(y_true, y_pred))),
        "r2": float(r2_score(y_true, y_pred)),
    }


def cross_validate(pipe: Pipeline, X: pd.DataFrame, y: np.ndarray) -> dict[str, float]:
    """Repeated K-fold CV; returns mean and std of each metric across all folds."""
    folds = []
    for train_idx, test_idx in RepeatedKFold(n_splits=5, n_repeats=3, random_state=SEED).split(X):
        pipe.fit(X.iloc[train_idx], y[train_idx])
        folds.append(metrics(y[test_idx], pipe.predict(X.iloc[test_idx])))
    out: dict[str, float] = {}
    for key in ("mae", "rmse", "r2"):
        values = np.array([f[key] for f in folds])
        out[key] = round(float(values.mean()), 3)
        out[f"{key}_std"] = round(float(values.std()), 3)
    return out


def benchmark(X: pd.DataFrame, y: np.ndarray, numeric: list[str]) -> dict[str, dict[str, float]]:
    return {name: cross_validate(pipe, X, y) for name, pipe in candidates(numeric).items()}


def best(results: dict[str, dict[str, float]]) -> str:
    return min(results, key=lambda name: results[name]["mae"])


def main() -> None:
    raw = pd.read_csv(DATASET)
    data_sha256 = hashlib.sha256(DATASET.read_bytes()).hexdigest()
    X = build_request_features(raw)
    y_eta = raw[ETA_TARGET].to_numpy(dtype=float)
    y_fare = raw[FARE_TARGET].to_numpy(dtype=float)

    # ── Deterministic baselines (what the backend falls back to) ──────────────
    det_eta = raw["Distance_KM"] * raw["Traffic_Condition"].map(ETA_MIN_PER_KM)
    det_fare = FARE_BASE_BDT + FARE_PER_KM_BDT * raw["Distance_KM"] + FARE_PER_MIN_BDT * det_eta
    # The configured min/km constants were read off this same dataset, so the in-sample number
    # above is optimistic. Re-estimate the per-traffic median on each training fold instead.
    folds = []
    for train_idx, test_idx in RepeatedKFold(n_splits=5, n_repeats=3, random_state=SEED).split(raw):
        train = raw.iloc[train_idx]
        mpk = (train["Duration_Minutes"] / train["Distance_KM"]).groupby(train["Traffic_Condition"]).median()
        test = raw.iloc[test_idx]
        folds.append(metrics(y_eta[test_idx], (test["Distance_KM"] * test["Traffic_Condition"].map(mpk)).to_numpy()))
    baselines = {
        "eta_deterministic_in_sample": {k: round(v, 3) for k, v in metrics(y_eta, det_eta.to_numpy()).items()},
        "eta_deterministic_cv": {k: round(float(np.mean([f[k] for f in folds])), 3) for k in ("mae", "rmse", "r2")},
        "fare_deterministic": {k: round(v, 3) for k, v in metrics(y_fare, det_fare.to_numpy()).items()},
    }

    # ── ETA: request-time features only ───────────────────────────────────────
    eta_results = benchmark(X, y_eta, NUMERIC_FEATURES)
    eta_algo = best(eta_results)

    # Out-of-fold ETA predictions become the fare model's duration feature.
    eta_oof = cross_val_predict(candidates(NUMERIC_FEATURES)[eta_algo], X, y_eta,
                                cv=KFold(n_splits=5, shuffle=True, random_state=SEED))
    X_fare = X.copy()
    X_fare[FARE_EXTRA_FEATURE] = np.maximum(1.0, eta_oof)
    fare_numeric = NUMERIC_FEATURES + [FARE_EXTRA_FEATURE]

    # ── Fare: deployable (predicted ETA) ──────────────────────────────────────
    fare_results = benchmark(X_fare, y_fare, fare_numeric)
    fare_algo = best(fare_results)

    # ── Leakage analysis: fare WITH actual duration (NOT deployable) ──────────
    X_leak = X.copy()
    X_leak["actual_duration_min"] = y_eta
    leak_results = benchmark(X_leak, y_fare, NUMERIC_FEATURES + ["actual_duration_min"])
    no_duration_results = benchmark(X, y_fare, NUMERIC_FEATURES)

    # ── Guardrail simulation: OOF ML fare vs deterministic baseline ───────────
    fare_oof = cross_val_predict(candidates(fare_numeric)[fare_algo], X_fare, y_fare,
                                 cv=KFold(n_splits=5, shuffle=True, random_state=SEED))
    det_fare_pred_eta = FARE_BASE_BDT + FARE_PER_KM_BDT * raw["Distance_KM"] + FARE_PER_MIN_BDT * X_fare[FARE_EXTRA_FEATURE]
    deviation = np.abs(fare_oof - det_fare_pred_eta) / det_fare_pred_eta
    accepted = deviation <= GUARDRAIL_TOLERANCE
    guarded = np.where(accepted, fare_oof, det_fare_pred_eta)
    guardrail = {
        "tolerance": GUARDRAIL_TOLERANCE,
        "ml_accepted_fraction": round(float(accepted.mean()), 3),
        "guarded_fare": {k: round(v, 3) for k, v in metrics(y_fare, guarded).items()},
    }

    # ── Fit final models on all rows and persist ──────────────────────────────
    eta_pipe = candidates(NUMERIC_FEATURES)[eta_algo].fit(X, y_eta)
    fare_pipe = candidates(fare_numeric)[fare_algo].fit(X_fare, y_fare)
    (ML_DIR / "models" / "eta").mkdir(parents=True, exist_ok=True)
    (ML_DIR / "models" / "fare").mkdir(parents=True, exist_ok=True)
    joblib.dump(eta_pipe, ML_DIR / "models" / "eta" / f"{ETA_VERSION}.joblib")
    joblib.dump(fare_pipe, ML_DIR / "models" / "fare" / f"{FARE_VERSION}.joblib")

    trained_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    card = {
        "trainedAt": trained_at,
        "dataset": {"file": DATASET.name, "rows": int(len(raw)), "sha256": data_sha256},
        "libraries": {"python": platform.python_version(), "scikit-learn": sklearn.__version__,
                      "pandas": pd.__version__, "numpy": np.__version__},
        "eta": {"modelName": "eta", "modelVersion": ETA_VERSION, "algorithm": eta_algo,
                "file": f"eta/{ETA_VERSION}.joblib", "features": NUMERIC_FEATURES + CATEGORICAL_FEATURES,
                "target": ETA_TARGET, "cv": eta_results[eta_algo]},
        "fare": {"modelName": "fare", "modelVersion": FARE_VERSION, "algorithm": fare_algo,
                 "file": f"fare/{FARE_VERSION}.joblib",
                 "features": fare_numeric + CATEGORICAL_FEATURES, "target": FARE_TARGET,
                 "cv": fare_results[fare_algo]},
        "limitations": [
            "100-row synthetic-scale dataset: prototype only, not production accuracy.",
            "Distance_KM in training is measured trip distance; at request time the backend supplies a zone-graph estimate.",
            "Only three vehicle types and ten zones are represented; anything else is out of distribution.",
        ],
    }
    (ML_DIR / "models" / "model_card.json").write_text(json.dumps(card, indent=2), encoding="utf-8")

    report = {
        "trainedAt": trained_at,
        "cv": "RepeatedKFold(n_splits=5, n_repeats=3, random_state=42)",
        "baselines": baselines,
        "eta": {"selected": eta_algo, "candidates": eta_results},
        "fare": {"selected": fare_algo, "candidates": fare_results},
        "leakage_analysis": {
            "fare_without_any_duration": no_duration_results,
            "fare_with_predicted_eta_deployable": fare_results,
            "fare_with_actual_duration_LEAKY": leak_results,
        },
        "guardrail_simulation": guardrail,
    }
    (ML_DIR / "evaluation").mkdir(exist_ok=True)
    (ML_DIR / "evaluation" / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (ML_DIR / "evaluation" / "report.md").write_text(render_report(report), encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(render_report(report))


def table(results: dict[str, dict[str, float]], unit: str, selected: str | None = None) -> str:
    rows = [f"| Model | MAE ({unit}) | RMSE ({unit}) | R² |", "|---|---|---|---|"]
    for name, m in sorted(results.items(), key=lambda kv: kv[1]["mae"]):
        mark = " ✅" if name == selected else ""
        rows.append(f"| {name}{mark} | {m['mae']:.2f} ± {m['mae_std']:.2f} | "
                    f"{m['rmse']:.2f} ± {m['rmse_std']:.2f} | {m['r2']:.3f} ± {m['r2_std']:.3f} |")
    return "\n".join(rows)


def render_report(r: dict) -> str:
    b = r["baselines"]
    la = r["leakage_analysis"]
    g = r["guardrail_simulation"]
    return f"""# TeslaPool model evaluation

Generated by `ml/training/train.py` at {r['trainedAt']}. CV: `{r['cv']}`.
Metrics are mean ± std across the 15 folds. ~100 rows: treat as a prototype signal, not production accuracy.

## ETA (request-time features only)

Deterministic fallback (distance × min/km by traffic), same CV folds with per-fold medians:
MAE {b['eta_deterministic_cv']['mae']:.2f} min, R² {b['eta_deterministic_cv']['r2']:.3f}
(in-sample with the configured constants: MAE {b['eta_deterministic_in_sample']['mae']:.2f} min).

{table(r['eta']['candidates'], 'min', r['eta']['selected'])}

## Fare (deployable: request-time features + predicted ETA)

Deterministic TeslaPool baseline (৳50 + ৳20/km + ৳0.5/min): MAE ৳{b['fare_deterministic']['mae']:.2f}, R² {b['fare_deterministic']['r2']:.3f}.
The baseline is a platform pricing *policy*, not an attempt to fit this market data, so a large MAE is expected.

{table(r['fare']['candidates'], 'BDT', r['fare']['selected'])}

## Leakage analysis

Fare models trained **with actual `Duration_Minutes`** (NOT deployable: unknown at request time):

{table(la['fare_with_actual_duration_LEAKY'], 'BDT')}

Fare models with **no duration feature at all**:

{table(la['fare_without_any_duration'], 'BDT')}

Actual duration improves offline scores, but it is only observed after the trip, so using it
online would be target leakage. The deployable model substitutes the ETA model's prediction.

## Guardrail simulation (out-of-fold)

With a ±{int(g['tolerance'] * 100)}% band around the deterministic baseline, the ML fare is accepted for
{g['ml_accepted_fraction'] * 100:.0f}% of trips; otherwise the deterministic fare is used.
Guarded final fare vs actual: MAE ৳{g['guarded_fare']['mae']:.2f}, R² {g['guarded_fare']['r2']:.3f}.
"""


if __name__ == "__main__":
    main()
