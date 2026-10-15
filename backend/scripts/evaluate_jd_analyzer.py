"""Score the JD analyzer against hand-written expected analyses, with the real model.

    ANTHROPIC_API_KEY= python scripts/evaluate_jd_analyzer.py --set golden --json run.json
    ANTHROPIC_API_KEY= python scripts/evaluate_jd_analyzer.py --set holdout --json run.json
    ANTHROPIC_API_KEY= python scripts/evaluate_jd_analyzer.py --all     # also the 17 seed JDs
    python scripts/evaluate_jd_analyzer.py --rescore run.json           # offline, no model

Sets are folders under tests/fixtures/: golden (jd_golden), holdout (jd_holdout),
or any other jd_<name> folder. Each JD is analysed with the cache off, through
the same service the app uses (whatever LLM_PROVIDER selects; Ollama by
default). Nothing is written to a database. --json saves every analysis in full,
so a run can be scored again later (--rescore) without calling the model.

Metrics, per JD and pooled over every annotated skill:
  found_recall     golden required skills found anywhere in the output
                   (required OR preferred). An either/or group counts as found
                   when one member is found.
  bucket_accuracy  of those found, the share the output put in required.
  precision        of the output's required skills, the share that match a
                   golden required skill (every member of a group is correct).
  hallucinations   a "forbidden" item (one the JD does not say) anywhere in the
                   output: skills, tools, keywords, requirements, responsibilities.
  title leaks      the job title as a skill or tool.
plus either/or groups, seniority and its source, min_years, education and
certifications (with the required flag), skills dropped by the evidence check,
the source of the analysis, and seconds.

Skill names match when their canonical forms are equal, or one contains the
other as whole words ("encryption" and "encryption at rest"), unless the
shorter one is a single generic word (GENERIC_WORDS: "cloud" does not match
"cloud security"). The same rule for every skill metric and every set; --match exact turns containment off, for
comparison. Hallucinations always need the forbidden name itself (equal
canonical forms): a forbidden "aws" is not hit by "aws sagemaker".

Targets: found_recall >= 0.80, precision >= 0.85, hallucinations 0, title
leaks 0. bucket_accuracy is reported, not a gate.
"""

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.taxonomy import canonical  # noqa: E402
from app.modules.jd_analyzer import rules  # noqa: E402
from scripts.seed_job_descriptions import SEED_JOB_DESCRIPTIONS  # noqa: E402

FIXTURES = Path(__file__).resolve().parent.parent / "tests" / "fixtures"
SEED = {j["id"]: j for j in SEED_JOB_DESCRIPTIONS}
RECALL_TARGET, PRECISION_TARGET = 0.80, 0.85


def load_set(name: str) -> list[dict]:
    docs = []
    for path in sorted((FIXTURES / f"jd_{name}").glob("*.json")):
        doc = json.loads(path.read_text(encoding="utf-8"))
        doc["text"] = doc.get("jd_text") or SEED[doc["jd_id"]]["text"]
        if doc.get("listing"):
            # A crawled listing is analysed as the app analyses it: title, then description.
            from app.modules.jd_analyzer.service import listing_text

            doc["text"] = listing_text(doc["listing"]["title"], doc["jd_text"])
        docs.append(doc)
    return docs


MATCH_RULE = "containment"  # or "exact"; set from --match

# Single words that name a category or a field, not a skill. A containment match
# never rests on one of these as the shorter name. The category nouns the
# analyzer also rejects, plus broad field words; defined here, by category, not
# from any run's output.
GENERIC_WORDS = frozenset({
    "application", "applications", "code", "data", "environment", "environments", "experience", "framework",
    "frameworks", "fundamentals", "knowledge", "language", "languages", "libraries", "library", "platform",
    "platforms", "practice", "practices", "process", "processes", "product", "products", "project", "projects",
    "service", "services", "skill", "skills", "software", "solution", "solutions", "stack", "system", "systems",
    "team", "teams", "technologies", "technology", "tool", "tools",
    "ai", "ml", "cloud", "security", "engineering", "development", "design", "infrastructure", "analytics", "web",
    "testing", "programming", "computing", "automation", "operations", "research", "science", "model", "models",
})


