"""
Bootstraps a labeled (resume_text, job_description, ats_score) training set
for the trained ATS scoring model.

Resumes come from you (data/raw/resumes/<role>/<tier>.txt — see the
placeholder files already in that folder). Job descriptions are the
hand-authored, version-controlled set in seed_job_descriptions.py — no API
cost to produce those. Every resume is cross-paired with every job
description: an in-role pairing (Data Scientist resume x Data Scientist JD)
gives quality-tier signal, a cross-role pairing (Security Engineer resume x
Data Scientist JD) gives relevance signal for free.

Labeling reuses the existing LLM-based analyzer
(app.modules.resume_analyzer.services._llm_analysis) — the same Claude call
already used in production — rather than a second, divergent scoring path.
This is a legitimate bootstrap: the LLM's judgment becomes the label the
fast model in Phase 3 learns to approximate.

Usage:
    python scripts/generate_training_data.py            # dry run — no API calls, just a cost estimate
    python scripts/generate_training_data.py --confirm   # actually label pairs and write data/training_data.csv
    python scripts/generate_training_data.py --confirm --limit 20   # label only the first 20 pairs (smoke test)
"""

import argparse
import csv
import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.llm import llm_client  # noqa: E402
from app.modules.resume_analyzer.services import _llm_analysis  # noqa: E402
from seed_job_descriptions import SEED_JOB_DESCRIPTIONS  # noqa: E402

RESUMES_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "resumes"
LABELS_CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "labels"
GENERATED_JDS_PATH = Path(__file__).resolve().parent.parent / "data" / "raw" / "generated_jds.json"
OUTPUT_CSV = Path(__file__).resolve().parent.parent / "data" / "training_data.csv"

PLACEHOLDER_MARKER = "PLACEHOLDER — NOT YET FILLED IN"

# claude-sonnet-5 intro pricing (in effect through 2026-08-31); ~4 chars/token estimate.
PRICE_PER_1M_INPUT = 2.00
PRICE_PER_1M_OUTPUT = 10.00
EST_OUTPUT_TOKENS_PER_CALL = 500  # the analyzer's JSON response is compact


def load_resumes() -> list[dict]:
    """Reads every non-placeholder resume file under data/raw/resumes/<role>/<tier>.txt."""
    resumes = []
    skipped = []
    for role_dir in sorted(RESUMES_DIR.iterdir()):
        if not role_dir.is_dir():
            continue
        for path in sorted(role_dir.glob("*.txt")):
            text = path.read_text(encoding="utf-8")
            if PLACEHOLDER_MARKER in text or not text.strip():
                skipped.append(f"{role_dir.name}/{path.name}")
                continue
            resumes.append({"role": role_dir.name, "tier": path.stem, "text": text.strip()})
    return resumes, skipped


def build_pairs(resumes: list[dict]) -> list[dict]:
    """Full cross of every resume against every seed job description."""
    pairs = []
    for resume in resumes:
        for jd in SEED_JOB_DESCRIPTIONS:
            pairs.append(
                {
                    "resume_role": resume["role"],
                    "resume_tier": resume["tier"],
                    "resume_text": resume["text"],
                    "jd_id": jd["id"],
                    "jd_role": jd["role"],
                    "job_description": jd["text"],
                    "in_role": resume["role"] == jd["role"],
                }
            )
    return pairs


def load_generated_jds() -> list[dict]:
    """Reads the large generated JD set (generate_job_descriptions.py output)."""
    if not GENERATED_JDS_PATH.exists():
        return []
    return json.loads(GENERATED_JDS_PATH.read_text(encoding="utf-8"))


def build_sampled_pairs(resumes: list[dict], jds: list[dict], per_jd: int = 4) -> list[dict]:
    """Pairs each generated JD with a *quality-spanning* set of in-role resumes,
    rather than the full cross. The existing seed pairs already supply abundant
    low/cross-role examples; these new pairs deliberately add the high/mid
    in-role examples the dataset is short on, fixing the class imbalance."""
    by_key: dict[tuple[str, str], dict] = {(r["role"], r["tier"]): r for r in resumes}
    pairs = []
    for i, jd in enumerate(jds):
        role = jd["role"]
        # Alternate resume variants across JDs so all six in-role resumes get used.
        a, b = ("", "-b") if i % 2 == 0 else ("-b", "")
        wanted_tiers = [f"strong{a}", f"partial{b}", f"weak{a}", f"strong{b}"][:per_jd]
        for tier in wanted_tiers:
            resume = by_key.get((role, tier))
            if not resume:
                continue
            pairs.append(
                {
                    "resume_role": resume["role"],
                    "resume_tier": resume["tier"],
                    "resume_text": resume["text"],
                    "jd_id": jd["id"],
                    "jd_role": role,
                    "job_description": jd["text"],
                    "in_role": True,
                }
            )
    return pairs


def estimate_cost(pairs: list[dict]) -> tuple[int, float]:
    total_input_chars = sum(len(p["resume_text"][:8000]) + len(p["job_description"][:4000]) for p in pairs)
    est_input_tokens = total_input_chars // 4
    est_output_tokens = len(pairs) * EST_OUTPUT_TOKENS_PER_CALL
    cost = (est_input_tokens / 1_000_000) * PRICE_PER_1M_INPUT + (est_output_tokens / 1_000_000) * PRICE_PER_1M_OUTPUT
    return est_input_tokens + est_output_tokens, cost


