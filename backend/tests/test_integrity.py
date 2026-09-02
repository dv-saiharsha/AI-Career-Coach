"""The anti-fabrication and anti-stuffing checks.

Both modules under test exist because a measurement came back badly, and both
sets of thresholds were set from that measurement. These tests pin the
behaviour that motivated them so a later tuning pass has to break an explicit
assertion rather than quietly widen a limit.
"""

import pytest

from app.modules.resume_analyzer import integrity
from app.modules.resume_builder import guards

JD = (
    "Senior Backend Engineer. We need Python, Go, Kubernetes, Docker, PostgreSQL, Redis, "
    "Kafka, Terraform, AWS, gRPC, microservices, distributed systems, CI/CD, observability. "
    "You will design scalable services, mentor engineers, and own reliability at scale."
)

REAL_RESUME = """JANE DOE
jane.doe@example.com | (555) 010-1234 | San Francisco, CA

SUMMARY
Backend engineer with seven years building payment and ledger systems.

EXPERIENCE
Senior Software Engineer, Acme Corp, 2020-2025
- Built payment services in Python handling 500k transactions daily
- Reduced p99 latency 34% by moving the hot path to Go
- Migrated 12 services to Kubernetes, cutting deploy time from 40 to 8 minutes
- Designed the PostgreSQL schema powering the ledger, now 4TB
- Mentored three junior engineers through their first on-call rotations

Software Engineer, Beta Inc, 2018-2020
- Developed internal tooling that saved the support team 20 hours weekly
- Automated deployments with Terraform on AWS, removing manual release steps
- Instrumented the checkout flow, cutting unexplained failures from 9% to 1%

SKILLS
Python, Go, Kubernetes, PostgreSQL, Terraform, AWS, Kafka

EDUCATION
B.S. Computer Science, Stanford University, 2018
"""

KEYWORD_DUMP = (
    "Python Go Kubernetes Docker PostgreSQL Redis Kafka Terraform AWS gRPC microservices "
    "distributed systems CI/CD observability scalable services mentor reliability "
) * 30


# ── the fabrication bound ────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "original,suggested,reason",
    [
        (
            "Worked on the payments service to make it faster",
            "Reduced payment latency by 47% using Go",
            "invents the 47%",
        ),
        (
            "Kept the service running reliably",
            "Maintained 99.99% uptime across the fleet",
            "invents an uptime figure",
        ),
        (
            "Led the backend team",
            "Led a team of 12 engineers",
            "invents a headcount",
        ),
        (
            "Migrated the services to Kubernetes",
            "Migrated three services to Kubernetes",
            "smuggles a count in as a word",
        ),
        (
            "Built the ingestion pipeline",
            "Built the ingestion pipeline using Apache Spark and Snowflake",
            "names tools that appear nowhere in the resume",
        ),
    ],
)
def test_fabrication_is_rejected(original: str, suggested: str, reason: str) -> None:
    verdict = guards.verify_suggestion(original, suggested, REAL_RESUME)
    assert not verdict["ok"], f"should have been rejected: {reason}"
    assert verdict["violations"], "a rejection must say what was wrong"


@pytest.mark.parametrize(
    "original,suggested,reason",
    [
        (
            "Built the ingestion pipeline",
            "Engineered the ingestion pipeline using Kafka",
            "Kafka is on the candidate's own skills line",
        ),
        (
            "Improved latency by 34 percent",
            "Reduced p99 latency 34% using Go",
            "p99 is notation, and 34 is the candidate's own figure",
        ),
        (
            "Processed 500,000 events daily",
            "Engineered a pipeline processing 500k events daily",
            "500k and 500,000 are one claim in two notations",
        ),
        (
            "Cut costs 20% and errors 5%",
            "Reduced infrastructure costs 20%",
            "dropping a metric is not adding one",
        ),
        (
            "Was responsible for the deploy process",
            "Automated the deploy process using Terraform",
            "a pure reframe, no new claim",
        ),
        (
            "Secured the API with OAuth2 on Kubernetes",
            "Hardened the API using OAuth2 on Kubernetes",
            "OAuth2 and K8s-style identifiers are names, not quantities",
        ),
    ],
)
def test_faithful_reframing_is_accepted(original: str, suggested: str, reason: str) -> None:
    """The false-positive half, which matters more than the true-positive half.

    A guard that rejects honest rewrites gets switched off, and then it
    protects nobody.
    """
    verdict = guards.verify_suggestion(original, suggested, REAL_RESUME)
    assert verdict["ok"], f"should have been accepted ({reason}): {verdict['violations']}"


