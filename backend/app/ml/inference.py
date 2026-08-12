"""
Phase 4 — serves the trained ATS model for live scoring.

Loads the joblib model once at import time (not per-request) and exposes
predict_score(), the single function the resume analyzer calls to get an
ats_score. Deterministic and free, unlike the LLM path it replaces: the same
(resume, job_description) pair always yields the same score, and scoring a
real user's resume costs nothing beyond the CPU cycles.

extract_features()/features_to_vector() are the exact same pure functions
scripts/train_ats_model.py used to build the training matrix — using anything
else here would be train/serve skew.
"""

from pathlib import Path

import joblib

from app.ml.features import extract_features, features_to_vector

MODEL_PATH = Path(__file__).resolve().parent / "models" / "ats_model.joblib"

_model = None


def model_available() -> bool:
    return MODEL_PATH.exists()


def _load_model():
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise RuntimeError(f"No trained model at {MODEL_PATH} — run scripts/train_ats_model.py first.")
        _model = joblib.load(MODEL_PATH)
    return _model


def predict_score(resume_text: str, job_description: str) -> int:
    """Deterministic ATS match score, 0-100 — same input always gives the same output."""
    model = _load_model()
    vector = features_to_vector(extract_features(resume_text, job_description))
    raw = model.predict([vector])[0]
    return int(round(max(0.0, min(100.0, raw))))