def cache_key(resume_text: str, jd_text: str) -> str:
    return hashlib.sha256((resume_text + "||" + jd_text).encode("utf-8")).hexdigest()[:16]


def label_pair(pair: dict) -> dict:
    """Labels one pair via the production LLM analyzer, caching to disk so reruns are free."""
    key = cache_key(pair["resume_text"], pair["job_description"])
    cache_path = LABELS_CACHE_DIR / f"{key}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text(encoding="utf-8"))

    result = _llm_analysis(pair["resume_text"], pair["job_description"])
    cache_path.write_text(json.dumps(result), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="Actually call the LLM and write training_data.csv")
    parser.add_argument("--limit", type=int, default=None, help="Only label the first N pairs (smoke test)")
    parser.add_argument("--per-jd", type=int, default=4, help="In-role resumes paired with each generated JD")
    args = parser.parse_args()

    resumes, skipped = load_resumes()
    if skipped:
        print(f"Skipped {len(skipped)} unfilled placeholder resume(s):")
        for s in skipped:
            print(f"  - data/raw/resumes/{s}")
        print()

    if not resumes:
        print("No filled-in resumes found under data/raw/resumes/<role>/<tier>.txt — nothing to do.")
        print("Fill in at least one placeholder file (delete the '#'-prefixed header, paste resume text) and rerun.")
        return

    # Seed pairs: full cross of the 17 hand-authored JDs (mostly already cached).
    # Sampled pairs: each generated JD x a quality-spanning in-role resume set.
    seed_pairs = build_pairs(resumes)
    generated_jds = load_generated_jds()
    sampled_pairs = build_sampled_pairs(resumes, generated_jds, per_jd=args.per_jd)

    # Combine and de-dupe by (resume, jd) content so nothing is labeled twice.
    seen: set[str] = set()
    pairs = []
    for p in seed_pairs + sampled_pairs:
        k = cache_key(p["resume_text"], p["job_description"])
        if k in seen:
            continue
        seen.add(k)
        pairs.append(p)

    if args.limit:
        pairs = pairs[: args.limit]

    uncached_pairs = [
        p for p in pairs
        if not (LABELS_CACHE_DIR / f"{cache_key(p['resume_text'], p['job_description'])}.json").exists()
    ]
    already_cached = len(pairs) - len(uncached_pairs)
    _, est_cost = estimate_cost(uncached_pairs)
    in_role = sum(1 for p in pairs if p["in_role"])
    print(f"Resumes: {len(resumes)}  |  Seed JDs: {len(SEED_JOB_DESCRIPTIONS)}  |  Generated JDs: {len(generated_jds)}")
    print(f"Total pairs:      {len(pairs)}  ({in_role} in-role, {len(pairs) - in_role} cross-role)")
    print(f"Already cached:   {already_cached} (free)")
    print(f"New to label:     {len(uncached_pairs)}")
    print(f"Estimated cost:   ~${est_cost:.2f} for the new pairs (claude-sonnet-5 intro pricing)")
    print()

    if not args.confirm:
        print("Dry run only — no API calls made. Re-run with --confirm to actually label these pairs.")
        return

    if not llm_client.available:
        print("ANTHROPIC_API_KEY is not set in backend/.env — cannot label pairs. Set it and rerun.")
        raise SystemExit(1)

    LABELS_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    errors = 0
    for i, pair in enumerate(pairs, 1):
        try:
            label = label_pair(pair)
        except Exception as exc:  # noqa: BLE001 — keep going; report failures at the end
            errors += 1
            print(f"  [{i}/{len(pairs)}] FAILED ({pair['resume_role']}/{pair['resume_tier']} x {pair['jd_id']}): {exc}")
            time.sleep(1)
            continue
        rows.append(
            {
                "resume_text": pair["resume_text"],
                "job_description": pair["job_description"],
                "ats_score": label.get("ats_score", 0),
                "matched_skills": "; ".join(label.get("matched_skills", [])),
                "missing_skills": "; ".join(label.get("missing_skills", [])),
                "resume_role": pair["resume_role"],
                "resume_tier": pair["resume_tier"],
                "jd_id": pair["jd_id"],
            }
        )
        if i % 10 == 0 or i == len(pairs):
            print(f"  [{i}/{len(pairs)}] labeled")

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "resume_text",
                "job_description",
                "ats_score",
                "matched_skills",
                "missing_skills",
                "resume_role",
                "resume_tier",
                "jd_id",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    scores = [r["ats_score"] for r in rows]
    buckets = {"0-25": 0, "25-50": 0, "50-75": 0, "75-100": 0}
    for s in scores:
        if s < 25:
            buckets["0-25"] += 1
        elif s < 50:
            buckets["25-50"] += 1
        elif s < 75:
            buckets["50-75"] += 1
        else:
            buckets["75-100"] += 1

    print()
    print(f"Wrote {len(rows)} labeled pairs to {OUTPUT_CSV} ({errors} failed)")
    print(f"Score distribution: {buckets}")


if __name__ == "__main__":
    main()
