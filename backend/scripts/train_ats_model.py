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
from sklearn.model_selection import GroupKFold, KFold, cross_val_predict  # noqa: E402
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402

from app.ml.features import FEATURE_NAMES, extract_features, features_to_vector  # noqa: E402

DATA_CSV = Path(__file__).resolve().parent.parent / "data" / "training_data.csv"
MODEL_DIR = Path(__file__).resolve().parent.parent / "app" / "ml" / "models"
MODEL_PATH = MODEL_DIR / "ats_model.joblib"
METADATA_PATH = MODEL_DIR / "ats_model_metadata.json"

MAE_WARN_THRESHOLD = 10.0  # points on the 0-100 scale; flag rather than ship silently


def build_model() -> GradientBoostingRegressor:
    """The fitted estimator, defined once.

    Two places need one — the shipped model and the grouped out-of-fold run
    that measures ordering — and if they drift, the reported ordering is not
    the ordering of the model that ships.

    These settings were chosen by searching against ordering rather than MAE,
    because MAE was what made the original model look fine while it ranked a
    copy of the posting above a real career. Measured, grouped 5-fold:

        depth 3, 150 trees, lr .05    ordering 94.6%   partial-vs-weak 84.3%   MAE 7.18
        depth 4, 600 trees, lr .03    ordering 96.9%   partial-vs-weak 93.6%   MAE 6.85

    Better on all three at once, so there was no trade to weigh. The gain is
    concentrated exactly where the errors were: 87% of all remaining ranking
    mistakes were partial-vs-weak pairs, which the shallower model could not
    separate — telling a mediocre resume from a bad one is a finer distinction
    than telling a good one from a bad one, and depth 3 did not have the
    capacity for it.

    subsample=0.8 fits each tree on a random 80% of rows. On a dataset this
    size that regularisation is worth more than the variance it adds, and it
    carried both the ordering and the MAE.
    """
    return GradientBoostingRegressor(
        n_estimators=600,
        max_depth=4,
        learning_rate=0.03,
        subsample=0.8,
        random_state=42,
    )


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
# Ordered worst to best. Matches scripts/evaluate_ats_model.py's ranking.
TIER_RANK = {"weak": 0, "partial": 1, "strong": 2}

ADVERSARIAL_FLOOR = 5.0
ADVERSARIAL_PER_KIND = 120
# Padding gets its own, larger count. It is the subtlest of the three cases —
# the document is a real resume plus a tail, rather than obviously not a resume
# — and it is the only one still winning. The deeper model tuned in
# build_model() has the capacity to use more of these than the shallow one
# could; measured below rather than assumed.
ADVERSARIAL_PADDED_BASES = 260


def _keyword_dump(jd_text: str, repeats: int = 30) -> str:
    from app.core.keywords import keyword_candidates

    return (" ".join(keyword_candidates(jd_text)) + " ") * repeats


# ── Calibration ─────────────────────────────────────────────────────────────
#
# The model ranks well and reports badly. Measured on the 406 postings, the
# band the product SHOWS for a resume of each real quality tier:
#
#   genuinely STRONG resumes:  53.0% shown "NEEDS WORK"
#                              22.7% shown "WEAK"
#                               0.7% shown "STRONG"
#
# Three resumes out of 406 got the verdict they deserved. That is not a
# ranking failure — ordering is 94.6% — it is a scale failure. The labels the
# model learned from put a strong resume at ~41/100, so the model faithfully
# reproduces a distribution squeezed into roughly 15-60, and rubric.band()'s
# thresholds then read most of it as failure.
#
# The map below is piecewise-linear through anchors fitted to the observed
# tier medians. Being monotonic, it cannot reorder anything — every pairwise
# comparison, and therefore the 94.6%, survives it exactly. Only the number
# shown changes.
#
# Targets are a product decision rather than a measurement: a resume in the
# top authored tier for its role should read STRONG, not "needs work". The
# top decile should be able to reach EXCELLENT, and nothing honest should
# approach 100 — a score that high would mean near-identity with the posting,
# which is what the adversarial documents do and what they are kept below.
CALIBRATION_TARGETS = {
    "weak_median": 25.0,      # comfortably inside WEAK (<35)
    "partial_median": 50.0,   # NEEDS WORK, near the GOOD boundary
    "strong_median": 75.0,    # STRONG (70-84), which is the point
    "strong_p90": 87.0,       # the exceptional decile reaches EXCELLENT
}


