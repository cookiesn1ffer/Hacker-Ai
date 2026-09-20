import re
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from config import settings
from db import ChatMessage, Engagement, Target, ToolRun, get_db
from services import context_window, providers
from services.chat_actions import detect_action
from services.context_builder import build as build_context
from services.context_builder import est_tokens
from services.llm_client import llm_client
from services.tool_runner import ToolNotAllowed, run_tool

router = APIRouter(prefix="/api/chat", tags=["chat"])


def _clean(text: str) -> str:
    """Stored replies carry a 'Raw output' block for the UI only."""
    return re.sub(r"<details>.*?</details>", "", text, flags=re.S).strip()


def _fit_history(turns: list[dict], budget: int) -> tuple[list[dict], str]:
    """Newest turns that fit the budget, plus a one-line-per-turn digest of the
    older ones that didn't (so old context is condensed, not silently lost)."""
    kept, used = [], 0
    for t in reversed(turns):
        cost = est_tokens(t["content"])
        if used + cost > budget and kept:
            break
        kept.append(t)
        used += cost
    kept.reverse()
    older = turns[: len(turns) - len(kept)]
    digest = ""
    if older:
        lines = []
        for t in older[-12:]:
            who = "operator" if t["role"] == "user" else "you"
            lines.append(f"- {who}: {t['content'][:110].strip()}")
        digest = "Earlier in this chat (condensed):\n" + "\n".join(lines)
        digest = digest[:700]
    return kept, digest


@router.post("", response_model=schemas.ChatResponse)
async def chat(body: schemas.ChatRequest, db: Session = Depends(get_db)):
    provider = providers.get_active()
    win = await context_window.resolve(provider)
    ctx_total = win["tokens"]
    reserve = min(settings.llm_reply_reserve_tokens, int(ctx_total * 0.25))
    avail = ctx_total - reserve

    eng = None
    action = None
    ran_header = ""
    output = ""

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
            db.add(
                ToolRun(
                    target_id=target.id,
                    tool=action.tool,
                    args=action.args,
                    output=output,
                    exit_code=code,
                    finished_at=datetime.utcnow(),
                )
            )
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

    system = settings.llm_system_prompt
    if action:
        question = (
            "The operator asked you to run this scan and it has just finished (it is the "
            "newest scan in the data above). Summarize it: open ports, services/versions, "
            f"and what to look at next. Operator said: {body.message}"
        )
    else:
        question = f"Operator question: {body.message}"

    # ---- budget: system + question are fixed; history and engagement data share the rest ----
    wrapper = 90
    room = max(200, avail - est_tokens(system) - est_tokens(question) - wrapper)

    history_rows = (
        db.query(ChatMessage)
        .filter(ChatMessage.engagement_id == body.engagement_id)
        .order_by(ChatMessage.created_at.desc())
        .limit(body.history_limit)
        .all()
    )[::-1]
    turns = [{"role": m.role, "content": _clean(m.content)} for m in history_rows]
    kept, digest = _fit_history(turns, int(room * 0.35))
    hist_used = sum(est_tokens(t["content"]) for t in kept) + est_tokens(digest)

    context_text, cstats = "", {"chunks": 0, "facts": 0}
    if eng:
        query = body.message + (f" {action.target} {action.tool}" if action else "")
        context_text, cstats = build_context(eng, query, room - hist_used)

    if eng:
        user_content = (
            "[Hacker-AI engagement data - real, already captured in the app. Use it to answer. "
            "You are Hacker-AI's copilot; do not name yourself as any other model.]\n"
            f"{context_text}\n"
            + (f"{digest}\n" if digest else "")
            + f"[End of engagement data]\n\n{question}"
        )
    else:
        user_content = (f"{digest}\n\n" if digest else "") + question

    messages = [{"role": "system", "content": system}, *kept, {"role": "user", "content": user_content}]
    used = sum(est_tokens(m["content"]) for m in messages)

    try:
        reply = await llm_client.chat(messages, provider=provider, num_ctx=ctx_total)
    except RuntimeError as e:
        raise HTTPException(502, str(e))

    if action:
        reply = f"{ran_header}\n\n{reply}\n\n<details><summary>Raw output</summary>\n\n```\n{output[:3000]}\n```\n</details>"

    db.add(ChatMessage(engagement_id=body.engagement_id, role="user", content=body.message))
    db.add(ChatMessage(engagement_id=body.engagement_id, role="assistant", content=reply))
    db.commit()

    return schemas.ChatResponse(
        reply=reply,
        context={
            "used": used,
            "budget": ctx_total,
            "source": win["source"],
            "note": win["note"],
            "kind": win["kind"],
            "dropped_turns": len(turns) - len(kept),
            "chunks": cstats["chunks"],
        },
    )


@router.get("/history")
def history(engagement_id: int | None = None, db: Session = Depends(get_db)):
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.engagement_id == engagement_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    return [{"role": m.role, "content": m.content, "created_at": m.created_at} for m in msgs]


@router.delete("/history")
def clear_history(engagement_id: int | None = None, db: Session = Depends(get_db)):
    n = db.query(ChatMessage).filter(ChatMessage.engagement_id == engagement_id).delete()
    db.commit()
    return {"deleted": n}


@router.get("/context")
async def context_info():
    """What context size the active model has, and where that number came from."""
    p = providers.get_active()
    win = await context_window.resolve(p)
    return {"provider": p["name"], "model": p["model"], **win}


@router.get("/config")
def llm_config():
    """Non-secret info so the UI can show which backend/model is active."""
    p = providers.get_active()
    return {"name": p["name"], "base_url": p["base_url"], "model": p["model"]}
