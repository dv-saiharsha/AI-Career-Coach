"""Compile and score candidate-reviewed resume content before persistence."""

from app.ml.inference import model_available, predict_score
from app.modules.resume_builder import faang, fit, services


def compile_reviewed_resume(content: dict, job_description: str, job_title: str, company: str, target_pages: int) -> dict:
    """Compile the submitted edits and score the exact compiled text."""
    # No keywords: fit.py would re-sort each role's bullets by keyword count,
    # silently overriding the order the candidate chose while editing. The
    # trim ladder still cuts from the end of what they arranged, and reports it.
    fitted = fit.fit_to_pages(content, target_pages, jd_keywords=None, ladder="tailored")
    final_content = fitted["content"]
    resume_text = services._resume_text_from_payload(final_content)
    score = round(float(predict_score(resume_text, job_description)), 1) if model_available() else None
    filename = faang.build_filename(
        final_content.get("candidate_name"), job_title, company
    )
    return {
        "content": final_content,
        "resume_text": resume_text,
        "pdf_bytes": fitted["pdf_bytes"],
        "tex_source": fitted["tex"],
        "page_count": fitted["page_count"],
        "target_pages": target_pages,
        "fits": fitted["fits"],
        "adjustments": fitted["adjustments"],
        "filename": filename,
        "score": score,
    }