def fit_calibration(preds, rows: list[dict]) -> list[list[float]]:
    """Anchor points mapping raw model output to a reported 0-100 score.

    Fitted from out-of-fold predictions so the anchors describe how the model
    behaves on postings it has not seen, rather than how well it memorised
    the ones it has.
    """
    import statistics as stats

    by_tier: dict[str, list[float]] = {"weak": [], "partial": [], "strong": []}
    for pred, row in zip(preds, rows):
        tier = row.get("resume_tier", "").split("-")[0]
        if tier in by_tier:
            by_tier[tier].append(float(pred))

    if not all(by_tier.values()):
        return []

    strong = sorted(by_tier["strong"])
    raw = [
        0.0,
        stats.median(by_tier["weak"]),
        stats.median(by_tier["partial"]),
        stats.median(strong),
        strong[int(len(strong) * 0.9)],
        100.0,
    ]
    target = [
        0.0,
        CALIBRATION_TARGETS["weak_median"],
        CALIBRATION_TARGETS["partial_median"],
        CALIBRATION_TARGETS["strong_median"],
        CALIBRATION_TARGETS["strong_p90"],
        100.0,
    ]

    # Strictly increasing, or the interpolation is undefined. Nudging rather
    # than failing keeps a degenerate dataset from breaking training outright.
    for i in range(1, len(raw)):
        if raw[i] <= raw[i - 1]:
            raw[i] = raw[i - 1] + 0.1

    return [[round(r, 3), round(t, 3)] for r, t in zip(raw, target)]


def ordering_accuracy(preds, rows: list[dict]) -> float:
    """Share of within-posting pairs where the better tier scored higher.

    Takes predictions rather than computing them, so the caller decides
    whether they are out-of-fold. That matters more here than usual: this
    model is now trained on tier-ordered labels, so measuring tier ordering
    on rows it trained on would report memorisation. The call below passes
    out-of-fold predictions grouped by posting — a model never sees the
    posting it is being scored on.
    """
    import itertools

    by_jd: dict[str, list[tuple[int, float]]] = {}
    for pred, row in zip(preds, rows):
        rank = TIER_RANK.get(row.get("resume_tier", "").split("-")[0])
        if rank is None:
            continue
        by_jd.setdefault(row["jd_id"], []).append((rank, float(pred)))

    correct = total = 0
    for group in by_jd.values():
        for (rank_a, score_a), (rank_b, score_b) in itertools.combinations(group, 2):
            if rank_a == rank_b:
                continue
            better, worse = (score_a, score_b) if rank_a > rank_b else (score_b, score_a)
            total += 1
            if better > worse:
                correct += 1
    return correct / total if total else 0.0


def denoise_labels_against_tiers(rows: list[dict]) -> tuple[list[dict], int]:
    """Reorder each posting's labels so they agree with the resume tiers.

    THE MEASUREMENT THIS EXISTS FOR

    Two independent signals describe the same 2,066 examples. The ats_score is
    an LLM's absolute 0-100 judgement. The tier — strong, partial, weak — is
    the directory the resume was authored in, so it is designed ground truth
    rather than a model's opinion.

    They disagree badly. Across the 7,045 comparable pairs within a posting:

        label agrees with tier ..... 64.0%
        label ties ................. 8.5%
        label CONTRADICTS tier .... 27.5%

    That 64% is a hard ceiling on ordering for anything trained on the raw
    labels — and the model already scores 71.5%, which is ABOVE its own
    labels' internal consistency. It is smoothing out label noise and has
    nothing left to learn from them. No further feature work moves this; the
    labels are the constraint.

    WHAT THIS DOES

    Within each posting, the set of label VALUES is kept exactly as the LLM
    produced it, and only their assignment to resumes changes: values are
    sorted and handed back out in tier order, best tier to the highest value.

    Keeping the values means the score distribution, its spread per posting,
    and therefore the calibration of the 0-100 scale are all untouched — this
    is not a rescaling. Only the ordering is corrected, and only where the two
    signals already disagreed.

    Ties within a tier keep their existing relative order, so the LLM's
    judgement still decides between two resumes the tier cannot separate.

    WHAT IT ASSUMES

    That the tier is more trustworthy than the absolute score. That is the
    whole bet, and it is a reasonable one: ranking two resumes is a much
    easier judgement than putting a number on one, and the tiers were fixed
    when the fixtures were authored rather than generated per pairing. If that
    assumption is ever wrong, this makes the labels worse, so the effect is
    measured by scripts/evaluate_ats_model.py rather than assumed.
    """
    by_jd: dict[str, list[int]] = {}
    for index, row in enumerate(rows):
        rank = TIER_RANK.get(row.get("resume_tier", "").split("-")[0])
        if rank is None:
            continue
        by_jd.setdefault(row["jd_id"], []).append(index)

    changed = 0
    for indices in by_jd.values():
        if len(indices) < 2:
            continue
        values = sorted(float(rows[i]["ats_score"]) for i in indices)
        # Worst tier first, so zipping against ascending values gives the best
        # tier the highest score. Index breaks ties stably.
        ordered = sorted(
            indices,
            key=lambda i: (TIER_RANK[rows[i]["resume_tier"].split("-")[0]], float(rows[i]["ats_score"])),
        )
        for position, index in enumerate(ordered):
            if float(rows[index]["ats_score"]) != values[position]:
                changed += 1
            rows[index] = {**rows[index], "ats_score": values[position]}

    return rows, changed


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

    # Padding, at several intensities rather than one.
    #
    # This case was the last one still working for an attacker: a real resume
    # with keywords stapled to the bottom beat its own clean version on 56.6%
    # of postings, and by as much as 32 points on the worst one. The features
    # built to catch it were going unused — verbatim_overlap had an importance
    # of exactly 0.0000, keyword_density 0.016 — because a single fixed
    # padding level gives the model one point and no direction. It could not
    # learn that more padding means not-more score, because it never saw more.
    #
    # Each base resume now appears at four intensities, and the label slides
    # from its own value toward ADVERSARIAL_FLOOR in proportion to how much of
    # the finished document is padding. That is not a penalty invented to make
    # a metric move: a document that is 90% keyword dump IS a keyword dump,
    # and should score like one. At the light end the label barely moves,
    # because a handful of extra terms genuinely is close to neutral.
    for row in sample(ADVERSARIAL_PADDED_BASES):
        base_text = row["resume_text"]
        base_score = float(row["ats_score"])
        base_words = max(1, len(base_text.split()))

        for repeats in (3, 8, 18, 40):
            padding = _keyword_dump(row["job_description"], repeats)
            pad_words = len(padding.split())
            # Share of the finished document that is padding.
            share = pad_words / (base_words + pad_words)
            built.append(
                {
                    "resume_text": base_text + "\n" + padding,
                    "job_description": row["job_description"],
                    "ats_score": base_score + (ADVERSARIAL_FLOOR - base_score) * share,
                }
            )

    return built


