"""
Shared keyword extraction — used by both the live resume analyzer
(app.modules.resume_analyzer.services) and the ML feature extractor
(app.ml.features). Lives here, independent of either, so importing one
doesn't create a circular dependency on the other.
"""

import re
from collections import Counter

STOPWORDS = {
    "the", "and", "for", "are", "with", "you", "your", "our", "will", "have", "this",
    "that", "from", "who", "job", "role", "team", "work", "years", "year", "experience",
    "ability", "including", "such", "into", "using", "use", "able", "strong", "must",
    "required", "preferred", "responsibilities", "requirements", "about", "company",
    "opportunity", "candidate", "candidates", "skills", "skill", "we", "a", "an", "to",
    "of", "in", "on", "as", "is", "be", "or", "at", "by",
    # role/title & filler words that ride along with real skill keywords but aren't skills
    "software", "engineer", "engineering", "developer", "development", "manager",
    "management", "specialist", "analyst", "lead", "senior", "junior", "position",
    "hiring", "join", "looking", "seeking", "plus", "great", "excellent", "understanding",
}


def keyword_candidates(jd_text: str) -> list[str]:
    """Picks out tokens that read like real skills/tech terms rather than
    ordinary sentence words: proper nouns (capitalized, not sentence-initial),
    acronyms (AWS, SQL), and symbol/digit-bearing terms (CI/CD, Node.js, C++)."""
    counts: Counter[str] = Counter()
    for sentence in re.split(r"(?<=[.!?])\s+", jd_text):
        words = re.findall(r"[A-Za-z][A-Za-z0-9+/#.\-]{1,}", sentence)
        for i, raw in enumerate(words):
            clean = raw.strip(".,()")
            lower = clean.lower()
            if len(clean) <= 2 or lower in STOPWORDS:
                continue
            is_acronym = clean.isupper() and len(clean) <= 5
            has_symbol_or_digit = bool(re.search(r"[0-9+#./]", clean))
            is_proper_noun = clean[0].isupper() and i > 0
            if is_acronym or has_symbol_or_digit or is_proper_noun:
                counts[clean] += 1
    return [w for w, _ in counts.most_common(25)]


# A posting's substantive part starts here, when it says so explicitly.
_REQUIREMENTS_SECTION = re.compile(
    r"^\s*(requirements|responsibilities|qualifications|"
    r"minimum qualifications|preferred qualifications|"
    r"what you.ll (?:do|bring|need)|who you are|about you)\s*:?\s*$",
    re.IGNORECASE | re.MULTILINE,
)


def _requirements_text(jd_text: str) -> str:
    """Drop a leading "About Us"-shaped preamble before extracting keywords.

    Found running a real Cloudflare posting through keyword_candidates: it
    opens with paragraphs of company history and press mentions ("Fortune
    500", "Entrepreneur Magazine's Top Company Cultures list", "World's Most
    Innovative Companies"), and the proper-noun heuristic above has no way to
    tell those apart from a real skill name — both are capitalized words
    mid-sentence. Position is the one signal that does: once the text reaches
    an explicit "Responsibilities"/"Requirements"-shaped heading, everything
    before it is safely skippable. A posting with no such heading is returned
    unchanged.

    Used only by app.core.taxonomy.skill_candidates_from_posting — never by
    keyword_candidates itself, which app/ml/features.py also calls, and which
    the trained model (scripts/train_ats_model.py) was fit against. Changing
    what text THAT reads would shift its features out from under the model's
    learned weights — train/serve skew — without a retrain.
    """
    match = _REQUIREMENTS_SECTION.search(jd_text or "")
    return jd_text[match.start():] if match else jd_text
