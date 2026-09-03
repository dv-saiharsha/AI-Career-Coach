"""
Phase 3 — trains the fast ATS scoring model on data/training_data.csv.

Loads every labeled (resume, JD, score) pair, runs each through the Phase-2
feature extractor, and fits a GradientBoostingRegressor — a small, fast,
CPU-only model whose feature_importances_ double as a sanity check that it
isn't learning something dumb (e.g. "longer resume = higher score").

Evaluation uses 5-fold cross-validation rather than one fixed 80/20 split:
at this dataset size a single split's test set is small enough that its
MAE/R2 would bounce around depending on which rows happened to land in it.
Averaging across 5 folds gives a much steadier estimate of real accuracy.

Output:
  app/ml/models/ats_model.joblib          — the fitted pipeline (not committed; see .gitignore)
  app/ml/models/ats_model_metadata.json   — training date, dataset size, CV metrics, feature list

Usage:
    python scripts/train_ats_model.py
"""

import csv
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np  # noqa: E402
from sklearn.ensemble import GradientBoostingRegressor  # noqa: E402
from sklearn.model_selection import KFold, cross_val_predict  # noqa: E402
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402

from app.ml.features import FEATURE_NAMES, extract_features, features_to_vector  # noqa: E402

DATA_CSV = Path(__file__).resolve().parent.parent / "data" / "training_data.csv"
MODEL_DIR = Path(__file__).resolve().parent.parent / "app" / "ml" / "models"
MODEL_PATH = MODEL_DIR / "ats_model.joblib"
METADATA_PATH = MODEL_DIR / "ats_model_metadata.json"

MAE_WARN_THRESHOLD = 10.0  # points on the 0-100 scale; flag rather than ship silently


# ── Adversarial augmentation ────────────────────────────────────────────────
#
# Every label in training_data.csv came from a real resume scored against a
# real posting. Nothing in it is a document trying to game the score, so the
# model never learned where the boundary is and extrapolated wildly past it.
# Measured on the unaugmented model (scripts/evaluate_ats_model.py):
#
#   a job description pasted back beat a genuinely strong resume on 99.8% of
#   postings, by a mean of 41.5 points
#   a keyword dump with no experience beat it on 98.3%
#   a strong resume padded with keywords beat its own unpadded self on 100%
#   adding real quantified achievements COST points on 86.7%
#
# MAE was 6.5 and R2 0.79 the whole time, because none of those documents was
# in the distribution the metrics are computed over.
#
# These are constructed rather than labelled, which is only defensible because
# the right answer is knowable without a judgement call:
#
#   A pasted posting and a keyword dump contain no evidence about the
#   candidate at all. They are not weak resumes, they are not resumes. Labelled
#   at ADVERSARIAL_FLOOR, which sits between the observed minimum (2) and the
#   5th percentile (8) of real labels — worse than almost every genuine
#   resume, without being an outlier the model has to contort to fit.
#
#   A padded resume keeps its own original label. This is the strongest of the
#   three: padding adds no information, so the score must not move, and the
#   model learns that directly from a pair that differs only by the padding.
#
# Kept to roughly 15% of the augmented set. Too few and they are noise the
# model ignores; too many and they drag the central tendency down and every
# real resume scores low. Sampling is deterministic (sorted, evenly spaced) so
# a retrain is reproducible.
ADVERSARIAL_FLOOR = 5.0
ADVERSARIAL_PER_KIND = 120


def _keyword_dump(jd_text: str, repeats: int = 30) -> str:
    from app.core.keywords import keyword_candidates

    return (" ".join(keyword_candidates(jd_text)) + " ") * repeats


