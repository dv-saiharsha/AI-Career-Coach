"""Re-scrape the warm job roles and replace their cached listings.

    node scripts/backend.mjs scripts/refresh_jobs.py                      # dry run, free
    node scripts/backend.mjs scripts/refresh_jobs.py --confirm            # all warm roles, billed
    node scripts/backend.mjs scripts/refresh_jobs.py --role "ml engineer" --confirm

Intended for a nightly scheduler. Deliberately a script rather than an HTTP
route: this spends money on every invocation, and an endpoint that spends money
is one stray request (or one misconfigured healthcheck) away from a surprise
bill. The read path in app/modules/job_market/router.py only ever spends on an
explicit user search.

Defaults to a dry run and prints the projected charge, so the first thing
anyone discovers is the cost, not the invoice.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.modules.job_market import services  # noqa: E402

# Apify's per-result list price. Only used for the projection when
# JOB_SOURCE=apify; the provider console is the billing source of truth.
USD_PER_RESULT = 0.003


def _requested_role() -> str | None:
    """`--role "ml engineer"` limits the run to one query.

    Exists so a change to the ingestion path can be validated against real
    data for the price of one query instead of the whole warm set — the full
    refresh is ~50x the cost of proving the parser works.
    """
    if "--role" not in sys.argv:
        return None
    idx = sys.argv.index("--role")
    if idx + 1 >= len(sys.argv):
        print("--role needs a value, e.g. --role 'ml engineer'")
        sys.exit(2)
    return sys.argv[idx + 1]


def main() -> None:
    confirmed = "--confirm" in sys.argv
    one_role = _requested_role()
    roles = (services.normalise_query(one_role),) if one_role else services.WARM_ROLES
    per_query = settings.JOB_RESULTS_PER_QUERY
    projected = len(roles) * per_query

    source = (settings.JOB_SOURCE or "jsearch").lower()
    print(f"source           {source}")
    print(f"{'role' if one_role else 'warm roles':16} {len(roles)} ({', '.join(roles)})")

    if source == "jsearch":
        # Requests are the scarce resource here, not dollars. One query is one
        # request regardless of how many jobs come back, so the role count is
        # the whole cost.
        print(f"quota cost       {len(roles)} request(s) of 200/month")
        print(f"cache TTL        {settings.JOB_CACHE_TTL_HOURS}h "
              f"(-> at most {len(roles)} x {round(720 / settings.JOB_CACHE_TTL_HOURS)} "
              f"= {len(roles) * round(720 / settings.JOB_CACHE_TTL_HOURS)} requests/month)")
    else:
        print(f"actor            {settings.APIFY_ACTOR_ID}")
        print(f"results/query    {per_query}")
        print(f"projected cost   ~${projected * USD_PER_RESULT:.2f} (at ${USD_PER_RESULT}/result)")

    if not services.source_configured():
        key = "RAPIDAPI_KEY" if source == "jsearch" else "APIFY_API_TOKEN"
        print(f"\n{key} is not set in backend/.env - nothing to run.")
        sys.exit(1)

    if not confirmed:
        print("\nDry run. Re-run with --confirm to spend the amount above.")
        sys.exit(0)

    db = SessionLocal()
    try:
        if one_role:
            rows, billed = services.refresh_query(db, roles[0])
            results = {roles[0]: len(rows)}
        else:
            results, billed = services.refresh_warm_roles(db)
    finally:
        db.close()

    total = sum(results.values())
    print()
    for role, count in results.items():
        print(f"  {'ok  ' if count else 'FAIL'}  {role}: {count} listings")
    if source == "jsearch":
        print(f"\ncached {total} listings, spent {len(roles)} quota request(s)")
    else:
        # Billed figure comes from the run records, not USD_PER_RESULT x rows —
        # a run that failed after charging still shows up here, which is
        # exactly the number an operator needs to see.
        print(f"\ncached {total} listings, actually billed ~${billed:.4f}")
    # A role returning zero means the actor failed or matched nothing; either
    # way the operator should see a non-zero exit from their scheduler.
    sys.exit(0 if total else 1)


if __name__ == "__main__":
    main()