def same_skill(a: str, b: str) -> bool:
    return canonical(a) == canonical(b)


def match(a: str, b: str) -> bool:
    """Equal canonical names, or (containment) one inside the other as whole words."""
    ca, cb = canonical(a), canonical(b)
    if not ca or not cb:
        return False
    if ca == cb:
        return True
    if MATCH_RULE != "containment":
        return False
    shorter = ca if len(ca) <= len(cb) else cb
    if " " not in shorter and shorter in GENERIC_WORDS:
        return False
    return f" {ca} " in f" {cb} " or f" {cb} " in f" {ca} "


def _words(text: str) -> list[str]:
    return [w for w in re.sub(r"[^a-z0-9+#]+", " ", text.lower()).split() if len(w) >= 3]


def same_requirement(a: str, b: str) -> bool:
    """Whether two certification / degree names are the same thing: one contains
    the other, or they share at least 60% of the words of the shorter."""
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    if " ".join(wa) in " ".join(wb) or " ".join(wb) in " ".join(wa):
        return True
    return len(set(wa) & set(wb)) / min(len(set(wa)), len(set(wb))) >= 0.6


def requirements_correct(golden: list[dict], output: list[dict]) -> tuple[bool, str]:
    """Every golden item found with the right required flag, and nothing extra."""
    notes = []
    unmatched = list(output)
    for item in golden:
        hit = next((o for o in unmatched if same_requirement(item["name"], o["name"])), None)
        if hit is None:
            notes.append(f"missing {item['name']!r}")
            continue
        unmatched.remove(hit)
        if hit["required"] != item["required"]:
            notes.append(f"{item['name']!r} required={hit['required']}, expected {item['required']}")
    notes += [f"extra {o['name']!r}" for o in unmatched]
    return (not notes), "; ".join(notes)


def score(doc: dict, out: dict, rep: dict) -> dict:
    """Score one saved analysis (a JDAnalysis as JSON) against its golden file."""
    e = doc["expected"]
    required_out = [s["name"] for s in out["required_skills"]]
    everything = required_out + [s["name"] for s in out["preferred_skills"]]

    singles: list[str] = []
    groups: dict[str, list[str]] = {}
    for s in e["required_skills"]:
        if s["alternative_group"]:
            groups.setdefault(s["alternative_group"], []).append(s["name"])
        else:
            singles.append(s["name"])
    items = [[n] for n in singles] + list(groups.values())

    def hit(members: list[str], pool: list[str]) -> bool:
        return any(match(m, o) for m in members for o in pool)

    found = [m for m in items if hit(m, everything)]
    found_required = [m for m in found if hit(m, required_out)]

    golden_required = [s["name"] for s in e["required_skills"]]
    correct = [o for o in required_out if any(match(o, g) for g in golden_required)]
    golden_other = [s["name"] for s in e["preferred_skills"]] + list(e["tools_technologies"])
    false_pos = [
        f"{o} (golden preferred/tool)" if any(match(o, g) for g in golden_other) else o
        for o in required_out if o not in correct
    ]

    # Either/or groups: the members present share one non-null label, and that
    # label holds nothing outside the golden group.
    label_of = {s["name"]: s["alternative_group"] for s in out["required_skills"] + out["preferred_skills"]}
    groups_correct = 0
    for members in groups.values():
        present = [o for o in everything if any(match(o, m) for m in members)]
        labels = {label_of[o] for o in present}
        if len(present) >= 2 and len(labels) == 1 and None not in labels:
            label = next(iter(labels))
            if all(any(match(n, m) for m in members) for n, lbl in label_of.items() if lbl == label):
                groups_correct += 1

    names = everything + list(out["tools_technologies"]) + [k["term"] for k in out["ats_keywords"]]
    names += [r["name"] for r in out["education"] + out["certifications"]]
    free_text = " ".join(out["responsibilities"] + [r["evidence"] for r in out["education"] + out["certifications"]]).lower()
    halluc = [
        f for f in doc["forbidden_skills"]
        if any(same_skill(f, n) for n in names)
        or (len(f) >= 3 and re.search(r"(?<![a-z0-9+#])" + re.escape(f) + r"(?![a-z0-9+#])", free_text))
    ]

    title_forms = rules.title_forms(out["job_title"]) | rules.title_forms(e["job_title"])
    leaks = [n for n in everything + list(out["tools_technologies"]) if n in title_forms]
    edu_ok, edu_note = requirements_correct(e["education"], out["education"])
    cert_ok, cert_note = requirements_correct(e["certifications"], out["certifications"])

    return {
        "jd_id": doc["jd_id"], "source": out["source"], "seconds": rep.get("seconds", 0.0),
        "items": len(items), "found": len(found), "found_required": len(found_required),
        "found_recall": len(found) / len(items) if items else 1.0,
        "bucket_accuracy": len(found_required) / len(found) if found else 1.0,
        "precision_correct": len(correct), "precision_out": len(required_out),
        "precision": len(correct) / len(required_out) if required_out else (1.0 if not golden_required else 0.0),
        "missed": [" / ".join(m) for m in items if m not in found],
        "misbucketed": [" / ".join(m) for m in found if m not in found_required],
        "false_positives": false_pos, "hallucinations": halluc,
        "groups_correct": groups_correct, "groups_total": len(groups),
        "seniority_ok": out["seniority"] == e["seniority"], "seniority": out["seniority"],
        "seniority_source_ok": out["seniority_source"] == e["seniority_source"], "seniority_source": out["seniority_source"],
        "years_ok": out["min_years_experience"] == e["min_years_experience"], "years": out["min_years_experience"],
        "education_ok": edu_ok, "education_note": edu_note, "certifications_ok": cert_ok, "certifications_note": cert_note,
        "title_ok": out["job_title"] == e["job_title"], "title": out["job_title"], "title_leaks": leaks,
        "report": rep,
    }


