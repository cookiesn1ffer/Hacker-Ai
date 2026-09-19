from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from config import settings
from db import ChatMessage, Engagement, get_db
from datetime import datetime

from db import Target, ToolRun
from services.chat_actions import detect_action
from services.llm_client import llm_client
from services.tool_runner import ToolNotAllowed, run_tool

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=schemas.ChatResponse)
async def chat(body: schemas.ChatRequest, db: Session = Depends(get_db)):
    system = settings.llm_system_prompt
    context_block = ""
    action = None
    ran_header = ""
    output = ""

    # If a chat is tied to an engagement, give the model that context so
    # answers are grounded in the actual scope/targets/findings.
    if body.engagement_id:
        eng = db.get(Engagement, body.engagement_id)
        if not eng:
            raise HTTPException(404, "Engagement not found")
        # If the operator asked for a scan/tool run, actually run it first so
        # the result is part of the context the model answers from.
        recent_user = [
            m.content
            for m in db.query(ChatMessage)
            .filter(ChatMessage.engagement_id == body.engagement_id, ChatMessage.role == "user")
            .order_by(ChatMessage.created_at.desc())
            .limit(6)
            .all()
        ][::-1]
        action = detect_action(
            body.message, settings.allowed_tools, recent_user, [t.value for t in eng.targets]
        )
        if action:
            target = next((t for t in eng.targets if t.value == action.target), None)
            if not target:
                target = Target(engagement_id=eng.id, value=action.target, notes="added from chat")
                db.add(target)
                db.commit()
                db.refresh(target)
            try:
                output, code = await run_tool(action.tool, action.target, action.args)
            except ToolNotAllowed as e:
                output, code = str(e), -1
            run = ToolRun(
                target_id=target.id,
                tool=action.tool,
                args=action.args,
                output=output,
                exit_code=code,
                finished_at=datetime.utcnow(),
            )
            db.add(run)
            db.commit()
            db.refresh(eng)
            ran_header = f"**Ran `{action.tool} {action.args} {action.target}`** (exit {code})"
            if code == -1:
                # Not installed / timed out: report it plainly, no need to ask the model.
                reply = f"{ran_header}\n\n```\n{output[:2000]}\n```"
                db.add(ChatMessage(engagement_id=body.engagement_id, role="user", content=body.message))
                db.add(ChatMessage(engagement_id=body.engagement_id, role="assistant", content=reply))
                db.commit()
                return schemas.ChatResponse(reply=reply)

        targets = ", ".join(t.value for t in eng.targets) or "none yet"

        if eng.findings:
            finding_blocks = []
            for f in eng.findings:
                block = f"- [{f.severity.upper()}] {f.title} ({f.status})"
                if f.description:
                    block += f"\n  description: {f.description[:600]}"
                if f.evidence:
                    block += f"\n  evidence:\n{f.evidence[:1500]}"
                finding_blocks.append(block)
            findings = "\n".join(finding_blocks)
        else:
            findings = "none yet"

        # Recent raw tool output, so the model can answer questions like
        # "which ports are open" even before the operator writes up a finding.
        recent_runs = sorted(
            (run for t in eng.targets for run in t.tool_runs),
            key=lambda r: r.started_at,
            reverse=True,
        )[:5]
        if recent_runs:
            run_blocks = []
            for run in recent_runs:
                run_blocks.append(
                    f"- `{run.tool} {run.args}` (exit {run.exit_code}):\n{(run.output or '')[:1500]}"
                )
            tool_runs = "\n".join(run_blocks)
        else:
            tool_runs = "none yet"

        context_block = (
            f"Current engagement: {eng.name} ({eng.kind}).\n"
            f"Scope notes: {eng.scope_notes or 'none'}\n"
            f"Targets: {targets}\n\n"
            f"Recent tool runs (most recent first):\n{tool_runs}\n\n"
            f"Findings so far:\n{findings}"
        )
        system += "\n\n" + context_block

    history = (
        db.query(ChatMessage)
        .filter(ChatMessage.engagement_id == body.engagement_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(body.history_limit)
        .all()
    )[::-1]

    messages = [{"role": "system", "content": system}]
    messages += [{"role": m.role, "content": m.content} for m in history]
    # Small local models often ignore the system prompt, so repeat the
    # real engagement data right next to the question they are answering.
    if context_block:
        llm_user = (
            "[Hacker-AI engagement data - real, already captured in the app. "
            "Use it to answer. You are Hacker-AI's copilot; do not name yourself "
            "as any other model.]\n"
            f"{context_block}\n[End of engagement data]\n\n"
            + (
                f"The operator asked you to run this scan and it has just finished "
                f"(see the newest entry under Recent tool runs). Summarize it: open "
                f"ports, services/versions, and what to look at next. Operator said: {body.message}"
                if action
                else f"Operator question: {body.message}"
            )
        )
    else:
        llm_user = body.message
    messages.append({"role": "user", "content": llm_user})

    try:
        reply = await llm_client.chat(messages)
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    if action:
        reply = f"{ran_header}\n\n{reply}\n\n<details><summary>Raw output</summary>\n\n```\n{output[:3000]}\n```\n</details>"

    db.add(ChatMessage(engagement_id=body.engagement_id, role="user", content=body.message))
    db.add(ChatMessage(engagement_id=body.engagement_id, role="assistant", content=reply))
    db.commit()

    return schemas.ChatResponse(reply=reply)


@router.get("/history")
def history(engagement_id: int | None = None, db: Session = Depends(get_db)):
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.engagement_id == engagement_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    return [{"role": m.role, "content": m.content, "created_at": m.created_at} for m in msgs]


@router.get("/config")
def llm_config():
    """Non-secret info so the UI can show which backend/model is active."""
    from services import providers
    p = providers.get_active()
    return {"name": p["name"], "base_url": p["base_url"], "model": p["model"]}
