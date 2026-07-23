"""
Generates a large, diverse set of job descriptions for ATS-model training.

The 17 hand-authored JDs in seed_job_descriptions.py are great but too few for
the model to generalize across real-world posting variety. This script expands
to ~500 by asking Claude for JDs across every combination of role x seniority x
industry x company-stage, batched (5 per call) and cached to disk so reruns are
free.

Output: data/raw/generated_jds.json — a list of {id, role, seniority, industry,
company_stage, text}. Consumed by generate_training_data.py.

Usage:
    python scripts/generate_job_descriptions.py            # dry run — cost estimate, no API calls
    python scripts/generate_job_descriptions.py --confirm   # generate for real
    python scripts/generate_job_descriptions.py --per-role 100 --confirm
"""

import argparse
import itertools
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.llm import llm_client  # noqa: E402

CACHE_DIR = Path(__file__).resolve().parent.parent / "data" / "raw" / "jd_cache"
OUTPUT_JSON = Path(__file__).resolve().parent.parent / "data" / "raw" / "generated_jds.json"

ROLES = {
    "data-scientist": "Data Scientist",
    "ml-engineer": "ML Engineer",
    "ai-engineer": "AI Engineer",
    "backend-engineer": "Backend Engineer",
    "security-engineer": "Security Engineer",
}

SENIORITIES = ["junior", "mid-level", "senior", "staff", "lead"]
INDUSTRIES = [
    "fintech", "healthcare", "e-commerce", "gaming", "adtech",
    "logistics", "edtech", "cybersecurity", "social media", "enterprise SaaS",
]
COMPANY_STAGES = ["an early-stage startup", "a public enterprise"]

SYSTEM_PROMPT = (
    "You write realistic, specific job descriptions of the kind companies actually post. "
    "Each names concrete required skills, tools, and responsibilities for the role, seniority, "
    "and industry given — not generic filler. Vary structure and phrasing so they don't read as "
    "templated."
)

BATCH_SCHEMA = {
    "type": "object",
    "properties": {
        "job_descriptions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "seniority": {"type": "string"},
                    "industry": {"type": "string"},
                    "text": {"type": "string", "description": "The full JD, 120-200 words, plain text"},
                },
                "required": ["seniority", "industry", "text"],
            },
        },
    },
    "required": ["job_descriptions"],
}

BATCH_SIZE = 5

# claude-sonnet-5 intro pricing (through 2026-08-31); ~4 chars/token.
PRICE_PER_1M_INPUT = 2.00
PRICE_PER_1M_OUTPUT = 10.00
EST_INPUT_TOKENS_PER_CALL = 350
EST_OUTPUT_TOKENS_PER_CALL = 1100  # 5 JDs x ~160 words


def build_combos(per_role: int) -> dict[str, list[tuple[str, str, str]]]:
    """For each role, a deterministic spread of (seniority, industry, stage) combos."""
    all_combos = list(itertools.product(SENIORITIES, INDUSTRIES, COMPANY_STAGES))  # 100 per role
    return {role: all_combos[:per_role] for role in ROLES}


def build_prompt(role_label: str, combos: list[tuple[str, str, str]]) -> str:
    lines = [
        f"Write {len(combos)} distinct job descriptions for {role_label} roles. "
        "Each must match its specified seniority, industry, and company stage:\n"
    ]
    for i, (sen, ind, stage) in enumerate(combos, 1):
        lines.append(f"{i}. {sen} level, {ind} industry, at {stage}")
    lines.append(
        "\nEach JD: 120-200 words, naming concrete skills/tools/responsibilities appropriate to "
        "that specific role, seniority, and industry. Plain text, no markdown."
    )
    return "\n".join(lines)


def estimate_cost(num_calls: int) -> float:
    inp = num_calls * EST_INPUT_TOKENS_PER_CALL
    out = num_calls * EST_OUTPUT_TOKENS_PER_CALL
    return (inp / 1_000_000) * PRICE_PER_1M_INPUT + (out / 1_000_000) * PRICE_PER_1M_OUTPUT


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="Actually call the LLM")
    parser.add_argument("--per-role", type=int, default=100, help="JDs to generate per role (max 100)")
    args = parser.parse_args()

    per_role = min(args.per_role, len(SENIORITIES) * len(INDUSTRIES) * len(COMPANY_STAGES))
    combos_by_role = build_combos(per_role)

    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    # Work out which batches still need generating (cache key = role + batch index).
    pending = []
    for role, combos in combos_by_role.items():
        for b in range(0, len(combos), BATCH_SIZE):
            cache_path = CACHE_DIR / f"{role}_{b // BATCH_SIZE:03d}.json"
            if not cache_path.exists():
                pending.append((role, b, combos[b : b + BATCH_SIZE], cache_path))

    total_target = per_role * len(ROLES)
    print(f"Target: {per_role} JDs/role x {len(ROLES)} roles = {total_target} JDs")
    print(f"Batches to generate: {len(pending)} (of {total_target // BATCH_SIZE} total; rest cached)")
    print(f"Estimated cost: ~${estimate_cost(len(pending)):.2f} (claude-sonnet-5 intro pricing)")
    print()

    if not args.confirm:
        print("Dry run only — no API calls. Re-run with --confirm to generate.")
        return

    if not llm_client.available:
        print("ANTHROPIC_API_KEY is not set in backend/.env — cannot generate.")
        raise SystemExit(1)

    for idx, (role, b, combos, cache_path) in enumerate(pending, 1):
        data = llm_client.complete_tool_json(
            SYSTEM_PROMPT, build_prompt(ROLES[role], combos), "submit_jds", BATCH_SCHEMA, max_tokens=2500
        )
        cache_path.write_text(json.dumps(data), encoding="utf-8")
        if idx % 10 == 0 or idx == len(pending):
            print(f"  [{idx}/{len(pending)}] batches generated")

    # Assemble all cached batches into the final JD list.
    jds = []
    for role, combos in combos_by_role.items():
        for b in range(0, len(combos), BATCH_SIZE):
            cache_path = CACHE_DIR / f"{role}_{b // BATCH_SIZE:03d}.json"
            if not cache_path.exists():
                continue
            batch = json.loads(cache_path.read_text(encoding="utf-8")).get("job_descriptions", [])
            for j, item in enumerate(batch):
                text = (item.get("text") or "").strip()
                if not text:
                    continue
                jds.append(
                    {
                        "id": f"{role}-gen-{b + j:03d}",
                        "role": role,
                        "seniority": item.get("seniority", ""),
                        "industry": item.get("industry", ""),
                        "text": text,
                    }
                )

    OUTPUT_JSON.write_text(json.dumps(jds, indent=2), encoding="utf-8")
    print()
    print(f"Wrote {len(jds)} job descriptions to {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
