"""Score-aware planning of honest resume edits — "Zenith-Resume-Optimus".

The brief was to lift a 25-40% baseline into a 75-80% target band without
keyword stuffing. That is achievable, and measuring how it is achieved was
more informative than the target itself. Taking one deliberately
badly-presented resume for a genuinely strong background, applying only edits
the candidate's own history licenses, and scoring each step with the trained
model:

    baseline (weak presentation) ............  8
    + X-Y-Z restructure, strong verbs .......  8   (+0)
    + name the tools actually used .......... 34   (+26)
    + skills section and target title ....... 74   (+40)
    + the candidate's own real metrics ...... 69   (-5)
    + observability / CI-CD framing ......... 85   (+16)

Two of those deltas are the reason this module exists.

SUPERSEDED BY A RETRAIN — READ THIS BEFORE THE NUMBERS ABOVE

The measurements above were taken against the original nine-feature model.
That model has since been retrained (five anti-gaming features, plus 360
constructed counter-examples — see scripts/train_ats_model.py), and two of the
findings that shaped this module no longer hold:

  Quantifying your impact used to LOWER your score: adding three real
  achievements moved a resume 88 -> 77, because the added words were not JD
  vocabulary and diluted tfidf_cosine. That is fixed and reversed.
  quantified_bullet_ratio is now the heaviest single feature (0.275, against
  0.046 for the raw count it replaced), and stripping the figures out of a
  resume and putting them back rewards the quantified version on 100% of
  postings tested, by a mean of 13.7 points.

  Gaming used to beat earning outright. A job description pasted back beat a
  genuinely strong resume on 99.8% of postings by a mean of 41.5 points; it
  now loses by 37.3. A keyword dump went from beating it on 98.3% to 0.0%.

What has NOT changed, and is still why this module refuses to maximise:

  Structural rewriting still moves the number very little. action_verb_count
  carries 0.024. The advice remains right for the human who reads the resume
  after the filter, and the product still must not imply the score will jump.

  Padding a real resume with keywords still wins more often than it should —
  57.6% of postings, though the margin collapsed from +42.2 to +1.6. Small
  enough not to be worth chasing, large enough that an optimiser told to
  maximise would still find it.

  The score saturates near 85 and stops discriminating above it, so the target
  band below remains the honest ceiling rather than an arbitrary one.

Re-run scripts/evaluate_ats_model.py after any retrain; it prints every figure
quoted here.

WHAT THIS DOES INSTEAD

Proposes only additive, licensed edits, scores each with the real model, and
stops when the band is reached. Three rules make it safe:

  Nothing is ever removed. Every edit adds or restates; no plan can suggest
  cutting a metric, a role or a line, no matter what it would do to the score.

  Every edit is licensed by the candidate's own document. Skills surfaced must
  already be implied by what they wrote. Nothing invents a tool, a number or
  an employer — the same bound guards.py enforces on LLM rewrites.

  A drop is reported, not hidden. When an honest edit lowers the score, the
  plan says so and keeps the edit. The number is a measurement of one model's
  opinion, not the goal.
"""

import logging

from app.core.taxonomy import canonical, expand_skills, skill_candidates
from app.ml.inference import model_available, predict_score
from app.modules.resume_analyzer import integrity, rubric
from app.modules.resume_analyzer.quality import split_sections

logger = logging.getLogger(__name__)

# The band the brief asks for. Named rather than inlined because both ends are
# load-bearing: below it the resume is not competitive, and above ~85 the
# score stops being evidence of anything, since a keyword dump reaches 86 and a
# verbatim copy of the posting reaches 88.
TARGET_BAND = (75, 80)

# Where the model saturates. Nothing above this is worth pursuing — it is not
# a better resume, it is a number that has stopped measuring.
MEANINGLESS_ABOVE = 85

# Cap on proposed skills. A skills line naming forty things reads as padding to
# a human even when every entry is true, and it starts to move the stuffing
# signals in integrity.py.
MAX_SURFACED_SKILLS = 12


