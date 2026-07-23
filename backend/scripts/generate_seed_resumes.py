"""
Generates the 15 seed resumes (5 roles x 3 quality tiers) used by
generate_training_data.py, via the same Claude client the app already uses
(app.core.llm.llm_client). Batched one call per role (3 resumes per call)
rather than 15 separate calls, and cached to data/raw/generated_resumes_cache/
so a rerun costs nothing once a role's resumes exist.

Usage:
    python scripts/generate_seed_resumes.py            # dry run — reports what would be generated, no API calls
    python scripts/generate_seed_resumes.py --confirm   # actually calls the LLM and writes the resume files
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.llm import llm_client  # noqa: E402
from seed_job_descriptions import SEED_JOB_DESCRIPTIONS  # noqa: E402

RESUME_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "strong": {"type": "string"},
        "partial": {"type": "string"},
        "weak": {"type": "string"},
    },
    "required": ["strong", "partial", "weak"],
}

RESUMES_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "resumes"
CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "generated_resumes_cache"

ROLES = ["data-scientist", "ml-engineer", "ai-engineer", "backend-engineer", "security-engineer"]
ROLE_LABELS = {
    "data-scientist": "Data Scientist",
    "ml-engineer": "ML Engineer",
    "ai-engineer": "AI Engineer",
    "backend-engineer": "Backend Engineer",
    "security-engineer": "Security Engineer",
}

SYSTEM_PROMPT = (
    "You generate realistic, varied synthetic resumes for testing an ATS (applicant tracking "
    "system) scoring pipeline. Each resume must read like a real candidate's resume — a fictional "
    "name, a short summary line, an experience section with company names, dates, and bullet points "
    "(some quantified), a skills section, and an education line. Vary phrasing and structure across "
    "the three tiers so they don't read as templated. Always respond with a single JSON object and "
    "nothing else — no markdown fences, no prose."
)

# Estimated cost, shown before any call: ~5 calls (one per role), each ~600 input + ~1800 output tokens.
EST_CALLS = len(ROLES)
EST_INPUT_TOKENS_PER_CALL = 700
EST_OUTPUT_TOKENS_PER_CALL = 1800
PRICE_PER_1M_INPUT = 2.00
PRICE_PER_1M_OUTPUT = 10.00


def build_prompt(role: str, variant: str = "") -> str:
    label = ROLE_LABELS[role]
    anchor_jd = next(jd for jd in SEED_JOB_DESCRIPTIONS if jd["id"] == f"{role}-mid")
    # A second batch should not read like the first — different people,
    # backgrounds, and phrasing so the model sees genuine variety, not near-copies.
    diversity_note = (
        "IMPORTANT: make these candidates distinctly different from any typical "
        "template — vary the names, years of experience, industries, company types "
        "(startup vs enterprise), education paths, and resume structure/formatting "
        "so they read as genuinely different real people.\n\n"
        if variant
        else ""
    )
    return (
        f"Generate three resumes for a candidate applying to {label} roles, calibrated against this "
        f"job description as the reference point for what a strong match looks like:\n\n"
        f"{anchor_jd['text']}\n\n"
        f"{diversity_note}"
        "Produce exactly three resumes:\n"
        '- "strong": clearly matches the job description — has the specific skills and technologies '
        "it names, plausible relevant years of experience, quantified achievements.\n"
        '- "partial": a real but incomplete match — has some of the required skills, missing a few key '
        "ones, or comes from adjacent experience (e.g. slightly junior for the role, or from a related "
        "specialization).\n"
        '- "weak": a plausible resume for someone in tech, but a poor fit for this specific role — '
        "different specialization or clearly underqualified. Still a coherent, real-sounding resume, "
        "not gibberish.\n\n"
        "Respond with JSON: {\"strong\": \"<full resume text>\", \"partial\": \"<full resume text>\", "
        '"weak": "<full resume text>"}. Each resume 250-450 words, plain text (no markdown formatting).'
    )


def estimate_cost() -> float:
    input_tokens = EST_CALLS * EST_INPUT_TOKENS_PER_CALL
    output_tokens = EST_CALLS * EST_OUTPUT_TOKENS_PER_CALL
    return (input_tokens / 1_000_000) * PRICE_PER_1M_INPUT + (output_tokens / 1_000_000) * PRICE_PER_1M_OUTPUT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="Actually call the LLM and write resume files")
    parser.add_argument(
        "--variant",
        default="",
        help="Batch suffix (e.g. 'b'). Generates a second, distinct set written as "
        "<tier>-<variant>.txt so it doesn't overwrite the original batch.",
    )
    args = parser.parse_args()
    variant = args.variant.strip().lower()
    suffix = f"-{variant}" if variant else ""

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    to_generate = [r for r in ROLES if not (CACHE_DIR / f"{r}{suffix}.json").exists()]
    cached = [r for r in ROLES if r not in to_generate]

    label = f"batch '{variant}'" if variant else "batch (original)"
    print(f"Generating {label} — output files: data/raw/resumes/<role>/<tier>{suffix}.txt")
    print(f"Roles to generate: {len(to_generate)} ({', '.join(to_generate) or 'none'})")
    if cached:
        print(f"Already cached (free, reused): {', '.join(cached)}")
    print(f"Estimated cost for {len(to_generate)} call(s): ~${estimate_cost() * len(to_generate) / max(EST_CALLS, 1):.2f}")
    print()

    if not args.confirm:
        print("Dry run only — no API calls made. Re-run with --confirm to actually generate.")
        return

    if not llm_client.available:
        print("ANTHROPIC_API_KEY is not set in backend/.env — cannot generate. Set it and rerun.")
        raise SystemExit(1)

    for role in to_generate:
        print(f"Generating resumes for {ROLE_LABELS[role]}...")
        data = llm_client.complete_tool_json(
            SYSTEM_PROMPT, build_prompt(role, variant), "submit_resumes", RESUME_TOOL_SCHEMA, max_tokens=3500
        )
        (CACHE_DIR / f"{role}{suffix}.json").write_text(json.dumps(data), encoding="utf-8")

    written = 0
    for role in ROLES:
        data = json.loads((CACHE_DIR / f"{role}{suffix}.json").read_text(encoding="utf-8"))
        for tier in ("strong", "partial", "weak"):
            text = data.get(tier, "").strip()
            if not text:
                print(f"  WARNING: {role}/{tier}{suffix} came back empty, leaving placeholder in place")
                continue
            (RESUMES_DIR / role / f"{tier}{suffix}.txt").write_text(text, encoding="utf-8")
            written += 1

    print()
    print(f"Wrote {written} resume files to data/raw/resumes/<role>/<tier>{suffix}.txt")


if __name__ == "__main__":
    main()
