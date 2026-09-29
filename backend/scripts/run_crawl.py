"""Run one full crawl over the companies table and print a summary.

    python scripts/run_crawl.py
    python scripts/run_crawl.py --company stripe --company acme

This is job_market/crawler.py's pipeline — all six ATS adapters
(Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Recruitee) plus the
JSON-LD fallback, sourced from the `companies` table (data/companies_seed.csv,
loaded via scripts/seed_companies.py) rather than boards_registry.py's
hardcoded list. See that module's own docstring for how this relates to the
older scripts/sweep_jobs.py, which is still there and still does its own,
separate thing.

Nothing here is behind a --confirm flag the way sweep_jobs.py's Claude
enrichment spend is: every one of these six sources is free or robots.txt-
gated, never billed per request.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import or_  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.company import Company  # noqa: E402
from app.modules.job_market.crawler import run_crawl  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--company",
        action="append",
        dest="companies",
        metavar="ATS_SLUG_OR_NAME",
        help="crawl only this company (matched by ats_slug or exact name); repeatable",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        company_ids = None
        if args.companies:
            matches = (
                db.query(Company)
                .filter(or_(Company.ats_slug.in_(args.companies), Company.name.in_(args.companies)))
                .all()
            )
            if not matches:
                print(f"no companies matched {args.companies!r}")
                return 1
            company_ids = [company.id for company in matches]
            print(f"crawling {len(matches)} of {len(args.companies)} requested: "
                  f"{', '.join(c.name for c in matches)}")

        run = run_crawl(db, trigger="manual", company_ids=company_ids)
    finally:
        db.close()

    print(f"crawl run       : {run.id}")
    print(f"started / ended : {run.started_at} / {run.ended_at}")
    print(
        f"companies       : {run.companies_attempted} attempted, "
        f"{run.companies_succeeded} ok, {run.companies_failed} failed"
    )
    print(f"jobs            : {run.jobs_new} new, {run.jobs_updated} updated, {run.jobs_closed} closed")
    for error in json.loads(run.errors or "[]"):
        print(f"  ! {error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
