"""Whether a piece of text names a skill, through taxonomy normalisation.

Shared by the resume analyzer (advice that names a skill the resume already
has) and the JD analyzer (which skills a quote mentions). Kept apart from
core/taxonomy.py, which is the data, and from both callers, which should not
import each other.
"""

import re

from app.core.taxonomy import CANONICAL_ALIASES, canonical

# Skill names that are also ordinary English words. A case-insensitive search
# for "go" would match "go beyond", so these only count as a mention when
# written exactly as the skill was AND not as the first word of a sentence,
# where "Go beyond..." is indistinguishable from the language by spelling alone.
AMBIGUOUS_SKILL_WORDS = {"go", "swift", "rust", "spark", "ruby", "dart"}


def surface_forms(skill: str) -> tuple[set[str], set[str]]:
    """(case-insensitive forms, case-sensitive forms) a skill can be written as:
    the skill itself, its taxonomy canonical node, and every alias of that node
    ("k8s" for Kubernetes, "Amazon Web Services" for AWS)."""
    written = skill.strip()
    node = canonical(written)
    forms = {written.lower(), node}
    forms |= {alias for alias, target in CANONICAL_ALIASES.items() if target == node}
    insensitive, sensitive = set(), set()
    for form in forms:
        if form in AMBIGUOUS_SKILL_WORDS:
            sensitive.add(written)
        elif len(form) >= 3:  # two-letter forms ("ml", "ts") are too easy to hit by accident
            insensitive.add(form)
    return insensitive, sensitive


def mentions_any(text: str, skills: list[str]) -> bool:
    """Whether `text` names any of `skills` as a whole word, through taxonomy
    normalisation and case-insensitively."""
    insensitive: set[str] = set()
    sensitive: set[str] = set()
    for skill in skills:
        ci, cs = surface_forms(skill)
        insensitive |= ci
        sensitive |= cs
    # (forms, flags, what must precede the word). Mid-sentence only for the
    # ambiguous ones: a word character, comma or bracket, then one space.
    for forms, flags, before in (
        (insensitive, re.IGNORECASE, r"(?<!\w)"),
        (sensitive, 0, r"(?<=[A-Za-z0-9,;:()]\s)"),
    ):
        if not forms:
            continue
        pattern = before + r"(?:" + "|".join(re.escape(f) for f in sorted(forms, key=len, reverse=True)) + r")(?!\w)"
        if re.search(pattern, text, flags):
            return True
    return False


def _flatten(text: str) -> str:
    """Lower-case with every run of punctuation and whitespace as one space, so
    "retrieval-augmented generation" and "Node.js" compare equal to
    "retrieval augmented generation" and "node js"."""
    return " " + re.sub(r"[^a-z0-9+#]+", " ", (text or "").lower()).strip() + " "


def named_in(text: str, skill: str) -> bool:
    """Whether `text` names `skill` (or any alias of it) as a whole word,
    case-insensitively and across punctuation, including short and ambiguous
    names.

    For text already known to be about skills, such as the quote a JD analysis
    cites as evidence for one. mentions_any is the cautious version for free
    prose, where "go" is usually the word.
    """
    node = canonical(skill)
    forms = {skill.strip().lower(), node}
    forms |= {alias for alias, target in CANONICAL_ALIASES.items() if target == node}
    flat = _flatten(text)
    return any(f" {_flatten(form).strip()} " in flat for form in forms if form.strip())


def _forms(skill: str) -> set[str]:
    node = canonical(skill)
    forms = {skill.strip().lower(), node}
    forms |= {alias for alias, target in CANONICAL_ALIASES.items() if target == node}
    return {f for f in forms if f.strip()}


def named_at_end(text: str, skill: str) -> bool:
    """Whether `text` ENDS with `skill` (or an alias), across punctuation. For the
    last item of a list that starts partway through a clause: in "experience with
    message queues (Kafka", only Kafka ends the text, not "message queues"."""
    flat = _flatten(text)
    return any(flat.endswith(f" {_flatten(form).strip()} ") for form in _forms(skill))
