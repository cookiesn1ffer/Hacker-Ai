"""
Builds the engagement context the model sees, sized to a token budget.

Layer 1 (always on, compact): targets, one-line facts per scan, one line per
finding. Layer 2 (retrieved): the chunks of raw output / evidence / notes that
best match the question, until the budget runs out. Pure Python keyword
scoring (BM25-style) over the engagement's own data: no index to keep in sync,
no extra install, and it is always fresh after an edit or delete.
"""
import math
import re
from collections import Counter

from services.facts import summarize_run

CHUNK_CHARS = 700
STOP = set(
    "the a an and or of to in on for is are was were be it this that with what which who how do does did "
    "me my you your i we tell show give check please about from at by as can could would should any all "
    "some there their them then than out up if not no yes open ports port".split()
)
TOKEN = re.compile(r"\d{1,3}(?:\.\d{1,3}){3}|\d+/(?:tcp|udp)|cve-\d{4}-\d+|[a-z0-9][a-z0-9_.-]{1,}", re.I)


def est_tokens(text: str) -> int:
    return int(len(text) / 3.5) + 4


def _terms(text: str) -> list[str]:
    return [t.lower() for t in TOKEN.findall(text)]


def _query_terms(query: str) -> list[str]:
    return [t for t in _terms(query) if t not in STOP and not (t.isdigit() and len(t) < 3)]


def _split(text: str, size: int = CHUNK_CHARS) -> list[str]:
    text = (text or "").strip()
    if len(text) <= size:
        return [text] if text else []
    out, cur = [], ""
    for line in text.splitlines():
        if len(cur) + len(line) + 1 > size and cur:
            out.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        out.append(cur)
    return out


def _clip(text: str, tokens: int) -> str:
    max_chars = max(0, int(tokens * 3.5))
    return text if len(text) <= max_chars else text[: max(0, max_chars - 20)].rstrip() + "\n...[cut]"


def _all_chunks(eng) -> list[dict]:
    chunks = []
    for t in eng.targets:
        for run in t.tool_runs:
            head = f"{run.tool} {run.args} {t.value}"
            for i, c in enumerate(_split(run.output)):
                chunks.append({"src": f"scan `{head}`", "text": c, "recency": run.started_at, "target": t.value})
    for f in eng.findings:
        body = "\n".join(x for x in (f.description, f.evidence, f.remediation) if x)
        for c in _split(body):
            chunks.append({"src": f"finding [{f.severity}] {f.title}", "text": c, "recency": f.created_at, "target": ""})
    if eng.scope_notes:
        for c in _split(eng.scope_notes):
            chunks.append({"src": "scope notes", "text": c, "recency": None, "target": ""})
    return chunks


def _score(chunks: list[dict], q_terms: list[str]) -> None:
    """BM25: term repetition saturates, so one exact hit on several query terms
    beats a noisy chunk that repeats one common word ten times."""
    k1, b = 1.2, 0.75
    n = max(1, len(chunks))
    docs = [Counter(_terms(c["src"] + " " + c["text"] + " " + c["target"])) for c in chunks]
    lens = [sum(d.values()) or 1 for d in docs]
    avg = sum(lens) / n
    df = Counter()
    for d in docs:
        for term in set(d):
            df[term] += 1
    qset = set(q_terms)
    for c, d, ln in zip(chunks, docs, lens):
        s = 0.0
        for term in qset:
            tf = d.get(term, 0)
            if not tf:
                continue
            idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
            s += idf * tf * (k1 + 1) / (tf + k1 * (1 - b + b * ln / avg))
            if re.match(r"\d+\.\d+\.\d+\.\d+$", term):
                s += 1.5  # exact host match matters most
        c["score"] = s


def build(eng, query: str, budget_tokens: int) -> tuple[str, dict]:
    """Return (context_text, stats). Never exceeds budget_tokens (estimated)."""
    budget_tokens = max(200, budget_tokens)
    targets = ", ".join(t.value for t in eng.targets) or "none yet"
    head = (
        f"Engagement: {eng.name} ({eng.kind}). Targets: {targets}.\n"
        f"Scope notes: {_clip(eng.scope_notes or 'none', 100)}"
    )

    # ---- layer 1: compact facts (bounded to ~45% of the budget) ----
    facts = []
    for t in eng.targets:
        latest: dict[str, object] = {}
        for run in sorted(t.tool_runs, key=lambda r: r.started_at):
            latest[run.tool] = run  # newest run per tool
        for tool, run in latest.items():
            facts.append(f"[{tool} on {t.value}] " + summarize_run(tool, run.output, run.exit_code).replace("\n", " | "))
    fnd = [
        f"- [{f.severity.upper()}] {f.title} ({f.status})"
        + (f": {(f.description or '')[:140].strip()}" if f.description else "")
        for f in eng.findings
    ]
    facts_txt = "Scan facts:\n" + ("\n".join(facts) if facts else "none yet")
    facts_txt += "\nFindings:\n" + ("\n".join(fnd) if fnd else "none yet")
    facts_txt = _clip(facts_txt, int(budget_tokens * 0.45))

    used = est_tokens(head) + est_tokens(facts_txt)
    remaining = budget_tokens - used

    # ---- layer 2: retrieved raw detail, best matches first ----
    picked, total, seen = [], 0, set()
    if remaining > 80:
        chunks = _all_chunks(eng)
        q = _query_terms(query)
        _score(chunks, q)
        # No usable terms ("summarize everything") -> newest material first.
        key = (lambda c: (c["score"], str(c["recency"]))) if q else (lambda c: str(c["recency"]))
        for c in sorted(chunks, key=key, reverse=True):
            if q and c["score"] <= 0:
                continue
            cost = est_tokens(c["text"]) + 12
            if total + cost > remaining or c["text"] in seen:
                continue
            seen.add(c["text"])
            picked.append(c)
            total += cost
    detail = ""
    if picked:
        detail = "\nRelevant detail:\n" + "\n".join(f"<{c['src']}>\n{c['text'].strip()}" for c in picked)

    text = head + "\n" + facts_txt + detail
    return text, {"tokens": est_tokens(text), "chunks": len(picked), "facts": len(facts)}
