from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from db import Engagement, get_db
from services import report_gen

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/{eng_id}/preview")
def preview(eng_id: int, db: Session = Depends(get_db)):
    eng = db.get(Engagement, eng_id)
    if not eng:
        raise HTTPException(404, "Engagement not found")
    return {"markdown": report_gen.build_markdown(eng)}


@router.post("/{eng_id}/export")
def export(eng_id: int, pdf: bool = False, db: Session = Depends(get_db)):
    eng = db.get(Engagement, eng_id)
    if not eng:
        raise HTTPException(404, "Engagement not found")
    try:
        path = report_gen.save_report(eng, as_pdf=pdf)
    except RuntimeError as e:
        raise HTTPException(500, str(e))
    return FileResponse(path, filename=path.split("/")[-1].split("\\")[-1])
