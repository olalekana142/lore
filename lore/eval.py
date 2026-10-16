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
import re
import sys
import time

from lore.graph.schema import get_connection, init_schema
from lore.retrieval.answer import retrieve, synthesize

COMPANY = "acme"
PUBLIC = ["everyone"]
HR = ["hr"]

# For "refute" adversarial cases: a correct answer qualifies/denies the over-claim. Cover
# denial ("no", "not"), limits ("only", "up to", "cap", "maximum"), conditions ("require",
# "approval", "must") and removal/immediacy ("removed", "no longer", "immediately").
_REFUTE_CUES = [
    "not ", "n't", "no longer", " no ", "no,", "only", "require", "approval", "must ",
    "may ", "up to", "cannot", "cap", "limit", "maximum", "remov", "eliminat", "immediat",
]

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
    # --- adversarial: unsupported inference. "refute" = a correct answer must QUALIFY/deny
    #     the over-generalisation (checked by a refutation cue, avoiding negation-substring
    #     traps like flagging "NOT guaranteed for everyone" as if it asserted it) ---
    {"q": "Since managers can approve remote work, is remote work guaranteed for every employee?", "docs": ["upload:remote-work"], "refute": True, "groups": PUBLIC, "adversarial": "inference"},
    {"q": "The company has a 401k match — does everyone get it automatically from day one?", "docs": ["upload:benefits"], "refute": True, "groups": PUBLIC, "adversarial": "inference"},
    {"q": "I can carry over PTO — does that mean I can carry over unlimited days?", "docs": ["upload:pto-policy"], "refute": True, "groups": PUBLIC, "adversarial": "inference"},
    {"q": "There's a home office stipend — does the company pay my full home rent?", "docs": ["upload:remote-work"], "refute": True, "groups": PUBLIC, "adversarial": "inference"},
    {"q": "Since sick leave exists, can I take unlimited sick days?", "docs": ["upload:sick-leave"], "refute": True, "groups": PUBLIC, "adversarial": "inference"},
    # --- stale rule: the 90-day PTO waiting period was REMOVED; a correct answer denies it ---
    {"q": "Do new hires still have to wait 90 days before using PTO?", "docs": ["upload:pto-policy"], "refute": True, "groups": PUBLIC, "adversarial": "stale"},
    {"q": "Since there is parental leave, is it fully paid for a whole year?", "docs": ["upload:acme-parental-leave"], "refute": True, "groups": PUBLIC, "adversarial": "inference"},
    # --- temporal: current-vs-superseded is shipped & gated; a "current" question must not
    #     return the retired policy ---
    {"q": "What is the current PTO entitlement?", "docs": ["upload:pto-policy"], "has": ["25"], "groups": PUBLIC, "temporal": "current"},
    # historical as-of routing works (keeps the effective doc, drops the 2026 one) but the
    # answer still needs the version-chain model + vacation/PTO synonymy — tracked, NOT gated.
    {"q": "What was the PTO entitlement in 2025?", "docs": ["upload:employee-faq"], "has": ["20"], "groups": PUBLIC, "known_limitation": "temporal-historical"},
    {"q": "What was the PTO entitlement before the 2026 change?", "docs": ["upload:employee-faq"], "has": ["20"], "groups": PUBLIC, "known_limitation": "temporal-historical"},
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