def yn(flag: bool) -> str:
    return "yes" if flag else "NO"


def print_rows(rows: list[dict], label: str) -> dict:
    print(f"\n== {label}: PER JD ==")
    print(f"{'JD':32} {'src':6} {'sec':>5} {'fRecl':>5} {'bAcc':>5} {'prec':>5} {'hall':>4} {'grp':>5} {'sen':>4} {'srcOK':>5} {'yrs':>4} {'edu':>4} {'cert':>4} {'leak':>4} {'drop':>4}")
    for r in rows:
        print(
            f"{r['jd_id'][:32]:32} {r['source']:6} {r['seconds']:5.1f} {r['found_recall']:5.2f} {r['bucket_accuracy']:5.2f} "
            f"{r['precision']:5.2f} {len(r['hallucinations']):4d} {r['groups_correct']}/{r['groups_total']:<3} "
            f"{yn(r['seniority_ok']):>4} {yn(r['seniority_source_ok']):>5} {yn(r['years_ok']):>4} {yn(r['education_ok']):>4} "
            f"{yn(r['certifications_ok']):>4} {len(r['title_leaks']):4d} {len(r['report'].get('dropped_by_evidence') or []):4d}"
        )
    n = len(rows)
    items, found = sum(r["items"] for r in rows), sum(r["found"] for r in rows)
    found_req = sum(r["found_required"] for r in rows)
    pc, po = sum(r["precision_correct"] for r in rows), sum(r["precision_out"] for r in rows)
    p = {
        "found_recall": found / max(1, items), "bucket_accuracy": found_req / max(1, found), "precision": pc / max(1, po),
        "hallucinations": sum(len(r["hallucinations"]) for r in rows), "title_leaks": sum(len(r["title_leaks"]) for r in rows),
        "seconds": sum(r["seconds"] for r in rows), "n": n,
    }
    print(f"\n== {label}: OVERALL (pooled) ==")
    print(f"found_recall     {p['found_recall']:.3f} ({found}/{items})   target >= {RECALL_TARGET}   {'PASS' if p['found_recall'] >= RECALL_TARGET else 'BELOW TARGET'}")
    print(f"bucket_accuracy  {p['bucket_accuracy']:.3f} ({found_req}/{found})   reported, not a gate")
    print(f"precision        {p['precision']:.3f} ({pc}/{po})   target >= {PRECISION_TARGET}   {'PASS' if p['precision'] >= PRECISION_TARGET else 'BELOW TARGET'}")
    print(f"hallucinations   {p['hallucinations']}   target 0   {'PASS' if p['hallucinations'] == 0 else 'FAIL'}")
    print(f"title leaks      {p['title_leaks']}   target 0   {'PASS' if p['title_leaks'] == 0 else 'FAIL'}")
    print(
        f"either/or groups {sum(r['groups_correct'] for r in rows)}/{sum(r['groups_total'] for r in rows)}   "
        f"seniority {sum(r['seniority_ok'] for r in rows)}/{n}   source {sum(r['seniority_source_ok'] for r in rows)}/{n}   "
        f"years {sum(r['years_ok'] for r in rows)}/{n}   title {sum(r['title_ok'] for r in rows)}/{n}   "
        f"education {sum(r['education_ok'] for r in rows)}/{n}   certifications {sum(r['certifications_ok'] for r in rows)}/{n}"
    )
    second = sum(r["report"].get("second_call_seconds") or 0.0 for r in rows)
    print(f"time {p['seconds']:.0f}s ({p['seconds'] / max(1, n):.0f}s per JD), of which the 2nd call {second:.0f}s ({second / max(1, n):.1f}s per JD)")

    print(f"\n== {label}: DETAILS PER JD ==")
    for r in rows:
        rep = r["report"]
        lines = [f"  {title:22}: {r[key]}" for key, title in [
            ("missed", "missed (not found)"), ("misbucketed", "found, but preferred"),
            ("false_positives", "required, not golden"), ("hallucinations", "HALLUCINATED"),
        ] if r[key]]
        if not r["seniority_ok"] or not r["seniority_source_ok"]:
            lines.append(f"  {'seniority':22}: {r['seniority']}/{r['seniority_source']}")
        if not r["years_ok"]:
            lines.append(f"  {'min_years':22}: {r['years']}")
        if not r["title_ok"]:
            lines.append(f"  {'title':22}: {r['title']!r}")
        lines += [f"  {title:22}: {r[key]}" for key, title in [("education_note", "education"), ("certifications_note", "certifications")] if r[key]]
        lines += [f"  {title:22}: {rep[key]}" for key, title in [
            ("dropped_by_evidence", "dropped by evidence"), ("rejected", "rejected (validators)"),
            ("moved_to_tools", "moved to tools"), ("moved_to_preferred", "moved to preferred"),
            ("rule_additions", "added by the rules"),
            ("title_leaks", "title leaks stripped"), ("second_call_added", "added by 2nd call"),
            ("second_call_error", "2nd call error"), ("llm_error", "model error"),
        ] if rep.get(key)]
        print(r["jd_id"] + ("" if lines else "  (nothing to report)"))
        if lines:
            print("\n".join(lines))
    return p