def test_review_splits_and_never_returns_a_rejection() -> None:
    accepted, rejected = guards.review_suggestions(
        [
            {"original": "Built the ingestion pipeline", "suggested": "Engineered the pipeline using Kafka"},
            {"original": "Kept it running", "suggested": "Maintained 99.99% uptime"},
            {"original": "", "suggested": "Something unverifiable"},
        ],
        REAL_RESUME,
    )
    assert len(accepted) == 1 and len(rejected) == 2
    assert all("rejection" in item for item in rejected)
    assert all("99.99" not in (item.get("suggested") or "") for item in accepted)


def test_structure_grades_the_faang_shape() -> None:
    """[Action Verb] + [Quantified Metric] + [Technical Tool], all three."""
    full = guards.structure("Reduced p99 latency 34% using Go")
    assert full == {
        "action_verb": True,
        "quantified_metric": True,
        "technical_tool": True,
        "components": 3,
    }

    weak = guards.structure("Was responsible for the deployment process")
    assert weak["components"] == 0


# ── the stuffing detector ───────────────────────────────────────────────────

def test_real_resume_is_not_flagged() -> None:
    verdict = integrity.assess(REAL_RESUME, JD)
    assert verdict["checked"]
    assert not verdict["stuffed"], f"false positive on an honest resume: {verdict['signals']}"


def test_honest_but_very_on_target_resume_is_not_flagged() -> None:
    """The nearest honest neighbour to a stuffed document.

    Someone whose background genuinely matches the posting runs a high keyword
    density for legitimate reasons. Measured at 10.5% against a 30% limit.
    """
    on_target = REAL_RESUME + (
        "\nAdditional: deep experience with Kubernetes, Docker, Terraform and AWS across "
        "microservices and distributed systems, including gRPC and observability tooling.\n"
    )
    assert not integrity.assess(on_target, JD)["stuffed"]


def test_keyword_dump_is_flagged() -> None:
    verdict = integrity.assess(KEYWORD_DUMP, JD)
    assert verdict["stuffed"]
    assert {"keyword_density", "max_repetition"} <= {s["signal"] for s in verdict["signals"]}


def test_padded_real_resume_is_flagged() -> None:
    padded = REAL_RESUME + (
        "\nPython Go Kubernetes Docker PostgreSQL Redis Kafka Terraform AWS gRPC "
        "microservices distributed systems"
    ) * 20
    assert integrity.assess(padded, JD)["stuffed"]


def test_pasted_job_description_is_flagged_by_verbatim_overlap() -> None:
    """The case the density check alone misses.

    A posting pasted back scored 88 from the trained model — the highest of
    anything measured, higher than a real resume with real achievements. Its
    keyword density is only 28%, under the 30% limit, so the 8-gram overlap
    signal is the one that has to catch it.
    """
    verdict = integrity.assess(JD * 8, JD)
    assert verdict["stuffed"]
    assert "verbatim_overlap" in {s["signal"] for s in verdict["signals"]}


def test_short_documents_report_unchecked_rather_than_clean() -> None:
    """An unmeasured document must never come back as passing."""
    verdict = integrity.assess("Jane Doe, engineer.", JD)
    assert verdict["checked"] is False
    assert verdict["stuffed"] is False  # not an accusation
    assert verdict["reason"], "an unchecked verdict has to say why"


def test_stuffed_scores_are_not_reportable() -> None:
    stuffed = integrity.assess(KEYWORD_DUMP, JD)
    result = integrity.trustworthy_score(86.0, stuffed)
    assert result["trusted"] is False
    assert result["reportable"] is None
    assert result["raw"] == 86.0, "the raw number stays inspectable"
    assert result["reason"]

    clean = integrity.assess(REAL_RESUME, JD)
    passed = integrity.trustworthy_score(62.0, clean)
    assert passed["trusted"] and passed["reportable"] == 62.0


def test_assessment_is_deterministic() -> None:
    """Same input, same verdict — the property that makes this auditable."""
    first = integrity.assess(REAL_RESUME, JD)
    second = integrity.assess(REAL_RESUME, JD)
    assert first == second
