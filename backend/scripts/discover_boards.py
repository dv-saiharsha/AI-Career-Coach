"""Report employer ATS boards we are not sweeping yet.

Run monthly. Company lists do not churn hourly, and hitting somebody's free
service 95 times a day to learn nothing new would be rude for no benefit.

    python scripts/discover_boards.py             # default 25 pages
    python scripts/discover_boards.py --pages 50  # deeper into the tail

Prints candidates and the registry lines for the live ones. It writes
nothing: a person reads the company names and pastes the survivors into
boards_registry.py, which is what that file's own docstring asks for.
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.modules.job_market import board_discovery, boards_registry  # noqa: E402

# Windows terminals default to cp1252 and the company names are not ASCII.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pages",
        type=int,
        default=board_discovery.DEFAULT_MAX_PAGES,
        help=f"pages of {board_discovery.PAGE_SIZE} roles to sample",
    )
    parser.add_argument("--verbose", action="store_true", help="log every probe")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(message)s",
    )

    print(f"Registry today: {boards_registry.board_count()} boards")
    print(f"Sampling up to {args.pages * board_discovery.PAGE_SIZE} roles from the directory...")
    report = board_discovery.discover(max_pages=args.pages)

    for error in report.errors:
        print(f"  ! {error}")

    dead = [c for c in report.candidates if not c.live]
    print()
    print(f"  roles sampled        : {report.sampled_roles:,}")
    print(f"  new board candidates : {len(report.candidates)}")
    print(f"  live (worth adding)  : {len(report.live)}")
    print(f"  dead (do not add)    : {len(dead)}")
    print(f"  roles they would add : {report.new_roles:,} per sweep")

    if report.live:
        print()
        print("LIVE — each returns full descriptions from the employer's own board")
        print(f"  {'provider':<11} {'token':<26} {'roles':>6}  company")
        for candidate in sorted(report.live, key=lambda c: -c.role_count):
            print(
                f"  {candidate.provider:<11} {candidate.token:<26} "
                f"{candidate.role_count:>6}  {candidate.company}"
            )

    if dead:
        print()
        print("DEAD — probed and did not answer. Consider adding to KNOWN_DEAD.")
        for candidate in dead:
            print(f"  {candidate.provider:<11} {candidate.token:<26}         {candidate.company}")

    if report.live:
        print()
        print("Paste into app/modules/job_market/boards_registry.py after review:")
        print()
        print(board_discovery.render_registry_lines(report))

    print(board_discovery.ATTRIBUTION)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