def analyse(text: str) -> tuple[dict, dict]:
    from app.modules.jd_analyzer import service

    analysis, report = service.analyze_with_report(text, use_cache=False)
    return analysis.model_dump(mode="json"), {k: (list(v) if isinstance(v, (list, set, tuple)) else v) for k, v in vars(report).items()}


def run_all_seeds() -> list[dict]:
    from app.core.skill_match import named_in

    print("\n== ALL 17 SEED JDs: crashes, and anything not in the posting ==")
    print(f"{'JD':30} {'src':6} {'sec':>5} {'req':>3} {'pref':>4} {'drop':>4}  {'level/source':14} {'yrs':>3}  failures")
    rows = []
    for doc in SEED_JOB_DESCRIPTIONS:
        jd_id, text = doc["id"], doc["text"]
        try:
            out, rep = analyse(text)
        except Exception as exc:  # noqa: BLE001 - finding crashes is the point of this run
            print(f"{jd_id:30} EXCEPTION {type(exc).__name__}: {exc}")
            rows.append({"jd_id": jd_id, "failure": [f"exception {type(exc).__name__}"]})
            continue
        failure = []
        if out["source"] == "rules":
            failure.append(f"model path failed ({rep.get('llm_error')})")
        claimed = [s["name"] for s in out["required_skills"] + out["preferred_skills"]] + list(out["tools_technologies"])
        unsupported = [n for n in claimed if not named_in(text, n)]
        flat = " ".join(text.split()).lower()
        unsupported += [r["name"] for r in out["education"] + out["certifications"] if r["evidence"].lower() not in flat]
        if unsupported:
            failure.append(f"not in the posting: {unsupported}")
        if {s["name"] for s in out["required_skills"] + out["preferred_skills"]} & rules.title_forms(out["job_title"]):
            failure.append("title leak")
        rows.append({"jd_id": jd_id, "failure": failure, "output": out, "report": rep})
        print(
            f"{jd_id:30} {out['source']:6} {rep['seconds']:5.1f} {len(out['required_skills']):3d} {len(out['preferred_skills']):4d} "
            f"{len(rep['dropped_by_evidence']):4d}  {out['seniority'] + '/' + out['seniority_source']:14} "
            f"{str(out['min_years_experience']):>3}  {'; '.join(failure) or '-'}"
        )
    bad = [r for r in rows if r["failure"]]
    print(f"\n{len(rows) - len(bad)}/{len(rows)} with no crash and nothing ungrounded")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", default="golden", help="fixture set: golden, holdout, or another jd_<name> folder")
    parser.add_argument("--holdout", action="store_true", help="same as --set holdout")
    parser.add_argument("--all", action="store_true", help="also run all 17 seed JDs (crash and grounding check)")
    parser.add_argument("--json", metavar="PATH", help="save the run, every analysis in full, as JSON")
    parser.add_argument("--rescore", metavar="PATH", help="score a saved run again, offline")
    parser.add_argument("--match", choices=["containment", "exact"], default="containment", help="skill-name matching rule")
    args = parser.parse_args()
    global MATCH_RULE
    MATCH_RULE = args.match
    set_name = "holdout" if args.holdout else args.set

    if args.rescore:
        saved = json.loads(Path(args.rescore).read_text())
        docs = {d["jd_id"]: d for d in load_set(saved["set"])}
        rows = [score(docs[r["jd_id"]], r["output"], r["report"]) for r in saved["runs"]]
        print(f"re-scored {args.rescore} (set {saved['set']}, saved {saved.get('saved_at')}), match={MATCH_RULE}")
        print_rows(rows, f"{saved['set'].upper()} [{MATCH_RULE}]")
        return 0

    from app.core.llm import llm_client

    print(f"provider={llm_client.provider} model={getattr(llm_client, 'model', None)} available={llm_client.available} set={set_name} match={MATCH_RULE}")
    if not llm_client.available:
        print("no model available: this evaluates the model, so there is nothing to run")
        return 2
    runs, rows = [], []
    for doc in load_set(set_name):
        out, rep = analyse(doc["text"])
        runs.append({"jd_id": doc["jd_id"], "output": out, "report": rep})
        rows.append(score(doc, out, rep))
        print(f"  analysed {doc['jd_id']} ({rep['seconds']:.0f}s, {out['source']})", flush=True)
    pooled = print_rows(rows, f"{set_name.upper()} [{MATCH_RULE}]")
    seeds = run_all_seeds() if args.all else None
    if args.json:
        Path(args.json).write_text(json.dumps(
            {"set": set_name, "saved_at": time.strftime("%Y-%m-%d %H:%M:%S"), "runs": runs, "pooled": pooled, "seeds": seeds},
            indent=1, default=list,
        ))
    ok = (pooled["found_recall"] >= RECALL_TARGET and pooled["precision"] >= PRECISION_TARGET
          and pooled["hallucinations"] == 0 and pooled["title_leaks"] == 0)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
