# JD analyzer golden set

Six job descriptions, each analysed **by hand** (not by a model). The analyzer is scored
against these, so they are the definition of "correct". Each file is `<jd_id>.json`.

- Five are taken from the 17 seed JDs in `scripts/seed_job_descriptions.py` (the file stores
  only the `jd_id`; the text is read from the seed script).
- **`synthetic-engineering-manager` is SYNTHETIC.** It is not a real posting and not one of
  the seed JDs: it was written for this test set and is marked `"synthetic": true` in its
  file. Its text is stored in the file (`jd_text`, as raw HTML). It exists because no seed JD
  has a manager or lead title, a degree, or a required certification, and none is messy:
  it has HTML tags and entities, a benefits block and an EEO / accommodation statement that
  the analyzer must clean away.

## File shape

- `expected` is the target `JDAnalysis` (the Phase 2 schema) without `source`, which depends
  on how a run went and is not part of the expectation.
- `forbidden_skills`: things the JD does **not** say. Reporting one anywhere in the output is
  a hallucination (target: zero).
- `judgment_calls`: every place a reasonable annotator could differ, with what was decided.

## Annotation rules

1. `required_skills`: technical skills, technologies and practices the JD states as
   required ("Requirements:", "experience with", "expected", "strong", "deep expertise").
2. `preferred_skills`: only what the JD marks optional ("a plus", "nice to have",
   "preferred", "exposure to ... is a plus").
3. `name` is the taxonomy canonical form (`core/taxonomy.canonical`); `evidence` is an
   exact phrase from the (cleaned) JD, character for character.
4. **Either/or.** When one quote lists alternatives joined by "or" ("Go, Java, or Python"),
   every alternative is a skill and all of them carry the same `alternative_group`
   (`language`, `database`, ...). Recall is scored per group: finding one member counts as
   finding the group. Every member counts as correct, never as a false positive.
5. **Seniority.** `seniority` is a level word the JD states (title or text), mapped
   (entry level / new grad / graduate -> junior; staff / principal -> lead), with
   `seniority_source: "stated"`. With no level word, code maps `min_years_experience`
   (0-2 junior, 3-5 mid, 6+ senior) and sets `seniority_source: "years"`. With neither,
   `unknown` / `"unknown"`.
6. **`education` and `certifications`** are lists of `{name, required, evidence}`.
   `required` is false when the quote says "or equivalent", "a plus", "nice to have",
   "preferred" or "not required"; the quote is verbatim, like a skill's.
7. Soft skills (communication, eagerness, mentoring) are not skills. Mentoring and similar
   go in `responsibilities`.
8. A skill that names only where the work happens ("deploy on AWS SageMaker") is in
   `tools_technologies`, not `required_skills`.
9. Nothing the JD does not state is filled in: no degree, certification or tool.
   Empty list / `null` / `"unknown"` otherwise.
10. `ats_keywords` weights: required skill 1.0, job-title phrase 0.8, preferred 0.5, other
    emphasised domain terms 0.4. Evaluation checks presence, not the exact weight.
11. The job title never appears in `required_skills` or `preferred_skills`.

## Known thin spots

None of the 17 seed JDs states a degree, and only one names a certification; the synthetic
JD covers education, certifications, a manager title and cleaning. No seed JD is a lead role.
