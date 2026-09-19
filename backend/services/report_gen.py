"""
Compile an engagement's findings into a markdown report using Aarush's
writeup convention (TL;DR / Summary / How I did it / Key takeaways /
Recommended next steps / Tools & skills mentioned / Personal note / Links).
Optionally render to PDF with WeasyPrint if it's installed.
"""
import os
from datetime import datetime

import markdown2

from config import settings
from db import Engagement

SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}


def build_markdown(engagement: Engagement) -> str:
    findings = sorted(engagement.findings, key=lambda f: SEVERITY_ORDER.get(f.severity, 5))
    tools_mentioned = sorted({run.tool for t in engagement.targets for run in t.tool_runs})

    lines = [
        f"# {engagement.name} - Engagement Report",
        "",
        f"*Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}*",
        "",
        "## TL;DR",
        f"{len(findings)} finding(s) across {len(engagement.targets)} target(s). "
        f"{sum(1 for f in findings if f.severity in ('critical', 'high'))} high/critical.",
        "",
        "## Summary",
        engagement.scope_notes or "_No scope notes recorded._",
        "",
        "## How I did it",
    ]

    for t in engagement.targets:
        lines.append(f"### Target: {t.value}")
        if t.notes:
            lines.append(t.notes)
            lines.append("")
        for run in t.tool_runs:
            lines.append(f"**`{run.tool} {run.args}`** (exit {run.exit_code})")
            lines.append("")
            lines.append("```")
            lines.append(run.output[:4000])
            lines.append("```")
            lines.append("")
        lines.append("")

    lines.append("## Findings")
    for f in findings:
        lines.append(f"### [{f.severity.upper()}] {f.title} ({f.status})")
        if f.description:
            lines.append(f.description)
            lines.append("")
        if f.evidence:
            lines.append("**Evidence:**")
            lines.append("")
            lines.append(f"```\n{f.evidence}\n```")
            lines.append("")
        if f.remediation:
            lines.append(f"**Remediation:** {f.remediation}")
            lines.append("")
        lines.append("")

    lines += [
        "## Key takeaways",
        "_TODO: fill in the 2-3 things worth remembering from this engagement._",
        "",
        "## Recommended next steps",
        "_TODO: prioritized remediation/follow-up list._",
        "",
        "## Tools & skills mentioned",
        ", ".join(tools_mentioned) if tools_mentioned else "_none recorded_",
        "",
        "## Personal note",
        "_TODO_",
        "",
        "## Links",
        "_TODO_",
        "",
        "## License / Author",
        "Aarush P (Cookie)",
    ]

    return "\n".join(lines)


def save_report(engagement: Engagement, as_pdf: bool = False) -> str:
    os.makedirs(settings.reports_dir, exist_ok=True)
    md = build_markdown(engagement)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in engagement.name)
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    md_path = os.path.join(settings.reports_dir, f"{safe_name}_{ts}.md")
    with open(md_path, "w", encoding="utf-8") as fh:
        fh.write(md)

    if not as_pdf:
        return md_path

    html_body = markdown2.markdown(md, extras=["fenced-code-blocks", "tables"])
    pdf_path = os.path.join(settings.reports_dir, f"{safe_name}_{ts}.pdf")
    try:
        from weasyprint import HTML  # imported lazily; heavy optional dep

        HTML(string=f"<html><body>{html_body}</body></html>").write_pdf(pdf_path)
        return pdf_path
    except Exception as e:
        # PDF is best-effort; the markdown report is always produced above.
        raise RuntimeError(
            f"Markdown report saved at {md_path}, but PDF export failed "
            f"(WeasyPrint may need extra system libs on Windows): {e}"
        )
