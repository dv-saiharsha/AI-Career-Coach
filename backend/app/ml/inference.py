"""
Phase 4 — serves the trained ATS model for live scoring.

Loads the joblib model once, lazily on first use, and caches it in a module
singleton (not per-request) — see _load_model() — and exposes
predict_score(), the single function the resume analyzer calls to get an
ats_score. Deterministic and free, unlike the LLM path it replaces: the same
(resume, job_description) pair always yields the same score, and scoring a
real user's resume costs nothing beyond the CPU cycles.

extract_features()/features_to_vector() are the exact same pure functions
scripts/train_ats_model.py used to build the training matrix — using anything
else here would be train/serve skew.
"""

import json
from pathlib import Path

import joblib

from app.ml.features import extract_features, features_to_vector

MODEL_PATH = Path(__file__).resolve().parent / "models" / "ats_model.joblib"
METADATA_PATH = Path(__file__).resolve().parent / "models" / "ats_model_metadata.json"

_model = None
_calibration: list[list[float]] | None = None


def _load_calibration() -> list[list[float]]:
    """Anchor points mapping raw model output to the reported score.

    The model was trained on labels that put a genuinely strong resume at
    ~41/100, so its raw output is squeezed into roughly 15-60 and
    rubric.band() reads most of that as failure. Measured across 406
    postings before this existed: 53% of genuinely strong resumes were shown
    "NEEDS WORK", 22.7% "WEAK", and 0.7% "STRONG".

    The map is fitted during training and stored in the metadata rather than
    hardcoded here, so a retrain re-fits it against that model's own output
    instead of inheriting anchors from a previous one.

    Empty list means no calibration — an older metadata file, or a model
    trained before this. predict_score then returns the raw value, which is
    wrong-looking but not broken, and is the right failure direction.
    """
    global _calibration
    if _calibration is None:
        try:
            data = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
            _calibration = data.get("calibration") or []
        except (OSError, ValueError):
            _calibration = []
    return _calibration


def _apply_calibration(raw: float) -> float:
    """Piecewise-linear interpolation through the fitted anchors.

    Monotonic by construction, which is the property that matters: it cannot
    reorder two resumes, so the ordering accuracy the model is measured on
    survives it untouched. Only the number shown moves.
    """
    anchors = _load_calibration()
    if len(anchors) < 2:
        return raw

    if raw <= anchors[0][0]:
        return anchors[0][1]
    for (x0, y0), (x1, y1) in zip(anchors, anchors[1:]):
        if raw <= x1:
            span = x1 - x0
            return y0 if span <= 0 else y0 + (raw - x0) * (y1 - y0) / span
    return anchors[-1][1]


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
    return int(round(max(0.0, min(100.0, _apply_calibration(float(raw))))))
