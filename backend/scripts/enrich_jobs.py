"""Enrich stored job listings that have never been through Claude.

Separate from the sweep so already-fetched postings can be enriched without
paying Apify again — the two halves of the pipeline cost money independently,
and a failed or skipped enrichment shouldn't require re-scraping.

Dry by default. A live run costs roughly $0.001 per posting (Haiku via the
Batch API, ~900 in / ~200 out tokens each).

    python scripts/enrich_jobs.py             # dry: counts what would be sent
    python scripts/enrich_jobs.py --confirm   # live
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.models.job import JobListing  # noqa: E402
from app.modules.job_market.ingestion import SweepReport, _enrich  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm", action="store_true", help="actually spend tokens")
    parser.add_argument("--limit", type=int, default=None, help="cap how many postings are sent")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        query = (
            db.query(JobListing)
            .filter(JobListing.enriched_at.is_(None), JobListing.content_hash.isnot(None))
            .order_by(JobListing.fetched_at.desc())
        )
        if args.limit:
            query = query.limit(args.limit)
        rows = query.all()

        # Descriptions are what enrichment reads; without one there is nothing
        # to classify and the call would be paid for a guaranteed "unmentioned".
        pending = {
            row.content_hash: {
                "title": row.title,
                "company": row.company,
                "description": row.description or "",
            }
            for row in rows
            if row.description
        }
        skipped = len(rows) - len(pending)

        print(f"unenriched rows   : {len(rows)}")
        print(f"no description    : {skipped}  (skipped — nothing to classify)")
        print(f"would send        : {len(pending)}")
        print(f"rough cost        : ${len(pending) * 0.001:.4f}")

        if not args.confirm:
            print("\nDRY RUN — no batch created. Re-run with --confirm to spend.")
            return 0
        if not pending:
            print("\nNothing to enrich.")
            return 0

        report = SweepReport(dry_run=False)
        facts = _enrich(pending, report)

        now = datetime.now(timezone.utc)
        by_hash = {row.content_hash: row for row in rows}
        applied = 0
        for digest, enriched in facts.items():
            row = by_hash.get(digest)
            if row is None:
                continue
            row.h1b_sponsorship = enriched["h1b_sponsorship"]
            row.h1b_evidence = enriched["h1b_evidence"] or None
            # The actor's own value wins; Claude only fills a blank.
            if row.experience_level is None:
                row.experience_level = enriched["experience_level"]
            if row.employment_type is None:
                row.employment_type = enriched["employment_type"]
            row.enriched_at = now
            applied += 1
        db.commit()

        print(f"\nenriched          : {report.newly_enriched}")
        print(f"failed            : {report.enrichment_failures}")
        print(f"rows updated      : {applied}")
        print(f"tokens            : {report.input_tokens} in / {report.output_tokens} out")
        print(f"claude cost       : ${report.claude_cost_usd():.4f}")
        for message in report.errors:
            print(f"  note: {message}")
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