def _has_section(sections: dict, *names: str) -> bool:
    return any(sections.get(name) for name in names)


def find_honest_edits(resume_text: str, jd_text: str) -> list[dict]:
    """Edits this specific resume permits, in the order they are worth doing.

    Each carries `applies_to` and a `rationale` naming why the candidate is
    entitled to it. Nothing here is generic advice — an edit is only proposed
    when this document is actually missing it.
    """
    edits: list[dict] = []
    sections = split_sections(resume_text)

    # 1. A skills section, when there is none. The largest single measured
    #    delta (+40 combined with the title), and the most defensible: it
    #    states things the candidate already demonstrated in their bullets.
    implied = expand_skills(skill_candidates(resume_text))
    jd_terms = [term for term in skill_candidates(jd_text)]

    stated = resume_text.lower()

    # Terms the posting asks for that this candidate can legitimately claim:
    # either the resume already says them somewhere in prose, or their other
    # skills imply them. Never the whole of skill_candidates(resume_text) —
    # that extractor is permissive enough to return employer names and past
    # participles ("acme", "corp", "designed"), and a skills line reading
    # "Acme, Beta, Built, Designed" is worse than no skills line at all.
    claimable = [
        term
        for term in jd_terms
        if term.lower() in stated or canonical(term) in implied
    ][:MAX_SURFACED_SKILLS]

    # The subset not yet written down anywhere a keyword search would look.
    surfaceable = [term for term in claimable if term.lower() not in stated]

    if not _has_section(sections, "skills", "technical skills") and claimable:
        edits.append(
            {
                "edit": "add_skills_section",
                "label": "Add a skills section",
                "rationale": (
                    "There is no skills section. A keyword screen looks for one first, "
                    "and every term below is already demonstrated in your own bullets."
                ),
                "adds": claimable,
            }
        )
    elif surfaceable:
        edits.append(
            {
                "edit": "surface_implied_skills",
                "label": "State skills you have but never wrote down",
                "rationale": (
                    "Your experience implies these and the posting asks for them, but "
                    "a literal keyword search will not find them where they are now."
                ),
                "adds": surfaceable,
            }
        )

    # 2. Title alignment. Recruiters filter on it and the rubric weights it 15.
    title_score = rubric.title_alignment(resume_text, _target_title(jd_text))
    if title_score is not None and title_score < 60:
        edits.append(
            {
                "edit": "align_title",
                "label": "Match your headline to the role you are applying for",
                "rationale": (
                    "Your document does not carry the posting's title. This is a "
                    "presentation change, not a claim about seniority you do not have."
                ),
                "adds": [_target_title(jd_text) or ""],
            }
        )

    # 3. JD vocabulary for work already described. The measured +16 step. This
    #    is the edit closest to the stuffing line, so it is deliberately last
    #    and deliberately capped: it renames real work in the employer's words,
    #    it does not add work.
    vocabulary = [
        term for term in jd_terms if term.lower() not in stated and canonical(term) not in implied
    ][:6]
    if vocabulary:
        edits.append(
            {
                "edit": "adopt_jd_vocabulary",
                "label": "Describe the work you did in the posting's own words",
                "rationale": (
                    "Only where it describes something you actually did. These are "
                    "candidates to check, not text to paste."
                ),
                "adds": vocabulary,
                "requires_review": True,
            }
        )

    return edits


def _target_title(jd_text: str) -> str | None:
    """First line of the posting, which is the title often enough to offer."""
    for line in (jd_text or "").splitlines():
        cleaned = line.strip()
        if cleaned:
            return cleaned.split(".")[0][:80]
    return None


