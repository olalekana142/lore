"""RAG evaluation harness — a CORE subsystem, not a test utility.

Principle: **evidence before complexity.** No retrieval/architecture change ships because
it sounds better; it ships because this suite shows a measurable improvement without
unacceptable regressions in accuracy, citations, security, or latency.

    golden set ──► retrieval eval (recall@k · MRR · latency)
               └─► answer eval  (citation precision · faithfulness · abstention 2×2)
                        └─► failure categories ─► regression gate ─► ship / block

Run:
    python -m lore.eval             # retrieval A/B (dense vs hybrid) + security + latency
    python -m lore.eval --answers   # + answer-level (LLM) metrics & failure categories
    python -m lore.eval --gate      # answers + thresholds; exit 1 on regression (CI)
"""

from __future__ import annotations

import argparse
import sys
import time

from lore.graph.schema import get_connection, init_schema
from lore.retrieval.answer import retrieve, synthesize

COMPANY = "acme"
PUBLIC = ["everyone"]
HR = ["hr"]

# question · expected doc_ids · answer must contain · must NOT contain · groups · flags
GOLDEN: list[dict] = [
    {"q": "How many PTO days do full-time employees get?", "docs": ["upload:pto-policy"], "has": ["25"], "groups": PUBLIC},
    {"q": "How do I reset my Acme password?", "docs": ["upload:password-reset"], "groups": PUBLIC},
    {"q": "What extension do I call the IT Service Desk when locked out?", "docs": ["upload:password-reset"], "has": ["4357"], "groups": PUBLIC},
    {"q": "What is the daily meal reimbursement limit when traveling?", "docs": ["upload:expenses"], "has": ["60"], "groups": PUBLIC},
    {"q": "How much parental leave does the primary caregiver get?", "docs": ["upload:acme-parental-leave"], "has": ["16"], "groups": PUBLIC},
    {"q": "Can I use my personal phone for work?", "docs": ["upload:acme-byod"], "groups": PUBLIC},
    {"q": "How do I report a phishing email?", "docs": ["upload:security-incident"], "groups": PUBLIC},
    {"q": "Which days am I expected in the office?", "docs": ["upload:remote-work"], "groups": PUBLIC},
    {"q": "What is the 401k company match and when am I eligible?", "docs": ["upload:benefits"], "has": ["4"], "groups": PUBLIC},
    {"q": "What is the hotel cap for a trip to New York?", "docs": ["upload:travel-booking"], "has": ["350"], "groups": PUBLIC},
    {"q": "How many paid sick days do I get?", "docs": ["upload:sick-leave"], "has": ["10"], "groups": PUBLIC},
    {"q": "What is the home office stipend?", "docs": ["upload:remote-work"], "has": ["500"], "groups": PUBLIC},
    # --- adversarial: conflict / number-trap (FAQ says 20, current policy says 25) ---
    {"q": "How many PTO days are available?", "docs": ["upload:pto-policy"], "has": ["25"], "groups": PUBLIC, "adversarial": "conflict"},
    # --- adversarial: unsupported inference (source: managers MAY approve) ---
    {"q": "Since managers can approve remote work, is remote work guaranteed for every employee?", "docs": ["upload:remote-work"], "not": ["guaranteed for every", "all employees are guaranteed"], "groups": PUBLIC, "adversarial": "inference"},
    # --- abstain: restricted to 'hr' — a public user must NOT get an answer ---
    {"q": "What do Level 5 engineers earn?", "docs": [], "groups": PUBLIC, "abstain": True, "adversarial": "acl"},
    # --- abstain: genuinely not documented ---
    {"q": "Can I bring my dog to the office?", "docs": [], "groups": PUBLIC, "abstain": True},
    {"q": "What is the company parking policy?", "docs": [], "groups": PUBLIC, "abstain": True},
]


