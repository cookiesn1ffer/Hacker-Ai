from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from config import settings
from db import Target, ToolRun, get_db
from services.tool_runner import run_tool, ToolNotAllowed

router = APIRouter(prefix="/api/tools", tags=["tools"])


@router.get("/allowed")
def allowed_tools():
    return {"tools": settings.allowed_tools}


@router.post("/run/{target_id}", response_model=schemas.ToolRunOut)
async def run_on_target(target_id: int, body: schemas.ToolRunCreate, db: Session = Depends(get_db)):
    target = db.get(Target, target_id)
    if not target:
        raise HTTPException(404, "Target not found - add it to an engagement first")

    try:
        output, code = await run_tool(body.tool, target.value, body.args)
    except ToolNotAllowed as e:
        raise HTTPException(400, str(e))

    run = ToolRun(
        target_id=target.id,
        tool=body.tool,
        args=body.args,
        output=output,
        exit_code=code,
        finished_at=datetime.utcnow(),
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


@router.get("/runs/{target_id}", response_model=list[schemas.ToolRunOut])
def list_runs(target_id: int, db: Session = Depends(get_db)):
    return db.query(ToolRun).filter(ToolRun.target_id == target_id).order_by(ToolRun.started_at.desc()).all()