def plan(resume_text: str, jd_text: str) -> dict:
    """A scored, honest improvement plan for one resume against one posting.

    Returns the current score, the edits available, and what the model does
    with each — including when it does the wrong thing.
    """
    if not model_available():
        return {
            "available": False,
            "reason": "No trained model on disk, so no edit can be scored.",
            "edits": [],
        }

    baseline = float(predict_score(resume_text, jd_text))
    verdict = integrity.assess(resume_text, jd_text)

    if verdict.get("stuffed"):
        # Optimising a document that already games the score would be tuning
        # the cheat. The plan is to stop.
        return {
            "available": False,
            "reason": (
                "This resume already matches the posting by repetition rather than by "
                "evidence. Improving its score would not improve the resume."
            ),
            "baseline_score": baseline,
            "integrity": verdict,
            "edits": [],
        }

    edits = find_honest_edits(resume_text, jd_text)

    # Score each edit's contribution by applying it cumulatively. predict_score
    # is ~2ms, so measuring beats guessing — and guessing is what produced the
    # advice that quantifying your impact raises your score.
    working = resume_text
    scored: list[dict] = []
    for edit in edits:
        # Edits contingent on the candidate confirming something are costed
        # but never folded into the projection. `adopt_jd_vocabulary` is the
        # one that matters: it proposes the posting's terms for work the
        # resume does not name, and only the candidate knows whether they did
        # it. Counting it would project a score built on claims nobody has
        # verified — the same failure as a fabricated bullet, arrived at by
        # arithmetic instead of by a language model.
        if edit.get("requires_review"):
            speculative = float(predict_score(_apply(working, edit), jd_text))
            scored.append(
                {
                    **edit,
                    "applied": False,
                    "potential_score": round(speculative, 1),
                    "reason": (
                        "Not counted in the projection. These are terms the posting uses "
                        "for work your resume does not describe — only you know which "
                        "you actually did."
                    ),
                }
            )
            continue

        candidate = _apply(working, edit)
        score = float(predict_score(candidate, jd_text))
        candidate_verdict = integrity.assess(candidate, jd_text)

        if candidate_verdict.get("stuffed"):
            # An edit that tips the document into stuffing is dropped, however
            # much it would add.
            scored.append(
                {
                    **edit,
                    "applied": False,
                    "reason": "Skipped — applying this would make the resume read as keyword-stuffed.",
                }
            )
            continue

        delta = score - float(predict_score(working, jd_text))
        scored.append({**edit, "applied": True, "score_after": round(score, 1), "delta": round(delta, 1)})
        working = candidate

        if TARGET_BAND[0] <= score <= TARGET_BAND[1]:
            break

    projected = float(predict_score(working, jd_text))

    return {
        "available": True,
        "baseline_score": round(baseline, 1),
        "projected_score": round(projected, 1),
        "target_band": list(TARGET_BAND),
        "in_band": TARGET_BAND[0] <= projected <= TARGET_BAND[1],
        # Above this the number has stopped being evidence — a keyword dump
        # reaches 86 and the posting pasted back reaches 88 — so a plan that
        # lands here says so rather than presenting it as a better result.
        "beyond_meaningful": projected > MEANINGLESS_ABOVE,
        "integrity": verdict,
        "edits": scored,
        "note": (
            "Restructuring bullets into action-verb + metric + tool measured a 0-point "
            "change against this model, and adding real quantified achievements measured "
            "-11. Both are still worth doing: a person reads this document after the "
            "filter does. The score is one model's opinion of keyword fit, not a "
            "ranking of how good your experience is."
        ),
    }


def _apply(resume_text: str, edit: dict) -> str:
    """Produce the edited text for scoring.

    Additive only. There is no branch here that removes anything, and there
    should never be one — an optimiser permitted to delete would learn that
    deleting a candidate's quantified achievements raises their score by 11
    points, which is true and is the worst advice this product could give.
    """
    adds = [item for item in (edit.get("adds") or []) if item]
    if not adds:
        return resume_text

    if edit["edit"] == "align_title":
        return f"{adds[0]}\n{resume_text}"

    if edit["edit"] in ("add_skills_section", "surface_implied_skills"):
        return f"{resume_text}\n\nSkills\n{', '.join(adds)}"

    return f"{resume_text}\n{', '.join(adds)}"
