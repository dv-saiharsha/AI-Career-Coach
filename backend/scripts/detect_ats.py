"""Fill in ats_type/ats_slug for companies_seed.csv rows that don't have one
yet. Detection logic lives in app/modules/job_market/company_detection.py —
see its docstring for what counts as a match and why "manual_review" is a
real, expected outcome rather than a failure.

    python scripts/detect_ats.py data/companies_seed.csv
    python scripts/detect_ats.py data/companies_seed.csv --dry-run
    python scripts/detect_ats.py data/companies_seed.csv --concurrency 20

Re-runnable: rows that already have an ats_type are left untouched, never
re-probed — add rows with a blank one and run this again.

This scans each company's OWN distinct domain, so — unlike the ATS
adapters, which share a handful of hosts across every company on them —
running several of these concurrently doesn't concentrate load on any one
server; --concurrency only bounds how many of *our own* connections are
open at once.
"""

from __future__ import annotations

import argparse
import csv
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.modules.job_market.company_detection import detect_one  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

FIELDNAMES = ["name", "logo", "website", "careers_url", "ats_type", "ats_slug", "industry", "size", "active"]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("csv_path", type=Path, help="path to companies_seed.csv")
    parser.add_argument("--output", type=Path, default=None, help="defaults to overwriting csv_path in place")
    parser.add_argument("--dry-run", action="store_true", help="print what would change without writing")
    parser.add_argument("--concurrency", type=int, default=10, help="companies probed at once")
    args = parser.parse_args()

    with args.csv_path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    pending_indices = [i for i, row in enumerate(rows) if not (row.get("ats_type") or "").strip()]
    print(f"{len(rows)} companies on file, {len(pending_indices)} with no ats_type yet")

    if not pending_indices:
        print("nothing to detect")
        return 0

    results: dict[int, tuple[dict, str]] = {}
    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = {pool.submit(detect_one, rows[i]): i for i in pending_indices}
        for future, i in futures.items():
            try:
                results[i] = future.result()
            except Exception as exc:  # noqa: BLE001 - one company's crash must not lose the rest
                results[i] = (rows[i], f"detection crashed: {exc}")

    counts: dict[str, int] = {}
    for i in pending_indices:
        updated_row, message = results[i]
        rows[i] = updated_row
        ats_type = updated_row.get("ats_type") or "manual_review"
        counts[ats_type] = counts.get(ats_type, 0) + 1
        print(f"  {updated_row['name']:<30} {ats_type:<16} {message}")

    print()
    for ats_type, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {ats_type:<16} {count}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return 0

    output = args.output or args.csv_path
    with output.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)
    print(f"\nwrote {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
