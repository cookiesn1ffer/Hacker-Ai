"""
Turn raw tool output into compact facts so the model sees the signal, not the
noise. A 3KB nmap run becomes ~10 short lines. Computed on the fly from the
stored output, so it needs no database changes and old scans benefit too.
"""
import re

PORT_LINE = re.compile(r"^(\d+)/(tcp|udp)\s+(open\|filtered|open|filtered|closed)\s+(\S+)\s*(.*)$")
HOST_LINE = re.compile(r"^Nmap scan report for (.+)$")


def _nmap(output: str) -> str:
    hosts: list[dict] = []
    cur: dict | None = None
    for raw in output.splitlines():
        line = raw.strip()
        m = HOST_LINE.match(line)
        if m:
            cur = {"name": m.group(1), "up": None, "open": [], "filtered": [], "extra": []}
            hosts.append(cur)
            continue
        if cur is None:
            continue
        if line.startswith("Host is up"):
            cur["up"] = True
            continue
        p = PORT_LINE.match(line)
        if p:
            port, proto, state, svc, ver = p.groups()
            label = f"{port}/{proto} {svc}" + (f" {ver.strip()}" if ver.strip() else "")
            if state.startswith("open"):
                cur["open"].append(label)
            elif state == "filtered":
                cur["filtered"].append(port)
            continue
        for key in ("MAC Address:", "OS details:", "Running:", "Service Info:", "Not shown:"):
            if line.startswith(key):
                cur["extra"].append(line)
    if not hosts:
        return ""
    parts = []
    for h in hosts:
        seg = [f"{h['name']}: {'up' if h['up'] else 'no response'}"]
        seg.append("open: " + (", ".join(h["open"]) if h["open"] else "none"))
        if h["filtered"]:
            seg.append("filtered: " + ",".join(h["filtered"]))
        seg.extend(h["extra"])
        parts.append("; ".join(seg))
    return "\n".join(parts)


def _generic(output: str, max_lines: int = 20) -> str:
    seen, keep = set(), []
    for raw in output.splitlines():
        line = raw.strip()
        if not line or line in seen:
            continue
        seen.add(line)
        keep.append(line)
    if len(keep) <= max_lines:
        return "\n".join(keep)
    # Prefer lines that look like results over banners/progress noise.
    hot = [l for l in keep if re.search(r"\[(critical|high|medium|low|info)\]|found|status|200|301|403|open|vuln", l, re.I)]
    chosen = (hot + [l for l in keep if l not in hot])[:max_lines]
    return "\n".join(chosen) + f"\n... ({len(keep) - max_lines} more lines omitted)"


def summarize_run(tool: str, output: str, exit_code: int = 0) -> str:
    output = output or ""
    text = _nmap(output) if tool == "nmap" else ""
    if not text:
        text = _generic(output)
    if exit_code not in (0, None):
        text = f"(exit {exit_code}) " + text
    return text.strip() or "(no output)"
