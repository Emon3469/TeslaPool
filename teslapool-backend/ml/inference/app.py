"""
TeslaPool ML inference sidecar (FastAPI).

Serves RAW model predictions only. It deliberately knows nothing about fare
guardrails, capacity or ride state: the Node domain engine applies guardrails
and falls back to deterministic estimators whenever this service is slow,
down, or returns something implausible.

    uvicorn app:app --host 0.0.0.0 --port 8000     (run from ml/inference)
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

ML_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML_DIR))

from preprocessing.features import FARE_EXTRA_FEATURE, build_request_features, validate_payload  # noqa: E402

MODELS_DIR = Path(os.environ.get("MODELS_DIR", ML_DIR / "models"))
CARD = json.loads((MODELS_DIR / "model_card.json").read_text(encoding="utf-8"))

# Pickled sklearn pipelines are only guaranteed to load correctly with the version that
# produced them. Refuse to serve rather than silently return different predictions.
trained_with = CARD["libraries"]["scikit-learn"]
if trained_with.split(".")[:2] != sklearn.__version__.split(".")[:2]:
    raise RuntimeError(f"Model card requires scikit-learn {trained_with}, runtime has {sklearn.__version__}")

ETA_PIPE = joblib.load(MODELS_DIR / CARD["eta"]["file"])
FARE_PIPE = joblib.load(MODELS_DIR / CARD["fare"]["file"])

app = FastAPI(title="TeslaPool ML sidecar", version="1.0.0", docs_url=None, redoc_url=None)


class PredictRequest(BaseModel):
    """Exact dataset-vocabulary feature payload (the backend's feature snapshot)."""
    model_config = ConfigDict(extra="forbid")

    Vehicle_Type: str = Field(max_length=40)
    Pickup_Zone: str = Field(max_length=40)
    Dropoff_Zone: str = Field(max_length=40)
    Distance_KM: float
    Traffic_Condition: str = Field(max_length=20)
    Weather: str = Field(max_length=20)
    Time_of_Day: str = Field(max_length=20)
    Surge_Multiplier: float


def model_info(kind: str) -> dict:
    return {"modelName": CARD[kind]["modelName"], "modelVersion": CARD[kind]["modelVersion"],
            "algorithm": CARD[kind]["algorithm"]}


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "eta": model_info("eta"), "fare": model_info("fare"),
            "scikitLearn": sklearn.__version__}


@app.post("/v1/predict")
def predict(req: PredictRequest) -> dict:
    payload = req.model_dump()
    errors = validate_payload(payload)
    if errors:
        raise HTTPException(status_code=422, detail=errors)

    X = build_request_features(pd.DataFrame([payload]))
    eta_min = max(1.0, float(ETA_PIPE.predict(X)[0]))
    X[FARE_EXTRA_FEATURE] = eta_min
    fare_bdt = float(FARE_PIPE.predict(X)[0])

    return {
        "eta": {**model_info("eta"), "predictedDurationMin": round(eta_min, 2)},
        "fare": {**model_info("fare"), "predictedFareBdt": round(fare_bdt, 2),
                 "inputs": {FARE_EXTRA_FEATURE: round(eta_min, 2)}},
    }