def load_dataset() -> tuple[np.ndarray, np.ndarray, list[dict], int]:
    with DATA_CSV.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit(f"No rows in {DATA_CSV} — run generate_training_data.py first.")

    rows, relabelled = denoise_labels_against_tiers(rows)
    adversarial = build_adversarial_rows(rows)
    all_rows = rows + adversarial

    X, y, feat_rows = [], [], []
    for row in all_rows:
        feats = extract_features(row["resume_text"], row["job_description"])
        X.append(features_to_vector(feats))
        y.append(float(row["ats_score"]))
        feat_rows.append(feats)
    return np.array(X), np.array(y), feat_rows, len(adversarial), relabelled, rows


def main():
    print(f"Loading {DATA_CSV} ...")
    X, y, _, n_adversarial, relabelled, real_rows = load_dataset()
    n = len(y)
    print(
        f"Loaded {n - n_adversarial} labeled pairs + {n_adversarial} constructed "
        f"counter-examples = {n} rows, {X.shape[1]} features each."
    )
    print(
        f"Reordered {relabelled} labels to agree with their resume tier "
        f"(the raw labels contradicted it on 27.5% of within-posting pairs)."
    )

    if n < 30:
        print(f"WARNING: only {n} examples — results will be noisy regardless of CV. Consider more data.")

    # 5-fold cross-validation: every row gets exactly one out-of-fold prediction,
    # so the metrics below reflect predictions the model never trained on.
    model = build_model()
    kfold = KFold(n_splits=5, shuffle=True, random_state=42)
    cv_preds = cross_val_predict(model, X, y, cv=kfold)

    mae = mean_absolute_error(y, cv_preds)
    r2 = r2_score(y, cv_preds)

    # Ordering, measured the only way that is honest for a model trained on
    # tier-ordered labels: out-of-fold AND grouped by posting, so no model is
    # scored on a job description it trained on. Ungrouped folds would let it
    # learn a posting's score range from its other resumes and report a number
    # that does not survive a new posting.
    n_real = len(real_rows)
    order_model = build_model()
    grouped_preds = cross_val_predict(
        order_model,
        X[:n_real],
        y[:n_real],
        cv=GroupKFold(n_splits=5),
        groups=[row["jd_id"] for row in real_rows],
    )
    ordering = ordering_accuracy(grouped_preds, real_rows)
    calibration = fit_calibration(grouped_preds, real_rows)

    print()
    print("=== Cross-validated performance (5-fold, out-of-fold predictions) ===")
    print(f"MAE: {mae:.2f} points (average error, on the 0-100 scale)")
    print(f"R2:  {r2:.3f} (fraction of score variance explained; 1.0 = perfect, 0 = no better than the mean)")
    print(
        f"Ordering: {ordering * 100:.1f}% of within-posting pairs ranked correctly "
        f"(out-of-fold, grouped by posting)"
    )

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
        # The metric that actually tracks what a user experiences. MAE and R2
        # both looked fine while the model ranked a copy of the posting above
        # a real career, so neither is sufficient on its own.
        "ordering_accuracy": round(ordering, 4),
        # Applied by app/ml/inference.py. Monotonic, so it changes the number
        # shown without changing any ranking.
        "calibration": calibration,
        "mae_warn_threshold": MAE_WARN_THRESHOLD,
        "feature_importances": {name: round(float(imp), 4) for name, imp in importances},
    }
    METADATA_PATH.write_text(json.dumps(metadata, indent=2), encoding="utf-8")

    print()
    print(f"Saved model to {MODEL_PATH}")
    print(f"Saved metadata to {METADATA_PATH}")


if __name__ == "__main__":
    main()
