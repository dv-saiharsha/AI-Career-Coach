"""Run one ingestion sweep.

Dry by default. A live sweep spends real Apify credit and real Anthropic
tokens, so it requires --confirm rather than a flag someone might set by
habit; --dry-run prints what it would cost without issuing a request.

    python scripts/sweep_jobs.py               # dry run, spends nothing
    python scripts/sweep_jobs.py --confirm     # live: ~$2.40 across 9 roles
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.modules.job_market.ingestion import refresh_global_jobs  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="actually spend Apify credit and tokens")
    parser.add_argument("--roles", nargs="*", help="override the warm-role list")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        report = refresh_global_jobs(db, roles=args.roles, dry_run=not args.confirm)
    finally:
        db.close()

    print(f"mode              : {'LIVE' if args.confirm else 'DRY RUN'}")
    print(f"roles             : {len(report.roles_searched)}")
    print(f"actor runs        : {report.runs_completed}")
    print(f"apify cost        : ${report.apify_cost_usd:.4f}  (billed by Apify)")
    print(f"postings seen     : {report.postings_seen}")
    print(f"already known     : {report.already_known}  (skipped, cost nothing)")
    print(f"newly enriched    : {report.newly_enriched}")
    print(f"enrichment errors : {report.enrichment_failures}")
    print(f"rows upserted     : {report.rows_upserted}")
    print(f"rows archived     : {report.rows_archived}")
    print(f"tokens            : {report.input_tokens} in / {report.output_tokens} out")
    print(f"claude cost       : ${report.claude_cost_usd():.4f}")
    print(f"TOTAL             : ${report.total_cost_usd():.4f}")
    for message in report.errors:
        print(f"  note: {message}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
