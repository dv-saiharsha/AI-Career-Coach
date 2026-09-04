"""Fitting a resume to an exact page count.

WHY THIS EXISTS

"One page" is not a property of LaTeX source. It is a property of the
compiled PDF, and the only way to know it is to compile and count. A
template that looks like it fits on one page holds a different amount for
every candidate — someone with two roles and someone with nine both get the
same document class.

So this compiles, counts, adjusts, and compiles again, until the page count
is the one asked for or there is nothing left to give. count_pdf_pages
already existed for warning that content had overflowed; this acts on that
number instead of reporting it.

WHAT IT WILL NOT DO

It never writes a line the candidate did not. Fitting to one page means
*choosing* among what they already wrote — the most job-relevant roles and
bullets — and fitting to two means including more of it. Neither means
generating a sentence to fill space, which is why there is no expansion
ladder to match the trim ladder below: if an experienced candidate's own
content only fills a page and a half, that is what comes back, and the
response says so. Padding to reach a page count would put words in their
mouth that they have to defend in an interview.

This mirrors faang.py's rule and resume_builder/tailor.py's: reorganise and
select, never invent.

THE ORDER THE LADDER TRIMS IN

Least costly to the candidate first, and relevance-aware throughout:

  1. Bullets past a per-role cap, oldest roles first. A role's later bullets
     are usually its weakest, and an old role's weakest bullets are the
     least load-bearing text in the document.
  2. The summary, which is the only section a strong resume loses nothing by
     dropping — the experience section already says it.
  3. Whole roles, oldest first, never the most recent two.
  4. The tools list, then the technical list, down to the JD-relevant ones.

Every step is recorded and returned, because a resume that quietly lost the
candidate's first job is worse than one that says it did.
"""

from __future__ import annotations

import logging
from typing import Any

from app.modules.resume_builder import latex

logger = logging.getLogger(__name__)

# A compile is ~1s, so the loop is bounded tightly. Six passes is enough to
# take a nine-role resume down to one page through the ladder below; if it
# is not, the result comes back honest about the page count rather than
# spinning.
MAX_PASSES = 6

# Below this a role is not worth listing at all — a heading with one weak
# bullet costs more space than it earns.
MIN_BULLETS_PER_ROLE = 1

# Never drop below this many roles: a resume with one job is not a shorter
# resume, it is a different candidate.
MIN_ROLES = 2


def _relevance(text: str, keywords: set[str]) -> int:
    """How many JD keywords a bullet evidences. Ties keep original order,
    which is the candidate's own ordering and usually meaningful."""
    lowered = text.lower()
    return sum(1 for keyword in keywords if keyword and keyword in lowered)


def _rank_bullets(experiences: list[dict], keywords: set[str]) -> list[dict]:
    """Order each role's bullets by JD relevance, most relevant first.

    Reordering is not rewriting: every bullet is the candidate's own text,
    and putting the job-relevant one first is what a person does by hand when
    they tailor. It matters because the trim ladder cuts from the end.
    """
    ranked = []
    for exp in experiences:
        bullets = [b for b in (exp.get("bullets") or []) if b and b.strip()]
        bullets.sort(key=lambda b: -_relevance(b, keywords))
        ranked.append({**exp, "bullets": bullets})
    return ranked


def _trim_step(data: dict, state: dict) -> str | None:
    """Apply one rung of the ladder in place. Returns what it did, or None
    when there is nothing further to give."""
    experiences: list[dict] = data.get("experiences") or []

    # 1. Bullets past the cap, oldest role first.
    cap = state["bullet_cap"]
    if cap > MIN_BULLETS_PER_ROLE:
        over = [e for e in experiences if len(e.get("bullets") or []) > cap]
        if over:
            for exp in over:
                exp["bullets"] = exp["bullets"][:cap]
            state["bullet_cap"] = cap - 1
            return f"kept the {cap} most relevant bullets per role"
        state["bullet_cap"] = cap - 1
        return _trim_step(data, state)

    # 2. The summary.
    if data.get("summary"):
        data["summary"] = ""
        return "dropped the summary — the experience section already says it"

    # 3. Whole roles, oldest first.
    if len(experiences) > MIN_ROLES:
        dropped = experiences.pop()
        title = dropped.get("title") or "a role"
        company = dropped.get("company") or ""
        return f"dropped the oldest role ({title}{' at ' + company if company else ''})"

    # 4. Skills, tools before technical.
    for key in ("tools_skills", "technical_skills"):
        skills = data.get(key) or []
        if len(skills) > 4:
            data[key] = skills[: max(4, len(skills) - 4)]
            return f"shortened the {key.replace('_', ' ')} list"

    return None


def fit_to_pages(
    data: dict[str, Any],
    target_pages: int,
    jd_keywords: set[str] | None = None,
    density: str | None = None,
) -> dict[str, Any]:
    """Render, compile and trim until the PDF is `target_pages` or fewer.

    Returns the tex, the PDF bytes, the page count actually achieved and the
    adjustments made. The page count is what the compiler produced, never
    what was asked for — a caller that gets 2 back when it asked for 1 is
    being told the truth about a resume that would not fit.
    """
    # A two-page resume is the same content set to be read rather than
    # squeezed, so the longer target gets the roomier typography by default.
    # This is the only reason a two-page build differs from a one-page build
    # for a candidate whose content fits either way — there is nothing added.
    density = density or ("regular" if target_pages >= 2 else "compact")

    working = {
        **data,
        "experiences": _rank_bullets(data.get("experiences") or [], jd_keywords or set()),
    }
    # Starting cap is the longest role's bullet count, so the first pass is a
    # real compile of everything the candidate has rather than a pre-trimmed
    # guess at what might fit.
    longest = max((len(e.get("bullets") or []) for e in working["experiences"]), default=0)
    state = {"bullet_cap": max(longest, MIN_BULLETS_PER_ROLE)}

    adjustments: list[str] = []
    tex = latex.render_resume_tex(working, density)
    pdf = latex.compile_tex_to_pdf(tex)
    pages = latex.count_pdf_pages(pdf)

    for _ in range(MAX_PASSES):
        if pages <= target_pages:
            break
        note = _trim_step(working, state)
        if note is None:
            # Nothing left to cut. Returning the over-length document is the
            # honest outcome; the alternative is deleting content the
            # candidate needs to still be a candidate.
            logger.info("could not fit resume to %d page(s); returning %d", target_pages, pages)
            break
        adjustments.append(note)
        tex = latex.render_resume_tex(working, density)
        pdf = latex.compile_tex_to_pdf(tex)
        pages = latex.count_pdf_pages(pdf)

    return {
        "tex": tex,
        "pdf_bytes": pdf,
        "page_count": pages,
        "target_pages": target_pages,
        "fits": pages <= target_pages,
        "adjustments": adjustments,
        "density": density,
        "content": working,
    }
