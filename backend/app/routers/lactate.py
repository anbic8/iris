from datetime import date as date_type
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import LactateStage, LactateTest, User

router = APIRouter()


class StageIn(BaseModel):
    stage_nr:  int
    speed_kmh: float
    hr:        Optional[int]   = None
    lactate:   Optional[float] = None


class TestIn(BaseModel):
    test_date: str
    lt_pace:   Optional[float] = None
    lt_hr:     Optional[int]   = None
    ias_pace:  Optional[float] = None
    ias_hr:    Optional[int]   = None
    vo2max:    Optional[float] = None
    notes:     Optional[str]   = None
    stages:    List[StageIn]   = []


def _to_dict(t: LactateTest) -> dict:
    return {
        "id":        t.id,
        "test_date": t.test_date.isoformat() if t.test_date else None,
        "lt_pace":   float(t.lt_pace)  if t.lt_pace  else None,
        "lt_hr":     t.lt_hr,
        "ias_pace":  float(t.ias_pace) if t.ias_pace else None,
        "ias_hr":    t.ias_hr,
        "vo2max":    float(t.vo2max)   if t.vo2max   else None,
        "notes":     t.notes,
        "stages": [
            {"stage_nr": s.stage_nr, "speed_kmh": float(s.speed_kmh),
             "hr": s.hr, "lactate": float(s.lactate) if s.lactate else None}
            for s in t.stages
        ],
    }


@router.get("/")
def list_tests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tests = (
        db.query(LactateTest)
        .filter(LactateTest.user_id == current_user.id)
        .order_by(LactateTest.test_date.desc())
        .all()
    )
    return [_to_dict(t) for t in tests]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_test(data: TestIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        parsed_date = date_type.fromisoformat(data.test_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiges Datumsformat (YYYY-MM-DD)")

    test = LactateTest(
        user_id=current_user.id, test_date=parsed_date,
        lt_pace=data.lt_pace, lt_hr=data.lt_hr,
        ias_pace=data.ias_pace, ias_hr=data.ias_hr,
        vo2max=data.vo2max, notes=data.notes,
    )
    db.add(test)
    db.flush()
    for s in data.stages:
        db.add(LactateStage(test_id=test.id, stage_nr=s.stage_nr,
                            speed_kmh=s.speed_kmh, hr=s.hr, lactate=s.lactate))
    db.commit()
    db.refresh(test)
    return _to_dict(test)


@router.delete("/{test_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_test(test_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    test = db.query(LactateTest).filter(
        LactateTest.id == test_id, LactateTest.user_id == current_user.id
    ).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test nicht gefunden")
    db.delete(test)
    db.commit()
