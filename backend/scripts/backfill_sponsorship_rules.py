"""Fill h1b_sponsorship for postings Claude has not enriched, for free.

With no Anthropic credit balance, the ordinary enrichment sweep returns {}
for every pending posting and leaves h1b_sponsorship NULL forever — the
Sponsors H-1B filter has zero matches not because no postings say anything,
but because nothing has been read yet. sponsorship_rules.py is a narrow,
high-precision stand-in: it only classifies postings whose language is
completely unambiguous, and leaves everything else "unmentioned" — the same
rubric the real Claude prompt uses.

Deliberately does not touch enriched_at. That column means "billed for", and
this did not cost anything — a real Claude sweep, once there is budget for
one again, still picks these rows up and its answer overwrites whatever this
script wrote, which is intended: Claude reads more than boilerplate phrases
and should win.

Idempotent and safe to re-run: it only ever looks at rows where
h1b_sponsorship IS NULL, so it does nothing on a second run except pick up
postings that arrived since the last one.

    python scripts/backfill_sponsorship_rules.py            # apply
    python scripts/backfill_sponsorship_rules.py --dry-run  # report only
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.models.job import JobListing  # noqa: E402
from app.modules.job_market.sponsorship_rules import classify_sponsorship  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BATCH_SIZE = 500


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="classify and report, write nothing"
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        rows = (
            db.query(JobListing)
            .filter(JobListing.h1b_sponsorship.is_(None), JobListing.description.isnot(None))
            .all()
        )
        print(f"{len(rows):,} unclassified postings with a description")

        counts = {"explicitly_sponsored": 0, "no_sponsorship": 0, "unmentioned": 0}
        touched = 0
        for i, row in enumerate(rows, start=1):
            label, evidence = classify_sponsorship(row.description)
            counts[label] += 1
            if label != "unmentioned":
                touched += 1
                if not args.dry_run:
                    row.h1b_sponsorship = label
                    row.h1b_evidence = evidence

            if not args.dry_run and i % BATCH_SIZE == 0:
                db.commit()

        if not args.dry_run:
            db.commit()

        print()
        for label, count in counts.items():
            print(f"  {label:22} {count:,}")
        print()
        verb = "would classify" if args.dry_run else "classified"
        print(f"{verb} {touched:,} postings ({touched / len(rows):.1%} of the unclassified set)")
        print(f"{counts['unmentioned']:,} remain unmentioned — left for real Claude enrichment")
        if args.dry_run:
            print("\nDry run — nothing was written. Re-run without --dry-run to apply.")
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
