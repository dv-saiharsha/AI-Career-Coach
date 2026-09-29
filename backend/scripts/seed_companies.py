"""Load data/companies_seed.csv into the companies table.

Upserts by (ats_type, ats_slug) when a row has both — that pair is the
registry's own unique key (app/models/company.py). A manual_review row has
neither, so it upserts by name instead; re-running this for a still-
unresolved company updates its one row rather than creating a duplicate.

    python scripts/seed_companies.py data/companies_seed.csv

Safe to re-run after backend/scripts/detect_ats.py fills in more ats_type
values — existing rows are updated in place, never duplicated.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.database import SessionLocal  # noqa: E402
from app.models.company import Company  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def _blank_to_none(value: str | None) -> str | None:
    value = (value or "").strip()
    return value or None


def upsert_company(db, row: dict) -> tuple[Company, bool]:
    """Returns (row, created)."""
    ats_type = _blank_to_none(row.get("ats_type"))
    ats_slug = _blank_to_none(row.get("ats_slug"))
    name = (row.get("name") or "").strip()

    existing = None
    if ats_type and ats_slug:
        existing = (
            db.query(Company).filter(Company.ats_type == ats_type, Company.ats_slug == ats_slug).first()
        )
    if existing is None:
        existing = db.query(Company).filter(Company.name == name).first()

    created = existing is None
    if existing is None:
        existing = Company(name=name)
        db.add(existing)

    existing.name = name
    existing.logo_url = _blank_to_none(row.get("logo"))
    existing.website = _blank_to_none(row.get("website"))
    existing.careers_url = _blank_to_none(row.get("careers_url"))
    existing.ats_type = ats_type
    existing.ats_slug = ats_slug
    existing.industry = _blank_to_none(row.get("industry"))
    existing.size = _blank_to_none(row.get("size"))
    existing.active = (row.get("active") or "true").strip().lower() != "false"
    return existing, created


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_path", type=Path, help="path to companies_seed.csv")
    args = parser.parse_args()

    with args.csv_path.open(newline="", encoding="utf-8") as f:
        rows = [row for row in csv.DictReader(f) if (row.get("name") or "").strip()]

    db = SessionLocal()
    created_count = updated_count = 0
    try:
        for row in rows:
            _, created = upsert_company(db, row)
            db.flush()
            created_count += created
            updated_count += not created
        db.commit()
    finally:
        db.close()

    print(f"{len(rows)} rows in CSV -> {created_count} created, {updated_count} updated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