def answer_eval(conn, verify: bool = False) -> dict:
    tp = ta = fa_answer = fa_abstain = 0          # abstention 2x2
    n_ans = n_abs = 0
    cite_prec_ok = 0
    lat: list[float] = []
    fails = []
    known = {"pass": 0, "total": 0}               # tracked, NOT gated
    for g in GOLDEN:
        r = retrieve(conn, COMPANY, g["q"], groups=g["groups"])
        t0 = time.perf_counter()
        res = synthesize(g["q"], r, verify=verify)
        lat.append((time.perf_counter() - t0) * 1000)
        text = res["answer"].lower()
        cited = {s["doc_id"] for s in res["sources"]}
        has_ok = all(h.lower() in text for h in g.get("has", []))
        if g.get("refute"):
            not_ok = any(cue in text for cue in _REFUTE_CUES)  # answer qualifies the over-claim
        else:
            not_ok = all(n.lower() not in text for n in g.get("not", []))
        cite_ok = bool(set(g["docs"]) & cited)

        if g.get("known_limitation"):
            known["total"] += 1
            known["pass"] += int(has_ok and cite_ok)
            continue
        if g.get("abstain"):
            n_abs += 1
            if res["confidence"] == "none":
                ta += 1
            else:
                fa_answer += 1
                fails.append((g["q"], f"FALSE ANSWER on unanswerable ({g.get('adversarial','')})"))
        else:
            n_ans += 1
            if res["confidence"] == "none":
                fa_abstain += 1
                fails.append((g["q"], "FALSE ABSTENTION (was answerable — verifier over-rejected?)"))
            elif has_ok and not_ok and cite_ok:
                tp += 1
                cite_prec_ok += 1
            else:
                fails.append((g["q"], _classify_miss(g, r, res)))
                if cite_ok:
                    cite_prec_ok += 1
    lat.sort()
    return {
        "n_ans": n_ans, "n_abs": n_abs, "correct": tp,
        "answer_acc": tp / n_ans if n_ans else 0,
        "abstain_acc": ta / n_abs if n_abs else 0,
        "false_answers": fa_answer, "false_abstentions": fa_abstain,
        "citation_precision": cite_prec_ok / n_ans if n_ans else 0,
        "known": known, "p50": lat[len(lat) // 2], "p95": lat[int(len(lat) * 0.95)],
        "fails": fails,
    }


# ------------------------------------------------------- work-feature eval (the AI workspace)
# The workspace features (deliverables, meeting + document policy checks) are LLM-generated
# work products. They are gated here with the same discipline as /ask: grounding, no dangling
# citations, and correct policy-conflict detection against fixed golden inputs.

WORK_DELIVERABLES = [
    {"kind": "faq", "goal": "Customer-facing FAQ about our PTO, expense and travel policies",
     "expect_any_source": ["Paid Time Off Policy", "Expense Reimbursement", "Booking Business Travel"]},
    {"kind": "sop", "goal": "SOP for reporting and responding to a security incident",
     "expect_any_source": ["Reporting a Security Incident"]},
]

# A vendor redline with known violations of the seeded Vendor & Procurement Policy.
WORK_REDLINE = (
    "Payment is due Net 15, non-refundable. Fees may increase by up to 20% at each renewal. "
    "Auto-renews unless Acme gives 120 days notice. DataPipe may use aggregated Acme data to train "
    "and improve its models. DataPipe will use reasonable efforts to notify Acme of a confirmed data "
    "breach. DataPipe liability is capped at one month of fees; Acme liability is uncapped. "
    "DataPipe may subcontract any obligations to third parties without notice to Acme."
)
WORK_REDLINE_CUES = ["net 15", "120", "train", "72", "uncapped", "subcontract"]
WORK_REDLINE_MIN_CONFLICTS = 4

# A meeting with two decisions that break policy (travel self-approval, unlimited meals) and one
# that matches current policy (new hires take PTO immediately) which must NOT be flagged.
WORK_TRANSCRIPT = (
    "Dan: We decided to let the sales team approve their own travel up to 2000 dollars without any "
    "manager sign-off. Priya: Also new hires can take PTO immediately with no waiting period. "
    "Dan: And we will let employees expense unlimited meals when traveling."
)
WORK_MEETING_FLAG_CUES = ["travel", "meal"]
WORK_MEETING_NOFLAG_CUE = "immediately"

_NUM_RE = re.compile(r"\$?\d{2,}(?:[.,]\d+)?%?")


def _numbers_grounded(content: str, facts: list[str]) -> tuple[int, int]:
    """Numbers (>= 2 digits, or $/%) in the draft that also appear in a retrieved fact."""
    pool = " ".join(facts)
    nums = {m.group(0).strip("$%") for m in _NUM_RE.finditer(content)}
    nums = {n for n in nums if n and not n.startswith("0")}
    if not nums:
        return 0, 0
    hit = sum(1 for n in nums if n in pool)
    return hit, len(nums)


def work_eval(conn) -> dict:
    from lore import deliverables, docintel, meetings

    fails: list[str] = []

    # --- deliverables: grounded · no dangling [n] · expected source cited · numbers grounded ---
    d_total = d_grounded = d_source_hit = 0
    dangling = 0
    num_hit = num_total = 0
    for g in WORK_DELIVERABLES:
        d_total += 1
        res = deliverables.generate(conn, COMPANY, g["kind"], g["goal"], groups=PUBLIC, persist=False)
        cited_ns = {int(n) for n in re.findall(r"\[(\d+)\]", res["content"])}
        if res["grounded"]:
            d_grounded += 1
        else:
            fails.append(f"deliverable not grounded: {g['goal']}")
        if any(n > res["retrieved_sources"] for n in cited_ns):
            dangling += 1
            fails.append(f"dangling citation (cites [n] beyond retrieved sources): {g['goal']}")
        titles = {s["title"] for s in res["sources"]}
        if titles & set(g["expect_any_source"]):
            d_source_hit += 1
        else:
            fails.append(f"expected source not cited ({g['expect_any_source']}): {g['goal']}")
        h, t = _numbers_grounded(res["content"], res["retrieved_facts"])
        num_hit += h
        num_total += t

    # --- document policy check: the redline must surface its known violations ---
    pc = docintel.check_policies(conn, COMPANY, WORK_REDLINE, groups=PUBLIC)
    blob = " ".join(f"{c.get('term', '')} {c.get('issue', '')}" for c in pc["conflicts"]).lower()
    cue_hits = sum(1 for cue in WORK_REDLINE_CUES if cue in blob)
    redline_ok = len(pc["conflicts"]) >= WORK_REDLINE_MIN_CONFLICTS and cue_hits / len(WORK_REDLINE_CUES) >= 0.66
    if not redline_ok:
        fails.append(f"redline policy check: {len(pc['conflicts'])} conflicts, {cue_hits}/{len(WORK_REDLINE_CUES)} cues")

    # --- meeting policy check: flag the real violations, don't flag the policy-consistent one ---
    ma = meetings.analyze_meeting(conn, COMPANY, WORK_TRANSCRIPT, groups=PUBLIC)
    flagged = " ".join(c.get("decision", "") for c in ma["policy_conflicts"]).lower()
    meet_flags_ok = all(cue in flagged for cue in WORK_MEETING_FLAG_CUES)
    meet_noflag_ok = WORK_MEETING_NOFLAG_CUE not in flagged
    if not meet_flags_ok:
        fails.append(f"meeting check missed a real violation (flagged: {flagged[:80]!r})")
    if not meet_noflag_ok:
        fails.append("meeting check FALSE-FLAGGED the policy-consistent PTO decision")

    passed = (d_grounded == d_total and dangling == 0 and d_source_hit == d_total
              and redline_ok and meet_flags_ok and meet_noflag_ok)
    return {
        "pass": passed, "fails": fails,
        "deliverables": d_total, "grounded": d_grounded, "source_hit": d_source_hit, "dangling": dangling,
        "numbers_grounded": (num_hit, num_total),
        "redline_conflicts": len(pc["conflicts"]), "redline_cues": f"{cue_hits}/{len(WORK_REDLINE_CUES)}",
        "meeting_flags_ok": meet_flags_ok, "meeting_noflag_ok": meet_noflag_ok,
    }


# ----------------------------------------------------------------------- runner
def main() -> None:
    ap = argparse.ArgumentParser(description="Lore RAG eval")
    ap.add_argument("--answers", action="store_true", help="run answer-level (LLM) metrics")
    ap.add_argument("--verify-ab", action="store_true", help="A/B the claim verifier (expensive; ~2x LLM calls)")
    ap.add_argument("--gate", action="store_true", help="enforce regression thresholds (CI); implies --answers")
    ap.add_argument("--work", action="store_true", help="eval the AI work features (deliverables · policy checks); included in --gate")
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

    if args.verify_ab:
        print("\n=== Answer-level: claim verifier A/B (OFF vs ON) — the shipping decision ===")
        off = answer_eval(conn, verify=False)
        on = answer_eval(conn, verify=True)
        print(f"  {'metric':22} {'OFF':>12} {'ON':>12}")
        print(f"  {'answered correctly':22} {str(off['correct'])+'/'+str(off['n_ans']):>12} {str(on['correct'])+'/'+str(on['n_ans']):>12}")
        print(f"  {'citation precision':22} {off['citation_precision']:>12.2f} {on['citation_precision']:>12.2f}")
        print(f"  {'abstention accuracy':22} {off['abstain_acc']:>12.2f} {on['abstain_acc']:>12.2f}")
        print(f"  {'false answers':22} {off['false_answers']:>12} {on['false_answers']:>12}")
        print(f"  {'false abstentions':22} {off['false_abstentions']:>12} {on['false_abstentions']:>12}")
        print(f"  {'p50 ms':22} {off['p50']:>12.0f} {on['p50']:>12.0f}")
        print("  verdict: ship the verifier only if ON improves correctness with no regression"
              " and acceptable latency.")
        return

    a = None
    if args.answers or args.gate:
        print("\n=== Answer-level (verifier off — shipping config) ===")
        a = answer_eval(conn, verify=False)
        print(f"  answered correctly  : {a['correct']}/{a['n_ans']}  ({a['answer_acc']:.2f})")
        print(f"  citation precision  : {a['citation_precision']:.2f}")
        print(f"  abstention accuracy : {a['abstain_acc']:.2f}  ({a['n_abs']} unanswerable)")
        print(f"  false answers (hallucinated): {a['false_answers']}  ·  false abstentions: {a['false_abstentions']}")
        print(f"  answer latency p50/p95 ms: {a['p50']:.0f}/{a['p95']:.0f}")
        print(f"  known limitations (temporal, NOT gated): {a['known']['pass']}/{a['known']['total']} pass")
        if a["fails"]:
            print("  failures by category:")
            for q, cat in a["fails"]:
                print(f"    - [{cat}]  {q}")

    w = None
    if args.work or args.gate:
        print("\n=== Work features (deliverables · policy checks) ===")
        w = work_eval(conn)
        nh, nt = w["numbers_grounded"]
        print(f"  deliverables grounded     : {w['grounded']}/{w['deliverables']}  ·  expected source cited: {w['source_hit']}/{w['deliverables']}  ·  dangling citations: {w['dangling']}")
        print(f"  numbers traceable to facts: {nh}/{nt}" + ("" if nt else "  (none to check)"))
        print(f"  redline policy check      : {w['redline_conflicts']} conflicts, cues {w['redline_cues']}")
        print(f"  meeting policy check      : real violations flagged={w['meeting_flags_ok']}  ·  no false flag={w['meeting_noflag_ok']}")
        for f in w["fails"]:
            print(f"    - {f}")
        if not args.gate:
            print(f"\n  work features: {'PASS' if w['pass'] else 'FAIL'}")

    if args.gate and a is not None:
        ok = (sec["pass"] and a["false_answers"] == 0 and a["false_abstentions"] == 0
              and a["citation_precision"] >= 0.9 and hyb["recall"] >= 0.9
              and a["abstain_acc"] >= 0.9 and (w is None or w["pass"]))
        print(f"\n=== Regression gate: {'PASS' if ok else 'FAIL'} ===")
        print("  HARD: ACL leak MUST=0. MUST NOT regress: citation precision, abstention,")
        print("        0 hallucinations, 0 false-abstentions. recall>=0.90.")
        print("  WORK: deliverables grounded + expected source cited + no dangling [n];")
        print("        redline check finds its violations; meeting check flags real ones, no false flag.")
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
