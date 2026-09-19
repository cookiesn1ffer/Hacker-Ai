from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import schemas
from db import Engagement, Target, Finding, get_db

router = APIRouter(prefix="/api/engagements", tags=["engagements"])


@router.get("", response_model=list[schemas.EngagementOut])
def list_engagements(db: Session = Depends(get_db)):
    return db.query(Engagement).order_by(Engagement.created_at.desc()).all()


@router.post("", response_model=schemas.EngagementOut)
def create_engagement(body: schemas.EngagementCreate, db: Session = Depends(get_db)):
    eng = Engagement(**body.model_dump())
    db.add(eng)
    db.commit()
    db.refresh(eng)
    return eng


@router.put("/{eng_id}/scope")
def update_scope(eng_id: int, body: schemas.ScopeUpdate, db: Session = Depends(get_db)):
    eng = db.get(Engagement, eng_id)
    if not eng:
        raise HTTPException(404, "Engagement not found")
    eng.scope_notes = body.scope_notes
    db.commit()
    return {"ok": True}


@router.delete("/{eng_id}")
def delete_engagement(eng_id: int, db: Session = Depends(get_db)):
    eng = db.get(Engagement, eng_id)
    if not eng:
        raise HTTPException(404, "Engagement not found")
    db.delete(eng)
    db.commit()
    return {"ok": True}


# ---- Targets ----
@router.get("/{eng_id}/targets", response_model=list[schemas.TargetOut])
def list_targets(eng_id: int, db: Session = Depends(get_db)):
    return db.query(Target).filter(Target.engagement_id == eng_id).all()


@router.post("/{eng_id}/targets", response_model=schemas.TargetOut)
def add_target(eng_id: int, body: schemas.TargetCreate, db: Session = Depends(get_db)):
    if not db.get(Engagement, eng_id):
        raise HTTPException(404, "Engagement not found")
    t = Target(engagement_id=eng_id, **body.model_dump())
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.delete("/targets/{target_id}")
def delete_target(target_id: int, db: Session = Depends(get_db)):
    t = db.get(Target, target_id)
    if not t:
        raise HTTPException(404, "Target not found")
    db.delete(t)
    db.commit()
    return {"ok": True}


# ---- Findings ----
@router.get("/{eng_id}/findings", response_model=list[schemas.FindingOut])
def list_findings(eng_id: int, db: Session = Depends(get_db)):
    return db.query(Finding).filter(Finding.engagement_id == eng_id).all()


@router.post("/{eng_id}/findings", response_model=schemas.FindingOut)
def add_finding(eng_id: int, body: schemas.FindingCreate, db: Session = Depends(get_db)):
    if not db.get(Engagement, eng_id):
        raise HTTPException(404, "Engagement not found")
    f = Finding(engagement_id=eng_id, **body.model_dump())
    db.add(f)
    db.commit()
    db.refresh(f)
    return f


@router.patch("/findings/{finding_id}", response_model=schemas.FindingOut)
def update_finding(finding_id: int, body: schemas.FindingUpdate, db: Session = Depends(get_db)):
    f = db.get(Finding, finding_id)
    if not f:
        raise HTTPException(404, "Finding not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(f, k, v)
    db.commit()
    db.refresh(f)
    return f


@router.delete("/findings/{finding_id}")
def delete_finding(finding_id: int, db: Session = Depends(get_db)):
    f = db.get(Finding, finding_id)
    if not f:
        raise HTTPException(404, "Finding not found")
    db.delete(f)
    db.commit()
    return {"ok": True}
