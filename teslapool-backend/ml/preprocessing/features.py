"""
Shared feature engineering for TeslaPool ETA and fare models.

This module is imported by BOTH training (ml/training/train.py) and inference
(ml/inference/app.py), so the feature transformation used at serving time is
byte-for-byte the one used at training time (no train/serve skew in code).

LEAKAGE RULE
------------
`Duration_Minutes` is the *actual* trip duration. It is only known after the
trip ends, so it is NEVER a request-time feature. It is used only as the ETA
model's target and, separately, in the offline leakage analysis.
"""
from __future__ import annotations

import pandas as pd

# Canonical dataset vocabularies (exact strings as they appear in the CSV).
VEHICLE_TYPES = ["CNG Auto-Rickshaw", "Rickshaw", "Bike (Ride-share)"]
ZONES = [
    "Azimpur", "Banani", "Bashundhara R/A", "Dhanmondi", "Farmgate",
    "Gulshan", "Mirpur", "Mohakhali", "Motijheel", "Uttara",
]
TRAFFIC_LEVELS = ["Low", "Medium", "High", "Gridlock"]
WEATHER = ["Clear", "Overcast", "Rainy"]
TIMES_OF_DAY = ["Morning Peak", "Evening Peak", "Off-Peak", "Night"]

TRAFFIC_ORDINAL = {level: i for i, level in enumerate(TRAFFIC_LEVELS)}

# Distance x traffic interactions: lets models learn a per-traffic "minutes per km"
# directly (duration is close to multiplicative in distance and congestion).
# Uses only request-time inputs, no target statistics.
INTERACTION_FEATURES = [f"dist_x_{level.lower()}" for level in TRAFFIC_LEVELS]

# Request-time features only.
NUMERIC_FEATURES = ["Distance_KM", "Surge_Multiplier", "traffic_ord", "is_same_zone", *INTERACTION_FEATURES]
CATEGORICAL_FEATURES = [
    "Vehicle_Type", "Pickup_Zone", "Dropoff_Zone",
    "Traffic_Condition", "Weather", "Time_of_Day",
]
# The fare model additionally receives the ETA model's prediction (never actual duration).
FARE_EXTRA_FEATURE = "predicted_duration_min"

ETA_TARGET = "Duration_Minutes"
FARE_TARGET = "Fare_BDT"


def build_request_features(df: pd.DataFrame) -> pd.DataFrame:
    """Derive the request-time feature frame from raw columns."""
    out = pd.DataFrame(index=df.index)
    out["Distance_KM"] = df["Distance_KM"].astype(float)
    out["Surge_Multiplier"] = df["Surge_Multiplier"].astype(float)
    out["traffic_ord"] = df["Traffic_Condition"].map(TRAFFIC_ORDINAL).astype(int)
    out["is_same_zone"] = (df["Pickup_Zone"] == df["Dropoff_Zone"]).astype(int)
    for level, col in zip(TRAFFIC_LEVELS, INTERACTION_FEATURES):
        out[col] = out["Distance_KM"] * (df["Traffic_Condition"] == level).astype(float)
    for col in CATEGORICAL_FEATURES:
        out[col] = df[col].astype(str)
    return out


def validate_payload(payload: dict) -> list[str]:
    """Return a list of validation errors for a single inference payload."""
    errors: list[str] = []
    vocab = {
        "Vehicle_Type": VEHICLE_TYPES,
        "Pickup_Zone": ZONES,
        "Dropoff_Zone": ZONES,
        "Traffic_Condition": TRAFFIC_LEVELS,
        "Weather": WEATHER,
        "Time_of_Day": TIMES_OF_DAY,
    }
    for key, allowed in vocab.items():
        if payload.get(key) not in allowed:
            errors.append(f"{key} must be one of {allowed}")
    dist = payload.get("Distance_KM")
    if not isinstance(dist, (int, float)) or not (0 < dist <= 100):
        errors.append("Distance_KM must be a number in (0, 100]")
    surge = payload.get("Surge_Multiplier")
    if not isinstance(surge, (int, float)) or not (0.5 <= surge <= 5):
        errors.append("Surge_Multiplier must be a number in [0.5, 5]")
    return errors
