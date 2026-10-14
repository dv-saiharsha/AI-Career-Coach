"""Score the JD analyzer against the hand-written golden set, with the real model.

    ANTHROPIC_API_KEY= python scripts/evaluate_jd_analyzer.py            # the 6 golden JDs
    ANTHROPIC_API_KEY= python scripts/evaluate_jd_analyzer.py --all      # then all 17 seed JDs
    ANTHROPIC_API_KEY= python scripts/evaluate_jd_analyzer.py --json out.json

Each JD is analysed with the cache off, through the same service the app uses
(whatever LLM_PROVIDER selects; Ollama by default). Nothing is written to a
database. The golden files are tests/fixtures/jd_golden/*.json; their README says
how each field was annotated.

Per golden JD and pooled over all of them:
  required-skill precision and recall (an either/or group counts as found when
  one member is found, and every member counts as correct), hallucinations (a
  "forbidden" item anywhere in the output), either/or groups found correctly,
  seniority + its source, min_years, education and certifications including the
  required flag, job-title leaks, skills dropped by the evidence check, the
  source of the analysis, and seconds.

Targets: required recall >= 0.80, precision >= 0.85, zero hallucinations,
zero job-title leaks.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.llm import llm_client  # noqa: E402
from app.core.taxonomy import canonical  # noqa: E402
from app.modules.jd_analyzer import rules, service  # noqa: E402
from app.modules.jd_analyzer.schemas import JDAnalysis  # noqa: E402
from scripts.seed_job_descriptions import SEED_JOB_DESCRIPTIONS  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "jd_golden"
SEED = {j["id"]: j for j in SEED_JOB_DESCRIPTIONS}
RECALL_TARGET, PRECISION_TARGET = 0.80, 0.85


def load_golden(folder: Path = FIXTURES) -> list[dict]:
    docs = []
    for path in sorted(folder.glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["text"] = doc["jd_text"] if doc.get("synthetic") else SEED[doc["jd_id"]]["text"]
        docs.append(doc)
    return docs


def _flat(text: str) -> list[str]:
    return [w for w in re.sub(r"[^a-z0-9+#]+", " ", text.lower()).split() if len(w) >= 3]


def same_name(a: str, b: str) -> bool:
    """Whether two certification / degree names are the same thing: one contains
    the other, or they share at least 60% of the words of the shorter."""
    fa, fb = _flat(a), _flat(b)
    if not fa or not fb:
        return False
    if " ".join(fa) in " ".join(fb) or " ".join(fb) in " ".join(fa):
        return True
    shared = len(set(fa) & set(fb))
    return shared / min(len(set(fa)), len(set(fb))) >= 0.6


def requirements_correct(golden: list[dict], output: list) -> tuple[bool, str]:
    """Every golden item found with the right required flag, and nothing extra."""
    notes = []
    unmatched = list(output)
    for item in golden:
        match = next((o for o in unmatched if same_name(item["name"], o.name)), None)
        if match is None:
            notes.append(f"missing {item['name']!r}")
            continue
        unmatched.remove(match)
        if match.required != item["required"]:
            notes.append(f"{item['name']!r} required={match.required}, expected {item['required']}")
    notes += [f"extra {o.name!r}" for o in unmatched]
    return (not notes), "; ".join(notes)


def hallucinations(analysis: JDAnalysis, forbidden: list[str]) -> list[str]:
    """Forbidden items anywhere in the output: skill, tool and keyword names by
    canonical equality, and whole words in the free-text fields."""
    names = {s.name for s in analysis.required_skills + analysis.preferred_skills}
    names |= set(analysis.tools_technologies) | {canonical(k.term) for k in analysis.ats_keywords}
    names |= {canonical(r.name) for r in analysis.education + analysis.certifications}
    free_text = " ".join(analysis.responsibilities + [r.evidence for r in analysis.education + analysis.certifications])
    found = []
    for item in forbidden:
        hit = item in names
        if not hit and len(item) >= 3:
            hit = bool(re.search(r"(?<![a-z0-9+#])" + re.escape(item) + r"(?![a-z0-9+#])", free_text.lower()))
        if hit:
            found.append(item)
    return found


def score(doc: dict, analysis: JDAnalysis, report) -> dict:
    e = doc["expected"]
    golden_required = e["required_skills"]
    golden_names = {s["name"] for s in golden_required}
    groups: dict[str, set[str]] = {}
    singles: set[str] = set()
    for s in golden_required:
        (groups.setdefault(s["alternative_group"], set()).add(s["name"]) if s["alternative_group"] else singles.add(s["name"]))

    out_names = [s.name for s in analysis.required_skills]
    out = set(out_names)
    found_singles = singles & out
    found_groups = [g for g, members in groups.items() if members & out]
    items = len(singles) + len(groups)
    recall = (len(found_singles) + len(found_groups)) / items if items else 1.0
    correct = [n for n in out_names if n in golden_names]
    precision = len(correct) / len(out_names) if out_names else (1.0 if not golden_names else 0.0)

    golden_pref = {s["name"] for s in e["preferred_skills"]} | set(e["tools_technologies"])
    false_pos = [n for n in out_names if n not in golden_names]
    missed = sorted(singles - out) + [f"one of {sorted(m)}" for g, m in groups.items() if not m & out]

    out_groups: dict[str, set[str]] = {}
    for s in analysis.required_skills:
        if s.alternative_group:
            out_groups.setdefault(s.alternative_group, set()).add(s.name)
    groups_correct = 0
    for members in groups.values():
        present = members & out
        labels = {s.alternative_group for s in analysis.required_skills if s.name in present}
        if len(present) >= 2 and len(labels) == 1 and None not in labels:
            label = next(iter(labels))
            if out_groups.get(label, set()) <= members:
                groups_correct += 1

    edu_ok, edu_note = requirements_correct(e["education"], analysis.education)
    cert_ok, cert_note = requirements_correct(e["certifications"], analysis.certifications)
    title_forms = rules.title_forms(analysis.job_title) | rules.title_forms(e["job_title"])
    leaks = [n for n in out | {s.name for s in analysis.preferred_skills} | set(analysis.tools_technologies) if n in title_forms]

    return {
        "jd_id": doc["jd_id"], "source": analysis.source, "seconds": report.seconds,
        "required_out": len(out_names), "recall": recall, "precision": precision,
        "recall_found": len(found_singles) + len(found_groups), "recall_items": items,
        "precision_correct": len(correct), "precision_out": len(out_names),
        "missed": missed,
        "false_positives": [f"{n} (golden preferred/tool)" if n in golden_pref else n for n in false_pos],
        "hallucinations": hallucinations(analysis, doc["forbidden_skills"]),
        "groups_correct": groups_correct, "groups_total": len(groups),
        "seniority_ok": analysis.seniority == e["seniority"], "seniority": analysis.seniority,
        "seniority_source_ok": analysis.seniority_source == e["seniority_source"], "seniority_source": analysis.seniority_source,
        "years_ok": analysis.min_years_experience == e["min_years_experience"], "years": analysis.min_years_experience,
        "education_ok": edu_ok, "education_note": edu_note,
        "certifications_ok": cert_ok, "certifications_note": cert_note,
        "title_ok": analysis.job_title == e["job_title"], "title": analysis.job_title,
        "title_leaks": leaks, "stripped_title_leaks": list(report.title_leaks),
        "dropped_by_evidence": list(report.dropped_by_evidence), "rejected": list(report.rejected),
        "rule_additions": list(report.rule_additions), "moved_to_tools": list(report.moved_to_tools),
        "attempts": report.attempts,
        "llm_error": report.llm_error,
    }


def yn(flag: bool) -> str:
    return "yes" if flag else "NO"


def print_golden(rows: list[dict]) -> dict:
    print("\n== PER JD ==")
    header = f"{'JD':32} {'src':6} {'sec':>5} {'prec':>5} {'recl':>5} {'hall':>4} {'grp':>5} {'sen':>4} {'srcOK':>5} {'yrs':>4} {'edu':>4} {'cert':>4} {'leak':>4} {'drop':>4}"
    print(header)
    for r in rows:
        print(
            f"{r['jd_id']:32} {r['source']:6} {r['seconds']:5.1f} {r['precision']:5.2f} {r['recall']:5.2f} "
            f"{len(r['hallucinations']):4d} {r['groups_correct']}/{r['groups_total']:<3} {yn(r['seniority_ok']):>4} "
            f"{yn(r['seniority_source_ok']):>5} {yn(r['years_ok']):>4} {yn(r['education_ok']):>4} {yn(r['certifications_ok']):>4} "
            f"{len(r['title_leaks']):4d} {len(r['dropped_by_evidence']):4d}"
        )
    pooled = {
        "recall": sum(r["recall_found"] for r in rows) / max(1, sum(r["recall_items"] for r in rows)),
        "precision": sum(r["precision_correct"] for r in rows) / max(1, sum(r["precision_out"] for r in rows)),
        "hallucinations": sum(len(r["hallucinations"]) for r in rows),
        "groups": (sum(r["groups_correct"] for r in rows), sum(r["groups_total"] for r in rows)),
        "seniority": sum(r["seniority_ok"] for r in rows), "seniority_source": sum(r["seniority_source_ok"] for r in rows),
        "years": sum(r["years_ok"] for r in rows), "education": sum(r["education_ok"] for r in rows),
        "certifications": sum(r["certifications_ok"] for r in rows), "title": sum(r["title_ok"] for r in rows),
        "title_leaks": sum(len(r["title_leaks"]) for r in rows),
        "dropped": sum(len(r["dropped_by_evidence"]) for r in rows),
        "seconds": sum(r["seconds"] for r in rows), "n": len(rows),
    }
    p = pooled
    print("\n== OVERALL (pooled over all skills) ==")
    print(f"required-skill recall    {p['recall']:.3f}   target >= {RECALL_TARGET}   {'PASS' if p['recall'] >= RECALL_TARGET else 'BELOW TARGET'}")
    print(f"required-skill precision {p['precision']:.3f}   target >= {PRECISION_TARGET}   {'PASS' if p['precision'] >= PRECISION_TARGET else 'BELOW TARGET'}")
    print(f"hallucinations           {p['hallucinations']}       target 0      {'PASS' if p['hallucinations'] == 0 else 'FAIL'}")
    print(f"job-title leaks          {p['title_leaks']}       target 0      {'PASS' if p['title_leaks'] == 0 else 'FAIL'}")
    print(f"either/or groups found   {p['groups'][0]}/{p['groups'][1]}")
    print(f"seniority correct        {p['seniority']}/{p['n']}   seniority_source correct {p['seniority_source']}/{p['n']}   min_years correct {p['years']}/{p['n']}   title correct {p['title']}/{p['n']}")
    print(f"education correct        {p['education']}/{p['n']}   certifications correct {p['certifications']}/{p['n']}")
    print(f"skills dropped by the evidence check {p['dropped']}   total time {p['seconds']:.0f}s ({p['seconds'] / p['n']:.0f}s per JD)")

    print("\n== THE MISSES, PER JD ==")
    for r in rows:
        lines = []
        if r["missed"]:
            lines.append(f"  missed required      : {r['missed']}")
        if r["false_positives"]:
            lines.append(f"  required, not golden : {r['false_positives']}")
        if r["hallucinations"]:
            lines.append(f"  HALLUCINATED         : {r['hallucinations']}")
        if not r["seniority_ok"] or not r["seniority_source_ok"]:
            lines.append(f"  seniority            : got {r['seniority']}/{r['seniority_source']}")
        if not r["years_ok"]:
            lines.append(f"  min_years            : got {r['years']}")
        if not r["title_ok"]:
            lines.append(f"  title                : got {r['title']!r}")
        if not r["education_ok"]:
            lines.append(f"  education            : {r['education_note']}")
        if not r["certifications_ok"]:
            lines.append(f"  certifications       : {r['certifications_note']}")
        if r["dropped_by_evidence"]:
            lines.append(f"  dropped by evidence  : {r['dropped_by_evidence']}")
        if r["rejected"]:
            lines.append(f"  rejected by validators: {r['rejected']}")
        if r["moved_to_tools"]:
            lines.append(f"  moved to tools       : {r['moved_to_tools']}")
        if r["rule_additions"]:
            lines.append(f"  added by the rules   : {r['rule_additions']}")
        if r["stripped_title_leaks"]:
            lines.append(f"  title leaks stripped : {r['stripped_title_leaks']}")
        if r["llm_error"]:
            lines.append(f"  model error          : {r['llm_error']}")
        print(f"{r['jd_id']}" + ("" if lines else "  (no misses)"))
        print("\n".join(lines))
    return pooled


def run_all_seeds(golden_rows: dict[str, dict]) -> list[dict]:
    print("\n== ALL 17 SEED JDs ==")
    print(f"{'JD':30} {'src':6} {'sec':>5} {'req':>3} {'pref':>4} {'drop':>4} {'tries':>5}  {'level/source':14} {'yrs':>3} {'title':>5}  failures")
    rows = []
    for doc in SEED_JOB_DESCRIPTIONS:
        jd_id, text = doc["id"], doc["text"]
        failure = []
        try:
            analysis, report = service.analyze_with_report(text, use_cache=False)
        except Exception as exc:  # noqa: BLE001 - the point of this run is to find failures
            print(f"{jd_id:30} EXCEPTION {type(exc).__name__}: {exc}")
            rows.append({"jd_id": jd_id, "failure": [f"exception {type(exc).__name__}"]})
            continue
        if analysis.source == "rules":
            failure.append(f"model path failed ({report.llm_error})")
        if not analysis.required_skills:
            failure.append("no required skills")
        title_ok = analysis.job_title == rules.title_from_text(text)
        if not title_ok:
            failure.append(f"title {analysis.job_title!r}")
        if report.title_leaks or {s.name for s in analysis.required_skills + analysis.preferred_skills} & rules.title_forms(analysis.job_title):
            failure.append("title leak")
        label = doc["seniority"]
        # Anything named in the output that the posting does not mention.
        from app.core.skill_match import named_in

        claimed = [s.name for s in analysis.required_skills + analysis.preferred_skills] + list(analysis.tools_technologies)
        unsupported = [n for n in claimed if not named_in(text, n)]
        unsupported += [r.name for r in analysis.education + analysis.certifications if r.evidence.lower() not in " ".join(text.split()).lower()]
        if unsupported:
            failure.append(f"not in the posting: {unsupported}")
        if label in ("junior", "senior") and analysis.seniority != label:
            failure.append(f"level {analysis.seniority} vs seed label {label}")
        if label == "mid" and (analysis.seniority, analysis.seniority_source) != ("mid", "years"):
            failure.append(f"level {analysis.seniority}/{analysis.seniority_source} vs seed label mid")
        row = {
            "jd_id": jd_id, "source": analysis.source, "seconds": report.seconds, "required": len(analysis.required_skills),
            "preferred": len(analysis.preferred_skills), "dropped": len(report.dropped_by_evidence), "attempts": report.attempts,
            "level": f"{analysis.seniority}/{analysis.seniority_source}", "years": analysis.min_years_experience,
            "title_ok": title_ok, "failure": failure, "golden": jd_id in golden_rows,
        }
        rows.append(row)
        print(
            f"{jd_id:30} {analysis.source:6} {report.seconds:5.1f} {row['required']:3d} {row['preferred']:4d} {row['dropped']:4d} "
            f"{report.attempts:5d}  {row['level']:14} {str(row['years']):>3} {yn(title_ok):>5}  {'; '.join(failure) or '-'}"
        )
    failures = [r for r in rows if r["failure"]]
    print(f"\n{len(rows) - len(failures)}/{len(rows)} analysed with no failure; {len(failures)} with at least one")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--all", action="store_true", help="also run all 17 seed JDs")
    parser.add_argument("--json", metavar="PATH", help="write the results as JSON")
    parser.add_argument("--holdout", action="store_true", help="score the holdout set (tests/fixtures/jd_holdout) instead of the golden set")
    args = parser.parse_args()

    print(f"provider={llm_client.provider} model={getattr(llm_client, 'model', None)} available={llm_client.available}")
    if not llm_client.available:
        print("no model available: this evaluates the model, so there is nothing to run")
        return 2

    golden_rows = []
    folder = FIXTURES.parent / "jd_holdout" if args.holdout else FIXTURES
    print(f"set: {folder.name}")
    for doc in load_golden(folder):
        analysis, report = service.analyze_with_report(doc["text"], use_cache=False)
        golden_rows.append(score(doc, analysis, report))
        print(f"  analysed {doc['jd_id']} ({report.seconds:.0f}s, {analysis.source})", flush=True)
    pooled = print_golden(golden_rows)
    seed_rows = run_all_seeds({r["jd_id"]: r for r in golden_rows}) if args.all else None

    if args.json:
        Path(args.json).write_text(json.dumps({"golden": golden_rows, "pooled": pooled, "seeds": seed_rows}, indent=2, default=list))
    ok = pooled["recall"] >= RECALL_TARGET and pooled["precision"] >= PRECISION_TARGET and pooled["hallucinations"] == 0 and pooled["title_leaks"] == 0
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
