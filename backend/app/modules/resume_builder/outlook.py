"""How a score moved, and how competitive a resume looks for one job.

Two small, deterministic summaries the Resume Match page shows next to the
trained model's ATS score. Neither is a new score.

score_change    before/after on the same job and the same model, labelled
                improved / unchanged / declined. Moves under one point are
                "unchanged": the model's error is several points, so a
                fraction of a point is not a change worth announcing.

shortlist_outlook
                A band (strong / competitive / possible / long shot) from the
                ATS score and requirement coverage, with the reasons that put
                it there. Deliberately NOT a probability of being selected:
                nothing here observes applicant pools, referrals or hiring
                decisions, so a "62% chance" would be a number that measures
                nothing. A band plus its drivers is what can be said honestly.
"""

from __future__ import annotations

UNCHANGED_WITHIN = 1.0

BANDS = (
    (80, "strong", "Strong match"),
    (65, "competitive", "Competitive"),
    (45, "possible", "Possible with gaps"),
    (0, "long_shot", "Long shot"),
)

OUTLOOK_NOTE = (
    "An estimate from this resume and this job description only. Being shortlisted "
    "also depends on the other applicants, referrals and the employer's own screening."
)


def score_change(before: float | None, after: float | None) -> dict | None:
    if before is None or after is None:
        return None
    delta = round(after - before, 1)
    direction = "unchanged" if abs(delta) < UNCHANGED_WITHIN else "improved" if delta > 0 else "declined"
    return {"delta": delta, "direction": direction}


def shortlist_outlook(ats_score: float | None, coverage: int, requirements: list[dict]) -> dict:
    """`requirements` are jd_match.Match.to_dict() rows."""
    unmet_critical = [r["requirement"] for r in requirements if r["importance"] == "critical" and r["match"] == "missing"]
    unmet_high = [r["requirement"] for r in requirements if r["importance"] == "high" and r["match"] == "missing"]
    met_key = [
        r["requirement"] for r in requirements
        if r["importance"] in ("critical", "high") and r["match"] in ("exact", "related")
    ]

    basis = coverage if ats_score is None else 0.5 * ats_score + 0.5 * coverage
    band = next(b for b in BANDS if basis >= b[0])
    # A missing critical requirement is usually a screen-out on its own,
    # whatever the rest of the resume scores.
    if unmet_critical and band[1] in ("strong", "competitive"):
        band = BANDS[2]

    drivers: list[str] = []
    if met_key:
        drivers.append(f"Meets {len(met_key)} key requirement(s): {', '.join(met_key[:4])}")
    if unmet_critical:
        drivers.append(f"Missing critical: {', '.join(unmet_critical[:4])}")
    if unmet_high:
        drivers.append(f"Missing high-priority: {', '.join(unmet_high[:4])}")
    drivers.append(f"Requirement coverage {coverage}%")
    if ats_score is not None:
        drivers.append(f"ATS score {round(ats_score)}")

    return {
        "band": band[1],
        "label": band[2],
        "drivers": drivers,
        "basis": "ats_and_coverage" if ats_score is not None else "coverage_only",
        "note": OUTLOOK_NOTE,
    }
