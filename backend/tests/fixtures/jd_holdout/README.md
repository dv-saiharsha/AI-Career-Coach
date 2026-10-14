# JD analyzer holdout set

Three seed JDs (`ml-engineer-mid`, `security-engineer-mid`, `backend-engineer-junior`),
annotated by hand with exactly the rules in `../jd_golden/README.md`, including
`forbidden_skills` ("must not report") lists.

**Purpose: an honest check on tuning.** These were written and committed BEFORE any change
to the analyzer's code, prompt or vocabulary that followed the first evaluation. During
tuning the analyzer is evaluated on the six golden JDs only; the holdout set is run **once**,
at the end. They are not used to choose or adjust anything.

They were picked because their analyses had not been looked at while the analyzer was first
built. No real postings were supplied, so all three are seed JDs.
