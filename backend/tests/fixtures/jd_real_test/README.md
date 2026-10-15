# JD analyzer real-posting set: TEST half (LOCKED)

**LOCKED.** Run once, at the end of the tuning round, and never used to choose or adjust
anything. Ten of twenty real crawled job postings, annotated **by hand before the analyzer was run on
any of them**, with the rules in `../jd_golden/README.md`. The tuning half is in `../jd_real_tune/`.

## Where they come from

`career_coach_test.job_listings` (crawled), read with a read-only session. Rules fixed before
any posting text was read, seed 20261014:

- raw description at least 3,000 characters; at least two section headings after cleaning;
  benefits / EEO boilerplate present (cleaning removes at least 300 characters);
- seven roles from the title (security, ML/AI, data scientist, data engineer, DevOps/SRE,
  frontend/full-stack, backend/software), excluding managers, directors, sales, recruiting,
  architects and interns; level from the title (senior words win over a trailing " I"; a
  title naming junior and senior words both is excluded);
- 6 junior, 7 mid, 7 senior: within a level, roles in a seeded order, one posting at a time,
  one posting per company. After the first draw, two fixes made from titles only: the level
  rule above, and skipping a "Business Development" title at selection time.
- split 10 / 10, stratified (re-split before any analyzer output for a real posting existed):
  of all 184,756 splits, those with the smallest total imbalance in role, annotated level and
  level source (8, the floor: eight categories have odd totals) were tied (400); one was chosen
  with `random.Random(20261014).choice`. There are 3 ML/AI postings (split 2/1), 6 'years'
  cases (3/3) and 3 mid-level postings (2/1).

## File shape

As the golden set, plus `listing` (id, title, company) and `jd_text` (the description as
crawled). The text annotated and analysed is `service.listing_text(title, description)`,
exactly what the app analyses for a crawled listing. Annotation decisions beyond the golden
rules: a level word in the listing title is stated and beats years; a skill is required
only if the requirements section states it; under a heading naming both kinds
("Qualifications/Nice to have") only an optional clause makes a skill preferred.
