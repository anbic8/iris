from datetime import date as date_type
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Exercise, User, WorkoutSession, WorkoutSet, WorkoutTemplate, WorkoutTemplateExercise

router = APIRouter()


# ── Exercises ──────────────────────────────────────────────────────────────

class ExerciseIn(BaseModel):
    name:     str
    category: Optional[str] = None
    muscles:  Optional[str] = None


@router.get("/exercises")
def list_exercises(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(Exercise)
        .filter((Exercise.is_global == True) | (Exercise.user_id == current_user.id))
        .order_by(Exercise.category, Exercise.name)
        .all()
    )
    return [{"id": e.id, "name": e.name, "category": e.category,
             "muscles": e.muscles, "is_global": e.is_global} for e in rows]


@router.post("/exercises", status_code=status.HTTP_201_CREATED)
def create_exercise(data: ExerciseIn, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    ex = Exercise(user_id=current_user.id, name=data.name.strip(),
                  category=data.category, muscles=data.muscles, is_global=False)
    db.add(ex); db.commit(); db.refresh(ex)
    return {"id": ex.id, "name": ex.name, "category": ex.category,
            "muscles": ex.muscles, "is_global": False}


@router.delete("/exercises/{ex_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exercise(ex_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    ex = db.query(Exercise).filter(
        Exercise.id == ex_id, Exercise.user_id == current_user.id,
        Exercise.is_global == False
    ).first()
    if not ex:
        raise HTTPException(status_code=404, detail="Übung nicht gefunden oder nicht löschbar")
    db.delete(ex); db.commit()


# ── Templates ──────────────────────────────────────────────────────────────

class TemplateIn(BaseModel):
    name: str


def _template_dict(t: WorkoutTemplate) -> dict:
    return {
        "id":   t.id,
        "name": t.name,
        "exercises": [{"exercise_id": te.exercise_id} for te in t.exercises],
    }


@router.get("/templates")
def list_templates(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (db.query(WorkoutTemplate)
            .filter(WorkoutTemplate.user_id == current_user.id)
            .order_by(WorkoutTemplate.name).all())
    return [_template_dict(t) for t in rows]


@router.post("/templates", status_code=status.HTTP_201_CREATED)
def create_template(data: TemplateIn, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    t = WorkoutTemplate(user_id=current_user.id, name=data.name.strip())
    db.add(t); db.commit(); db.refresh(t)
    return _template_dict(t)


@router.delete("/templates/{tpl_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(tpl_id: int, db: Session = Depends(get_db),
                    current_user: User = Depends(get_current_user)):
    t = db.query(WorkoutTemplate).filter(
        WorkoutTemplate.id == tpl_id, WorkoutTemplate.user_id == current_user.id
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Vorlage nicht gefunden")
    db.delete(t); db.commit()


class TemplateExerciseIn(BaseModel):
    exercise_id: int


@router.post("/templates/{tpl_id}/exercises", status_code=status.HTTP_201_CREATED)
def add_template_exercise(tpl_id: int, data: TemplateExerciseIn,
                          db: Session = Depends(get_db),
                          current_user: User = Depends(get_current_user)):
    t = db.query(WorkoutTemplate).filter(
        WorkoutTemplate.id == tpl_id, WorkoutTemplate.user_id == current_user.id
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Vorlage nicht gefunden")
    next_order = max((te.sort_order for te in t.exercises), default=-1) + 1
    db.add(WorkoutTemplateExercise(template_id=tpl_id, exercise_id=data.exercise_id, sort_order=next_order))
    db.commit(); db.refresh(t)
    return _template_dict(t)


@router.delete("/templates/{tpl_id}/exercises/{ex_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_template_exercise(tpl_id: int, ex_id: int,
                             db: Session = Depends(get_db),
                             current_user: User = Depends(get_current_user)):
    t = db.query(WorkoutTemplate).filter(
        WorkoutTemplate.id == tpl_id, WorkoutTemplate.user_id == current_user.id
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Vorlage nicht gefunden")
    te = db.query(WorkoutTemplateExercise).filter(
        WorkoutTemplateExercise.template_id == tpl_id,
        WorkoutTemplateExercise.exercise_id == ex_id,
    ).first()
    if te:
        db.delete(te); db.commit()


# ── Sessions ───────────────────────────────────────────────────────────────

class SetIn(BaseModel):
    exercise_id: int
    set_nr:      int
    reps:        Optional[int]   = None
    weight_kg:   Optional[float] = None
    duration_s:  Optional[int]   = None


class SessionIn(BaseModel):
    session_date: str
    template_id:  Optional[int] = None
    duration_min: Optional[int] = None
    notes:        Optional[str] = None
    sets:         List[SetIn]   = []


def _session_dict(s: WorkoutSession) -> dict:
    return {
        "id":           s.id,
        "session_date": s.session_date.isoformat() if s.session_date else None,
        "template_id":  s.template_id,
        "duration_min": s.duration_min,
        "notes":        s.notes,
        "sets": [
            {
                "id":                ws.id,
                "exercise_id":       ws.exercise_id,
                "exercise_name":     ws.exercise.name     if ws.exercise else "",
                "exercise_category": ws.exercise.category if ws.exercise else "",
                "set_nr":    ws.set_nr,
                "reps":      ws.reps,
                "weight_kg": float(ws.weight_kg) if ws.weight_kg else None,
                "duration_s": ws.duration_s,
            }
            for ws in sorted(s.sets, key=lambda x: (x.exercise_id, x.set_nr))
        ],
    }


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(WorkoutSession)
        .filter(WorkoutSession.user_id == current_user.id)
        .order_by(WorkoutSession.session_date.desc())
        .limit(100).all()
    )
    return [_session_dict(s) for s in rows]


@router.post("/sessions", status_code=status.HTTP_201_CREATED)
def create_session(data: SessionIn, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    try:
        parsed_date = date_type.fromisoformat(data.session_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Ungültiges Datumsformat (YYYY-MM-DD)")
    sess = WorkoutSession(
        user_id=current_user.id, session_date=parsed_date,
        template_id=data.template_id, duration_min=data.duration_min, notes=data.notes,
    )
    db.add(sess); db.flush()
    for ws in data.sets:
        db.add(WorkoutSet(session_id=sess.id, exercise_id=ws.exercise_id,
                          set_nr=ws.set_nr, reps=ws.reps,
                          weight_kg=ws.weight_kg, duration_s=ws.duration_s))
    db.commit(); db.refresh(sess)
    return _session_dict(sess)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: int, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    sess = db.query(WorkoutSession).filter(
        WorkoutSession.id == session_id, WorkoutSession.user_id == current_user.id
    ).first()
    if not sess:
        raise HTTPException(status_code=404, detail="Einheit nicht gefunden")
    db.delete(sess); db.commit()
