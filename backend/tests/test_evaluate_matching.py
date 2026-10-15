"""The evaluation's name-matching rule (scripts/evaluate_jd_analyzer.py)."""

import pytest

from scripts import evaluate_jd_analyzer as ev


@pytest.mark.parametrize("a,b,same", [
    ("risk assessments", "risk assessment", True),             # plural
    ("Service-Oriented Architectures", "service oriented architecture", True),
    ("libraries", "library", True),                             # -ies
    ("GenAI", "generative AI", True),                           # taxonomy alias
    ("IaC", "infrastructure as code", True),
    ("Kubernetes", "kubernetes", True),
    ("analysis", "analyses", False),                            # "-is" words are left alone
    ("encryption", "encryption at rest", True),                 # whole-word containment
    ("cloud", "cloud security", False),                         # never on a single generic word
    ("windowing functions", "window functions", False),         # a different word, not a plural
    ("java", "javascript", False),
])
def test_match(a, b, same):
    assert ev.match(a, b) is same


def test_exact_mode_still_singularises_but_never_contains(monkeypatch):
    monkeypatch.setattr(ev, "MATCH_RULE", "exact")
    assert ev.match("risk assessments", "risk assessment")
    assert not ev.match("encryption", "encryption at rest")
