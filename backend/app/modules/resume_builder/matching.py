"""Job-specific resume analysis shared by the Resume Match workflow."""

from app.ml.inference import model_available, predict_score
from app.modules.jd_analyzer import service as jd_service
from app.modules.resume_builder import autofill, jd_match, outlook, services


def analyze_resume_job(record, job_description: str, *, job_title: str = "", company: str = "", analysis_text: str | None = None, db=None) -> dict:
    """Return one real score and requirement evidence for the exact job text."""
    jd_text = (job_description or "").strip()
    if not jd_text:
        raise ValueError("This job listing did not include a description to analyze.")

    parsed = autofill.build_autofill(record.resume_text or "")
    analysis = jd_service.analyze(analysis_text or jd_text, db=db)
    requirements = jd_match.build_requirements(analysis, jd_text, job_title)
    years = jd_match.years_of_experience(parsed.get("experiences") or [])
    evidence = jd_match.index_resume(record.resume_text or "", parsed)
    matches = jd_match.match_requirements(requirements, evidence, years)

    score = round(float(predict_score(record.resume_text, jd_text)), 1) if model_available() else None
    match_rows = [match.to_dict() for match in matches]
    missing = [row for row in match_rows if row["match"] == "missing"]
    transferable = [row for row in match_rows if row["match"] == "transferable"]
    matched = [row for row in match_rows if row["match"] in ("exact", "related")]
    recommendations = [
        {
            "requirement": row["requirement"],
            "importance": row["importance"],
            "message": (
                f"No evidence for {row['requirement']} was found in this resume. "
                "If you have this experience, add an accurate example; otherwise treat it as a gap."
            ),
        }
        for row in missing
        if row["importance"] in ("critical", "high", "medium")
    ]
    recommendations.extend(
        {
            "requirement": row["requirement"],
            "importance": row["importance"],
            "message": (
                f"The resume shows {row['via']} experience, which is related to "
                f"{row['requirement']} but is not the same qualification."
            ),
        }
        for row in transferable
    )

    diagnostics = services.quality_report(
        record.resume_text or "",
        jd_text,
        parsed.get("experiences") or [],
        record.resume_file_bytes,
    )
    return {
        "analysis_id": record.id,
        "resume_filename": record.resume_filename,
        "job_title": job_title or analysis.job_title or "Target role",
        "company": company,
        "score": score,
        "score_available": score is not None,
        "score_label": "Resume-to-job compatibility estimate",
        "requirement_coverage": jd_match.coverage(matches),
        "outlook": outlook.shortlist_outlook(score, jd_match.coverage(matches), match_rows),
        "matched_requirements": matched,
        "transferable_requirements": transferable,
        "missing_requirements": missing,
        "recommendations": recommendations,
        "diagnostics": diagnostics,
        "jd_analysis_source": analysis.source,
    }