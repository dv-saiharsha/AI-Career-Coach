"""Copy the Supabase users into Firebase Authentication, keeping every user's id.

    SOURCE_DB_URL=postgresql://...  python scripts/import_users_to_firebase.py            # dry run (default)
    SOURCE_DB_URL=... python scripts/import_users_to_firebase.py --apply --project ID     # import
    SOURCE_DB_URL=... python scripts/import_users_to_firebase.py --verify --project ID    # compare, read-only

WHAT IT PRESERVES

  * uid           the Supabase user UUID, unchanged. Every row in this database is keyed by
                  it, so keeping it means no data is rewritten. A user that already exists
                  in Firebase with the same uid is REPLACED by an import, which is what lets
                  the same script rehearse now and run again at cutover.
  * email         and whether it was confirmed. An unconfirmed address is imported as
                  email_verified=False; it is never promoted to verified.
  * password      the bcrypt hash, as is (Firebase's BCRYPT algorithm takes no key, rounds or
                  salt). Users do not have to reset anything.
  * Google        the provider identity (providerId google.com + the Google account id), so
                  "Sign in with Google" lands on the imported account, not a new one.

SAFETY

  * The source connection is opened read-only; nothing is written to Supabase.
  * It never prints an email, name, hash, token or id. Output is counts only.
  * Dry run is the default. --apply and --verify need --project so a run cannot
    silently target whatever project the environment points at.
  * SOURCE_DB_URL is required and has no default, so this never picks up DB_URL
    (which will point at the destination after cutover).
"""

from __future__ import annotations

import argparse
import os
import sys

import psycopg2
from psycopg2.extras import RealDictCursor

BATCH = 1000  # Firebase's documented limit per import call

QUERY = """
SELECT u.id::text AS id, u.email, u.email_confirmed_at IS NOT NULL AS confirmed,
       u.encrypted_password, u.raw_user_meta_data,
       (u.banned_until IS NOT NULL AND u.banned_until > now()) AS banned,
       (u.deleted_at IS NOT NULL) AS deleted,
       COALESCE(
         (SELECT json_agg(json_build_object('provider', i.provider, 'provider_id', i.provider_id,
                                            'data', i.identity_data))
            FROM auth.identities i WHERE i.user_id = u.id), '[]'::json) AS identities
FROM auth.users u ORDER BY u.created_at
"""


def load_source(url: str) -> list[dict]:
    conn = psycopg2.connect(url)
    conn.set_session(readonly=True, autocommit=True)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(QUERY)
        rows = cur.fetchall()
    conn.close()
    return rows


def _first(*values):
    return next((v for v in values if v), None)


def to_record(row: dict, auth):
    """One Supabase user -> one Firebase import record. Returns (record, facts) where
    facts holds only booleans/enums, safe to aggregate and print."""
    meta = row["raw_user_meta_data"] or {}
    providers = []
    google_id = None
    for ident in row["identities"]:
        data = ident.get("data") or {}
        if ident["provider"] == "google":
            google_id = _first(data.get("sub"), ident.get("provider_id"))
            providers.append(
                auth.UserProvider(
                    uid=google_id,
                    provider_id="google.com",
                    email=_first(data.get("email"), row["email"]),
                    display_name=_first(data.get("full_name"), data.get("name")),
                    photo_url=_first(data.get("avatar_url"), data.get("picture")),
                )
            )
    has_password = bool(row["encrypted_password"])
    record = auth.ImportUserRecord(
        uid=row["id"],
        email=row["email"],
        email_verified=bool(row["confirmed"]),
        display_name=_first(meta.get("full_name"), meta.get("name")),
        photo_url=_first(meta.get("avatar_url"), meta.get("picture")),
        disabled=bool(row["banned"]),
        provider_data=providers or None,
        password_hash=row["encrypted_password"].encode() if has_password else None,
    )
    facts = {
        "google": google_id is not None,
        "password": has_password,
        "bcrypt": has_password and row["encrypted_password"].startswith("$2"),
        "verified": bool(row["confirmed"]),
        "banned": bool(row["banned"]),
        "deleted": bool(row["deleted"]),
        "uuid36": len(row["id"]) == 36,
    }
    return record, facts


def summarise(facts_list: list[dict]) -> None:
    n = len(facts_list)
    count = lambda k: sum(1 for f in facts_list if f[k])  # noqa: E731
    print(f"users read from Supabase:        {n}")
    print(f"  with a Google identity:        {count('google')}")
    print(f"  with a password (bcrypt):      {count('password')} ({count('bcrypt')} are bcrypt)")
    print(f"  email verified / NOT verified: {count('verified')} / {n - count('verified')}")
    print(f"  banned / soft-deleted:         {count('banned')} / {count('deleted')}")
    print(f"  uid is a 36-char UUID:         {count('uuid36')} of {n}")
    problems = [k for k in ("deleted",) if count(k)] + (["non-bcrypt password hash"] if count("password") != count("bcrypt") else [])
    if problems:
        print("PROBLEMS:", ", ".join(problems))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="import into Firebase")
    ap.add_argument("--verify", action="store_true", help="read back from Firebase and compare")
    ap.add_argument("--project", help="Firebase / GCP project id (required with --apply or --verify)")
    args = ap.parse_args()

    source = os.environ.get("SOURCE_DB_URL")
    if not source:
        print("SOURCE_DB_URL is required (deliberately no default).", file=sys.stderr)
        return 2
    if (args.apply or args.verify) and not args.project:
        print("--project is required with --apply / --verify.", file=sys.stderr)
        return 2
    if args.apply and args.verify:
        print("Choose one of --apply or --verify.", file=sys.stderr)
        return 2

    import firebase_admin
    from firebase_admin import auth

    rows = load_source(source)
    built = [to_record(r, auth) for r in rows]
    records = [b[0] for b in built]
    summarise([b[1] for b in built])

    if not (args.apply or args.verify):
        print(f"\nDRY RUN: {len(records)} records built and validated by the SDK; nothing sent. "
              "Use --apply --project <id> to import.")
        return 0

    firebase_admin.initialize_app(options={"projectId": args.project})

    if args.apply:
        ok = failed = 0
        errors: list[tuple[int, str]] = []
        for start in range(0, len(records), BATCH):
            result = auth.import_users(records[start:start + BATCH], hash_alg=auth.UserImportHash.bcrypt())
            ok += result.success_count
            failed += result.failure_count
            errors += [(start + e.index, e.reason) for e in result.errors]
        print(f"\nimported: {ok} succeeded, {failed} failed")
        for index, reason in errors:
            print(f"  record #{index}: {reason}")  # index only; never the user
        return 1 if failed else 0

    # --verify: every Supabase user exists in Firebase under the SAME uid, with the same facts.
    bad = 0
    for (record, facts), row in zip(built, rows):
        try:
            fb = auth.get_user(record.uid)
        except auth.UserNotFoundError:
            bad += 1
            print("  MISSING in Firebase (by uid)")
            continue
        google = any(p.provider_id == "google.com" for p in fb.provider_data)
        mismatches = [
            name for name, same in (
                ("email_verified", fb.email_verified == facts["verified"]),
                ("google provider", google == facts["google"]),
                ("disabled", fb.disabled == facts["banned"]),
            ) if not same
        ]
        if mismatches:
            bad += 1
            print(f"  uid present but differs on: {', '.join(mismatches)}")
    print(f"\nverify: {len(built) - bad} of {len(built)} users match Supabase (same uid, verified flag, Google link, disabled flag)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
