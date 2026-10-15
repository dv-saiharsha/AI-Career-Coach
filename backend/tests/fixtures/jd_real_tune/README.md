# JD analyzer real-posting set: TUNE half

Ten of twenty real crawled job postings, annotated **by hand before the analyzer was run on
any of them**, with the rules in `../jd_golden/README.md`. The other ten are in
`../jd_real_test/` and are **locked**: they are run once, at the end, and nothing is chosen or
adjusted by looking at them.

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
- split 10 / 10 with `random.Random(20261014).sample` of the sorted file names.

## File shape

As the golden set, plus `listing` (id, title, company) and `jd_text` (the description as
crawled). The text annotated and analysed is `service.listing_text(title, description)`,
exactly what the app analyses for a crawled listing. Annotation decisions beyond the golden
rules: a level word in the listing title is stated and beats years; a skill is required
only if the requirements section states it; under a heading naming both kinds
("Qualifications/Nice to have") only an optional clause makes a skill preferred.