# --------------------------------------------------------------- retrieval eval
def retrieval_eval(conn, hybrid: bool) -> dict:
    answerable = [g for g in GOLDEN if not g.get("abstain")]
    hits = rr = 0.0
    lat: list[float] = []
    misses = []
    for g in answerable:
        t0 = time.perf_counter()
        r = retrieve(conn, COMPANY, g["q"], groups=g["groups"], hybrid=hybrid)
        lat.append((time.perf_counter() - t0) * 1000)
        ids = [s["doc_id"] for s in r["sources"]]
        rank = next((i + 1 for i, d in enumerate(ids) if d in g["docs"]), 0)
        if rank:
            hits += 1
            rr += 1 / rank
        else:
            misses.append(g["q"])
    n = len(answerable)
    lat.sort()
    return {
        "recall": hits / n, "mrr": rr / n, "n": n, "misses": misses,
        "p50": lat[len(lat) // 2], "p95": lat[int(len(lat) * 0.95)],
    }


def security_check(conn) -> dict:
    """ACL is enforced at retrieval: a public user must never see restricted facts."""
    q = "What do Level 5 engineers earn?"
    pub = retrieve(conn, COMPANY, q, groups=PUBLIC)
    hr = retrieve(conn, COMPANY, q, groups=HR)
    leaked = any("compensation" in s["doc_id"] for s in pub["sources"])
    hr_sees = any("compensation" in s["doc_id"] for s in hr["sources"])
    return {"public_leak": leaked, "hr_can_see": hr_sees, "pass": (not leaked) and hr_sees}


# --------------------------------------------------------------- answer eval
def _classify_miss(g, r, res) -> str:
    ids = [s["doc_id"] for s in r["sources"]]
    cited = {s["doc_id"] for s in res["sources"]}
    if not any(d in ids for d in g["docs"]):
        return "retrieval (correct source absent)"
    if ids and ids[0] not in g["docs"]:
        return "ranking (source present but not top)"
    if not (set(g["docs"]) & cited):
        return "citation (right evidence, cited wrong/none)"
    return "generation (evidence retrieved, answer wrong)"


def answer_eval(conn) -> dict:
    tp = ta = fa_answer = fa_abstain = 0          # abstention 2x2
    n_ans = n_abs = 0
    cite_prec_ok = 0
    fails = []
    for g in GOLDEN:
        r = retrieve(conn, COMPANY, g["q"], groups=g["groups"])
        res = synthesize(g["q"], r)
        text = res["answer"].lower()
        cited = {s["doc_id"] for s in res["sources"]}
        if g.get("abstain"):
            n_abs += 1
            if res["confidence"] == "none":
                ta += 1
            else:
                fa_answer += 1
                fails.append((g["q"], f"FALSE ANSWER on unanswerable ({g.get('adversarial','')})"))
        else:
            n_ans += 1
            has_ok = all(h.lower() in text for h in g.get("has", []))
            not_ok = all(n.lower() not in text for n in g.get("not", []))
            cite_ok = bool(set(g["docs"]) & cited)
            if res["confidence"] == "none":
                fa_abstain += 1
                fails.append((g["q"], "FALSE ABSTENTION (was answerable)"))
            elif has_ok and not_ok and cite_ok:
                tp += 1
                cite_prec_ok += 1
            else:
                fails.append((g["q"], _classify_miss(g, r, res)))
                if cite_ok:
                    cite_prec_ok += 1  # cited correctly even if answer text imperfect
    return {
        "n_ans": n_ans, "n_abs": n_abs,
        "answer_acc": tp / n_ans if n_ans else 0,
        "abstain_acc": ta / n_abs if n_abs else 0,
        "false_answers": fa_answer, "false_abstentions": fa_abstain,
        "citation_precision": cite_prec_ok / n_ans if n_ans else 0,
        "fails": fails,
    }


# ----------------------------------------------------------------------- runner
def main() -> None:
    ap = argparse.ArgumentParser(description="Lore RAG eval")
    ap.add_argument("--answers", action="store_true", help="run answer-level (LLM) metrics")
    ap.add_argument("--gate", action="store_true", help="enforce regression thresholds (CI); implies --answers")
    args = ap.parse_args()
    conn = init_schema(get_connection())

    print("=== Retrieval quality (A/B) ===")
    dense = retrieval_eval(conn, hybrid=False)
    hyb = retrieval_eval(conn, hybrid=True)
    print(f"  {'mode':8} {'recall@k':>9} {'MRR':>6} {'p50 ms':>8} {'p95 ms':>8}")
    for name, m in (("dense", dense), ("hybrid", hyb)):
        print(f"  {name:8} {m['recall']:>9.2f} {m['mrr']:>6.2f} {m['p50']:>8.0f} {m['p95']:>8.0f}")
    print(f"  ({hyb['n']} answerable questions)")
    if hyb["misses"]:
        print(f"  hybrid misses: {hyb['misses']}")

    sec = security_check(conn)
    print(f"\n=== Security (ACL @ retrieval) ===\n  public leak: {sec['public_leak']}  ·  hr can see: {sec['hr_can_see']}  ·  {'PASS ✓' if sec['pass'] else 'FAIL ✗'}")

    if args.answers or args.gate:
        print("\n=== Answer-level (hybrid) ===")
        a = answer_eval(conn)
        print(f"  answered correctly  : {a['answer_acc']:.2f}   ({a['n_ans']} answerable)")
        print(f"  citation precision  : {a['citation_precision']:.2f}")
        print(f"  abstention accuracy : {a['abstain_acc']:.2f}   ({a['n_abs']} unanswerable)")
        print(f"  false answers (hallucinated): {a['false_answers']}   ·   false abstentions: {a['false_abstentions']}")
        if a["fails"]:
            print("  failures by category:")
            for q, cat in a["fails"]:
                print(f"    - [{cat}]  {q}")

        if args.gate:
            ok = (sec["pass"] and a["false_answers"] == 0 and a["citation_precision"] >= 0.9
                  and hyb["recall"] >= 0.9 and a["abstain_acc"] >= 0.9)
            print(f"\n=== Regression gate: {'PASS ✓' if ok else 'FAIL ✗'} ===")
            print("  rules: no ACL leak · 0 hallucinations · citation≥0.90 · recall≥0.90 · abstention≥0.90")
            sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
