import io
import re

from app.core.keywords import keyword_candidates
from app.core.llm import llm_client
from app.ml.inference import model_available, predict_score

SYSTEM_PROMPT = (
    "You are an ATS (applicant tracking system) resume screening engine combined with a "
    "career coach. First determine whether the uploaded document is actually a resume/CV "
    "at all — not a job description, cover letter, random document, or unrelated file. "
    "If it is not a resume, set is_resume to false and give the other fields reasonable "
    "empty/zero defaults, since they won't be used. If it is a resume, set is_resume to "
    "true and identify matched/missing/extracted skills, a keyword-frequency breakdown, "
    "and specific, actionable feedback. Do not compute a numeric match score — that is "
    "handled separately by a dedicated scoring model."
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
        "is_resume", "matched_skills", "missing_skills",
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


def _score(resume_text: str, jd_text: str, fallback_ratio: float) -> float:
    """ats_score always comes from the trained model when one exists — it's
    deterministic and free, unlike asking the LLM for a number. The keyword-
    ratio fallback only applies before anyone has ever run train_ats_model.py."""
    if model_available():
        return float(predict_score(resume_text, jd_text))
    return fallback_ratio


def _rule_based_analysis(resume_text: str, jd_text: str) -> dict:
    resume_lower = resume_text.lower()
    candidates = keyword_candidates(jd_text)
    matched, missing, keyword_analysis = [], [], []
    for kw in candidates:
        freq = resume_lower.count(kw.lower())
        present = freq > 0
        (matched if present else missing).append(kw)
        keyword_analysis.append({"keyword": kw, "present": present, "frequency": freq})

    total = len(candidates) or 1
    ats_score = _score(resume_text, jd_text, round(100 * len(matched) / total, 1))
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
    # The LLM no longer produces a score at all (see SYSTEM_PROMPT) — the
    # trained model is the sole, deterministic source of ats_score.
    data["ats_score"] = _score(resume_text, jd_text, 0.0)
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
