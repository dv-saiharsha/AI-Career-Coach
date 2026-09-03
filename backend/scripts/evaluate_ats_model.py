"""Evaluate the ATS model on the things a score is actually supposed to do.

WHY THIS EXISTS

train_ats_model.py reports MAE and R2 against the LLM-generated labels. Both
were good — MAE 7.3, R2 0.72 — while the model did this:

    real resume, real quantified achievements ....... 49
    keyword dump, zero experience .................. 86
    the job description pasted back verbatim ....... 88

MAE cannot see that. It measures agreement with labels drawn from the same
distribution the model trained on, and none of those labels was an adversarial
document, so nothing in the metric ever asked whether a resume that copies the
posting outranks a resume that describes real work.

A model can improve its MAE while getting worse at the only question a user
cares about. So this script measures three things instead of one:

  ACCURACY      MAE and R2, unchanged, so the existing number stays comparable.

  ORDERING      Within a single job description, does the model rank a strong
                resume above a partial one, and a partial above a weak one?
                The tier labels come from the directory the resume was
                authored in (data/raw/resumes/<role>/<tier>.txt), so they are
                ground truth that is independent of the LLM's score. This is
                the closest thing here to "is the ranking right", which is
                what a candidate comparing two versions of their CV actually
                experiences.

  ADVERSARIAL   Does a document that games the score beat one that earns it?
                Constructed, not sampled — a JD pasted back, a keyword dump,
                and a real resume padded with keywords. Each is compared
                against a genuine strong resume for the same posting. Every
                one of these is a pass/fail with a knowable right answer that
                needs no labelling.

Run it before and after any change to the features or the training set. A
change that improves MAE and loses adversarial cases is a regression, however
the headline number moves.
"""

import csv
import json
import re
import statistics
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Windows consoles default to cp1252, which cannot encode the box-drawing and
# arrow characters this report prints. Telling stdout what encoding it is
# actually emitting fixes every such character at once, rather than removing
# them one at a time until the next one is added.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import numpy as np  # noqa: E402
from sklearn.metrics import mean_absolute_error, r2_score  # noqa: E402

from app.ml.features import extract_features  # noqa: E402

DATA_PATH = ROOT / "data" / "training_data.csv"
MODEL_PATH = ROOT / "app" / "ml" / "models" / "ats_model.joblib"

# Tier names in the dataset carry a -b suffix for the second pairing of the
# same role, which is a pairing detail rather than a quality difference.
TIER_RANK = {"weak": 0, "partial": 1, "strong": 2}


def tier_rank(tier: str) -> int | None:
    return TIER_RANK.get(tier.split("-")[0])


def load_rows() -> list[dict]:
    if not DATA_PATH.exists():
        sys.exit(f"No dataset at {DATA_PATH}. See the README's ATS model section.")
    with DATA_PATH.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def predict(model, resume: str, jd: str) -> float:
    from app.ml.features import FEATURE_NAMES

    feats = extract_features(resume, jd)
    row = np.array([[feats[name] for name in FEATURE_NAMES]])
    return float(model.predict(row)[0])


# ── the three measurements ──────────────────────────────────────────────────


def measure_accuracy(model, rows: list[dict]) -> dict:
    """MAE and R2 against the stored labels — the existing headline numbers."""
    from app.ml.features import FEATURE_NAMES

    X, y = [], []
    for row in rows:
        feats = extract_features(row["resume_text"], row["job_description"])
        X.append([feats[name] for name in FEATURE_NAMES])
        y.append(float(row["ats_score"]))
    preds = model.predict(np.array(X))
    return {
        "mae": round(float(mean_absolute_error(y, preds)), 3),
        "r2": round(float(r2_score(y, preds)), 3),
    }


def measure_ordering(model, rows: list[dict]) -> dict:
    """Within one JD, is a better resume scored higher than a worse one?

    Counted over every comparable pair rather than as a correlation, because
    the question a user has is pairwise: is my improved version scored above
    my old one. Ties count as failures — a model that cannot separate a strong
    resume from a weak one has not ranked them.
    """
    by_jd: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        rank = tier_rank(row.get("resume_tier", ""))
        if rank is None:
            continue
        by_jd[row["jd_id"]].append({"rank": rank, "row": row})

    correct = tied = wrong = 0
    for group in by_jd.values():
        scored = [
            {"rank": item["rank"], "score": predict(model, item["row"]["resume_text"], item["row"]["job_description"])}
            for item in group
        ]
        for i, a in enumerate(scored):
            for b in scored[i + 1 :]:
                if a["rank"] == b["rank"]:
                    continue
                better, worse = (a, b) if a["rank"] > b["rank"] else (b, a)
                if better["score"] > worse["score"]:
                    correct += 1
                elif better["score"] == worse["score"]:
                    tied += 1
                else:
                    wrong += 1

    total = correct + tied + wrong
    return {
        "pairs": total,
        "correct": correct,
        "tied": tied,
        "wrong": wrong,
        "accuracy": round(correct / total, 4) if total else 0.0,
    }


def _keyword_dump(jd: str, repeats: int = 30) -> str:
    """Every distinctive term in the posting, repeated. No experience at all."""
    from app.core.keywords import keyword_candidates

    terms = keyword_candidates(jd)
    return (" ".join(terms) + " ") * repeats