def build_adversarial_rows(rows: list[dict]) -> list[dict]:
    """Constructed counter-examples, evenly sampled across postings."""
    by_jd: dict[str, dict] = {}
    for row in rows:
        # Prefer a strong resume as the base — padding a weak one teaches less,
        # since the honest version is already scored low.
        tier = row.get("resume_tier", "").split("-")[0]
        if row["jd_id"] not in by_jd or tier == "strong":
            by_jd[row["jd_id"]] = row

    ordered = [by_jd[key] for key in sorted(by_jd)]
    if not ordered:
        return []

    def sample(n: int) -> list[dict]:
        step = max(1, len(ordered) // n)
        return ordered[::step][:n]

    built: list[dict] = []

    for row in sample(ADVERSARIAL_PER_KIND):
        built.append(
            {
                "resume_text": row["job_description"] * 8,
                "job_description": row["job_description"],
                "ats_score": ADVERSARIAL_FLOOR,
            }
        )

    for row in sample(ADVERSARIAL_PER_KIND):
        built.append(
            {
                "resume_text": _keyword_dump(row["job_description"]),
                "job_description": row["job_description"],
                "ats_score": ADVERSARIAL_FLOOR,
            }
        )

    for row in sample(ADVERSARIAL_PER_KIND):
        built.append(
            {
                "resume_text": row["resume_text"] + "\n" + _keyword_dump(row["job_description"], 12),
                "job_description": row["job_description"],
                # Its own label, unchanged. Padding is not evidence.
                "ats_score": float(row["ats_score"]),
            }
        )

    return built


def load_dataset() -> tuple[np.ndarray, np.ndarray, list[dict], int]:
    with DATA_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"No rows in {DATA_CSV} — run generate_training_data.py first.")

    adversarial = build_adversarial_rows(rows)
    all_rows = rows + adversarial

    X, y, feat_rows = [], [], []
    for row in all_rows:
        feats = extract_features(row["resume_text"], row["job_description"])
        X.append(features_to_vector(feats))
        y.append(float(row["ats_score"]))
        feat_rows.append(feats)
    return np.array(X), np.array(y), feat_rows, len(adversarial)


def main():
    print(f"Loading {DATA_CSV} ...")
    X, y, _, n_adversarial = load_dataset()
    n = len(y)
    print(
        f"Loaded {n - n_adversarial} labeled pairs + {n_adversarial} constructed "
        f"counter-examples = {n} rows, {X.shape[1]} features each."
    )

    if n < 30:
        print(f"WARNING: only {n} examples — results will be noisy regardless of CV. Consider more data.")

    # 5-fold cross-validation: every row gets exactly one out-of-fold prediction,
    # so the metrics below reflect predictions the model never trained on.
    model = GradientBoostingRegressor(
        n_estimators=150, max_depth=3, learning_rate=0.05, random_state=42
    )
    kfold = KFold(n_splits=5, shuffle=True, random_state=42)
    cv_preds = cross_val_predict(model, X, y, cv=kfold)

    mae = mean_absolute_error(y, cv_preds)
    r2 = r2_score(y, cv_preds)

    print()
    print("=== Cross-validated performance (5-fold, out-of-fold predictions) ===")
    print(f"MAE: {mae:.2f} points (average error, on the 0-100 scale)")
    print(f"R2:  {r2:.3f} (fraction of score variance explained; 1.0 = perfect, 0 = no better than the mean)")

    if mae > MAE_WARN_THRESHOLD:
        print()
        print(f"WARNING: MAE {mae:.2f} exceeds the {MAE_WARN_THRESHOLD}-point threshold.")
        print("Likely causes: dataset still small/imbalanced, or features too weak. Not auto-deploying silently —")
        print("review before wiring this into the live API.")

    # Fit the final model on ALL data (CV above was purely for the honest metric;
    # the deployed model should learn from every example we have).
    model.fit(X, y)

    print()
    print("=== Feature importances (sanity check — nothing should be wildly dominant) ===")
    importances = sorted(zip(FEATURE_NAMES, model.feature_importances_), key=lambda x: -x[1])
    for name, imp in importances:
        print(f"  {name:28s} {imp:.3f}")

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    import joblib

    joblib.dump(model, MODEL_PATH)

    metadata = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_size": n,
        "feature_names": FEATURE_NAMES,
        "model_type": "GradientBoostingRegressor",
        "cv_folds": 5,
        "mae": round(mae, 3),
        "r2": round(r2, 3),
        "mae_warn_threshold": MAE_WARN_THRESHOLD,
        "feature_importances": {name: round(float(imp), 4) for name, imp in importances},
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print()
    print(f"Saved model to {MODEL_PATH}")
    print(f"Saved metadata to {METADATA_PATH}")


if __name__ == "__main__":
    main()
