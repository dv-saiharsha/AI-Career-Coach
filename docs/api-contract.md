# API Contract

All endpoints below except `/api/auth/register` and `/api/auth/login` require a
`Authorization: Bearer <token>` header.

## Auth
- `POST /api/auth/register`
  - Input: `{"email": "...", "password": "..."}` (password ≥ 8 chars)
  - Output: `{"access_token": "...", "token_type": "bearer", "user": {"id": 1, "email": "..."}}`
- `POST /api/auth/login`
  - Input: `{"email": "...", "password": "..."}`
  - Output: same shape as register
- `GET /api/auth/me`
  - Output: `{"id": 1, "email": "..."}`

## Resume Analyzer (Phase 1)
- `POST /api/resume/analyze`
  - Input: `multipart/form-data` with `resume` (PDF/DOCX file) and `job_description` (text)
  - Output: `{"id": 1, "ats_score": 85, "missing_skills": [...], "matched_skills": [...], "extracted_skills": [...], "keyword_analysis": [{"keyword": "...", "present": true, "frequency": 2}], "suggestions": [...], "created_at": "..."}`
- `GET /api/resume/history`
  - Output: list of `{"id": 1, "resume_filename": "...", "ats_score": 85, "created_at": "..."}`
- `GET /api/resume/report/{analysis_id}`
  - Output: PDF file download of the stored analysis

## Interview Coach (Phase 2)
- `POST /api/interview/questions`
  - Input: `{"role": "Frontend Developer", "seniority": "Senior"}`
  - Output: `{"session_id": 1, "questions": [{"id": 1, "text": "...", "type": "technical"}]}`
- `POST /api/interview/evaluate`
  - Input: `{"question_id": 1, "answer_text": "..."}`
  - Output: `{"score": 8, "feedback": "...", "improvement_tips": "...", "sample_answer": "..."}`

## History (Phase 3)
- `GET /api/interview/history`
  - Output: list of `{"id": 1, "role": "...", "seniority": "...", "created_at": "...", "average_score": 7.5, "answered_count": 2, "question_count": 4}`

## LLM fallback behavior
Both `/api/resume/analyze` and `/api/interview/questions` / `/evaluate` call Claude
(`ANTHROPIC_MODEL`, default `claude-sonnet-5`) when `ANTHROPIC_API_KEY` is set. If the key
is missing or the call fails, they fall back to a rule-based analyzer (resume) or the
seed question dataset in `data/seed_questions/` (interview), so the app stays usable
without an API key — see the "Risks & Mitigations" section of the project proposal.
