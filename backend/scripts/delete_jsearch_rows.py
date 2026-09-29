"""Delete JSearch/Active Jobs-sourced rows from job_listings.

Now that the crawler is the only job source, these rows are dead weight —
they came from an on-demand search against a removed provider and nothing
will ever refresh or re-validate them again.

Identification: JSearch and Active Jobs are the only sources that ever left
job_listings.source NULL (see app/models/job.py's own comment on that
column) — every ATS adapter and the JSON-LD fallback always set it, and so
does the older board sweep (job_market/ingestion.py). A NULL source today
means exactly one thing: an on-demand row from the now-removed aggregator.

Dry by default, like every other destructive/spend-adjacent script in this
directory — prints what it would delete without touching the database.

    python scripts/delete_jsearch_rows.py            # dry run
    python scripts/delete_jsearch_rows.py --confirm  # actually deletes

Not run automatically anywhere, and not run against production by this
change — see the PR description for why.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.models.job import JobListing  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--confirm", action="store_true", help="actually delete the rows")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        query = db.query(JobListing).filter(JobListing.source.is_(None))
        count = query.count()

        if not args.confirm:
            print(f"DRY RUN — {count} JSearch/Active Jobs-sourced row(s) (source IS NULL) would be deleted.")
            print("Re-run with --confirm to actually delete them.")
            return 0

        deleted = query.delete(synchronize_session=False)
        db.commit()
        print(f"Deleted {deleted} JSearch/Active Jobs-sourced row(s).")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
