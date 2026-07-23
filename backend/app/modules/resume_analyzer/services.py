import io
import re
from collections import Counter

from app.core.llm import llm_client

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

SYSTEM_PROMPT = (
    "You are an ATS (applicant tracking system) resume screening engine combined with a "
    "career coach. First determine whether the uploaded document is actually a resume/CV "
    "at all — not a job description, cover letter, random document, or unrelated file. "
    "If it is not a resume, set is_resume to false and give the other fields reasonable "
    "empty/zero defaults, since they won't be used. If it is a resume, set is_resume to "
    "true and score it against the job description the way real ATS keyword matching "
    "works, then give the candidate specific, actionable feedback."
)


class NotAResumeError(ValueError):
    """Raised when the uploaded document isn't actually a resume/CV."""


NOT_A_RESUME_MESSAGE = (
    "That doesn't look like a resume. Please upload your resume (PDF or Word .docx) to get an ATS match score."
)

# Cheap, free pre-filter before spending an LLM call: most real resumes have
# an email or phone number, or at least a couple of standard section headers.
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(\+?\d[\d\-\s().]{7,}\d)")
_RESUME_SIGNAL_KEYWORDS = (
    "experience", "education", "skills", "employment", "work history", "summary",
    "objective", "projects", "certifications", "resume", "curriculum vitae",
    "references", "qualifications", "professional experience",
)


def _looks_like_resume(text: str) -> bool:
    stripped = text.strip()
    if not (80 <= len(stripped) <= 30000):
        return False
    lower = stripped.lower()
    has_contact = bool(_EMAIL_RE.search(stripped)) or bool(_PHONE_RE.search(stripped))
    keyword_hits = sum(1 for kw in _RESUME_SIGNAL_KEYWORDS if kw in lower)
    return has_contact or keyword_hits >= 2


ANALYSIS_TOOL_SCHEMA = {
    "type": "object",
    "properties": {
        "is_resume": {
            "type": "boolean",
            "description": "True if the uploaded document is actually a resume/CV, false otherwise",
        },
        "ats_score": {"type": "number", "description": "Match score from 0-100"},
        "matched_skills": {"type": "array", "items": {"type": "string"}},
        "missing_skills": {"type": "array", "items": {"type": "string"}},
        "extracted_skills": {
            "type": "array",
            "items": {"type": "string"},
            "description": "All skills found on the resume",
        },
        "keyword_analysis": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string"},
                    "present": {"type": "boolean"},
                    "frequency": {"type": "integer"},
                },
                "required": ["keyword", "present", "frequency"],
            },
        },
        "suggestions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Specific, actionable resume improvements",
        },
    },
    "required": [
        "is_resume", "ats_score", "matched_skills", "missing_skills",
        "extracted_skills", "keyword_analysis", "suggestions",
    ],
}


def extract_text(filename: str, content: bytes) -> str:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext == "pdf":
        import pdfplumber

        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
        return "\n".join(parts)
    if ext == "docx":
        import docx

        document = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in document.paragraphs)
    raise ValueError("Unsupported file type. Upload a PDF or DOCX resume.")


def _keyword_candidates(jd_text: str) -> list[str]:
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


def _rule_based_analysis(resume_text: str, jd_text: str) -> dict:
    resume_lower = resume_text.lower()
    candidates = _keyword_candidates(jd_text)
    matched, missing, keyword_analysis = [], [], []
    for kw in candidates:
        freq = resume_lower.count(kw.lower())
        present = freq > 0
        (matched if present else missing).append(kw)
        keyword_analysis.append({"keyword": kw, "present": present, "frequency": freq})

    total = len(candidates) or 1
    ats_score = round(100 * len(matched) / total, 1)
    suggestions = [
        f'Add or emphasize "{kw}" — it appears in the job description but not your resume.'
        for kw in missing[:6]
    ]
    if not suggestions:
        suggestions = ["Your resume covers the job description's key terms well. Focus next on quantifying your impact."]

    return {
        "ats_score": ats_score,
        "missing_skills": missing[:15],
        "matched_skills": matched[:15],
        "extracted_skills": matched[:15],
        "keyword_analysis": keyword_analysis[:25],
        "suggestions": suggestions[:8],
    }


def _llm_analysis(resume_text: str, jd_text: str) -> dict:
    user_prompt = (
        f"RESUME:\n{resume_text[:8000]}\n\n"
        f"JOB DESCRIPTION:\n{jd_text[:4000]}\n\n"
        "Score how well the resume matches the job description as an ATS would."
    )
    data = llm_client.complete_tool_json(SYSTEM_PROMPT, user_prompt, "submit_analysis", ANALYSIS_TOOL_SCHEMA)
    if not data.get("is_resume", True):
        raise NotAResumeError(NOT_A_RESUME_MESSAGE)
    data.setdefault("matched_skills", [])
    data.setdefault("missing_skills", [])
    data.setdefault("extracted_skills", [])
    data.setdefault("keyword_analysis", [])
    data.setdefault("suggestions", [])
    data["ats_score"] = float(data.get("ats_score", 0))
    return data


def analyze_resume_against_job(filename: str, content: bytes, jd_text: str) -> dict:
    resume_text = extract_text(filename, content)
    if not resume_text.strip():
        raise ValueError("Couldn't read any text from that file. Try exporting it again as a text-based PDF.")
    if not jd_text.strip():
        raise ValueError("Paste the job description you're targeting.")
    # Cheap, free pre-filter — catches obviously-not-a-resume uploads (random
    # documents, images, empty files) before spending an LLM call on them.
    if not _looks_like_resume(resume_text):
        raise NotAResumeError(NOT_A_RESUME_MESSAGE)

    if llm_client.available:
        try:
            result = _llm_analysis(resume_text, jd_text)
            result["_source"] = "llm"
            result["resume_text"] = resume_text
            return result
        except NotAResumeError:
            raise
        except Exception:
            pass  # fall through to rule-based scoring

    result = _rule_based_analysis(resume_text, jd_text)
    result["_source"] = "rules"
    result["resume_text"] = resume_text
    return result