def measure_adversarial(model, rows: list[dict]) -> dict:
    """Does a document that games the score beat one that earns it?

    Every case is scored against a real strong resume for the same posting, so
    the comparison is like-for-like rather than against an absolute threshold
    nobody agreed on.
    """
    strong_by_jd = {}
    for row in rows:
        if tier_rank(row.get("resume_tier", "")) == 2 and row["jd_id"] not in strong_by_jd:
            strong_by_jd[row["jd_id"]] = row

    cases = {
        "jd_pasted_back": lambda jd, resume: jd * 8,
        "keyword_dump": lambda jd, resume: _keyword_dump(jd),
        "real_resume_padded": lambda jd, resume: resume + "\n" + _keyword_dump(jd, repeats=12),
    }

    results: dict[str, dict] = {}
    for name, build in cases.items():
        beat_real = 0
        margins: list[float] = []
        for row in strong_by_jd.values():
            jd, resume = row["job_description"], row["resume_text"]
            honest = predict(model, resume, jd)
            gamed = predict(model, build(jd, resume), jd)
            margins.append(gamed - honest)
            if gamed >= honest:
                beat_real += 1
        total = len(strong_by_jd)
        results[name] = {
            "postings": total,
            "gamed_beat_real": beat_real,
            "beat_rate": round(beat_real / total, 4) if total else 0.0,
            "mean_margin": round(statistics.mean(margins), 2) if margins else 0.0,
            "worst_margin": round(max(margins), 2) if margins else 0.0,
        }

    # The other half of the same problem: does describing real work honestly
    # cost the candidate points?
    #
    # Split in two, because collapsing them was misleading. Appending yet more
    # figures to a resume that is already full of them is diminishing returns
    # and should barely move the score. Turning unquantified bullets INTO
    # quantified ones is the advice every resume guide gives, and is the case
    # that has to be rewarded. An earlier version of this script measured only
    # the first and reported "costs points on 85% of postings" — which read as
    # though the second was broken too, and it is not.
    extra = (
        "\n- Reduced p99 latency 34% by moving the hot path to Go"
        "\n- Migrated 12 services, cutting deploy time from 40 to 8 minutes"
        "\n- Built a pipeline handling 500k transactions daily"
    )

    appended = []
    for row in list(strong_by_jd.values())[:60]:
        jd, resume = row["job_description"], row["resume_text"]
        appended.append(predict(model, resume + extra, jd) - predict(model, resume, jd))

    results["appending_more_metrics"] = {
        "samples": len(appended),
        "mean_delta": round(statistics.mean(appended), 2) if appended else 0.0,
        "penalised_rate": round(sum(1 for d in appended if d < 0) / len(appended), 4)
        if appended
        else 0.0,
    }

    # The same resume with and without its figures. Only the quantification
    # differs, so the delta is attributable to it rather than to length.
    quantifying = []
    for row in list(strong_by_jd.values())[:60]:
        jd, resume = row["job_description"], row["resume_text"]
        stripped = re.sub(r"\b\d[\d,.]*\s*%?", "", resume)
        quantifying.append(predict(model, resume, jd) - predict(model, stripped, jd))

    results["quantifying_unquantified"] = {
        "samples": len(quantifying),
        "mean_delta": round(statistics.mean(quantifying), 2) if quantifying else 0.0,
        "rewarded_rate": round(sum(1 for d in quantifying if d > 0) / len(quantifying), 4)
        if quantifying
        else 0.0,
    }
    return results


def main() -> None:
    import joblib

    if not MODEL_PATH.exists():
        sys.exit(f"No model at {MODEL_PATH}. Run scripts/train_ats_model.py first.")

    model = joblib.load(MODEL_PATH)
    rows = load_rows()
    print(f"Evaluating on {len(rows)} examples.\n")

    accuracy = measure_accuracy(model, rows)
    print("\n── ACCURACY (vs the LLM labels) ─────────────────────────────")
    print(f"  MAE {accuracy['mae']} points     R2 {accuracy['r2']}")

    ordering = measure_ordering(model, rows)
    print("\n── ORDERING (strong > partial > weak, within a posting) ──────")
    print(
        f"  {ordering['accuracy'] * 100:.1f}% of {ordering['pairs']} pairs ranked correctly"
        f"   ({ordering['wrong']} wrong, {ordering['tied']} tied)"
    )

    adversarial = measure_adversarial(model, rows)
    print("\n── ADVERSARIAL (does gaming beat earning?) ──────────────────")
    for name in ("jd_pasted_back", "keyword_dump", "real_resume_padded"):
        r = adversarial[name]
        print(
            f"  {name:20} beats a real strong resume on "
            f"{r['beat_rate'] * 100:5.1f}% of postings"
            f"   (mean {r['mean_margin']:+.1f}, worst {r['worst_margin']:+.1f})"
        )
    a = adversarial["appending_more_metrics"]
    print(
        f"  {'appending more':20} to an already-quantified resume: "
        f"{a['penalised_rate'] * 100:5.1f}% penalised  (mean {a['mean_delta']:+.1f})"
    )
    q = adversarial["quantifying_unquantified"]
    print(
        f"  {'quantifying bullets':20} that carried no figures:        "
        f"{q['rewarded_rate'] * 100:5.1f}% rewarded   (mean {q['mean_delta']:+.1f})"
    )

    report = {"accuracy": accuracy, "ordering": ordering, "adversarial": adversarial}
    out = ROOT / "data" / "ats_evaluation.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nWritten to {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
