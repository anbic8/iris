from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import extract
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Activity, Trackpoint, User

router = APIRouter()


def _activity_to_dict(a: Activity) -> dict:
    return {
        "id": a.id,
        "sport_type": a.sport_type,
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "duration_s": a.duration_s,
        "distance_m": float(a.distance_m) if a.distance_m is not None else None,
        "elevation_gain_m": float(a.elevation_gain_m) if a.elevation_gain_m is not None else None,
        "avg_hr": a.avg_hr,
        "max_hr": a.max_hr,
        "avg_pace": float(a.avg_pace) if a.avg_pace is not None else None,
        "notes": a.notes,
    }


@router.get("/")
def list_activities(
    sport_type: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Activity).filter(Activity.user_id == current_user.id)
    if sport_type:
        query = query.filter(Activity.sport_type == sport_type)
    if year:
        query = query.filter(extract("year", Activity.start_time) == year)
    activities = query.order_by(Activity.start_time.desc()).all()
    return [_activity_to_dict(a) for a in activities]


@router.get("/{activity_id}")
def get_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    activity = db.query(Activity).filter(
        Activity.id == activity_id,
        Activity.user_id == current_user.id,
    ).first()
    if not activity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")
    return _activity_to_dict(activity)


@router.get("/{activity_id}/trackpoints")
def get_trackpoints(
    activity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    activity = db.query(Activity).filter(
        Activity.id == activity_id,
        Activity.user_id == current_user.id,
    ).first()
    if not activity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")
    points = db.query(Trackpoint).filter(Trackpoint.activity_id == activity_id).all()
    return [
        {
            "lat": float(p.lat),
            "lon": float(p.lon),
            "elevation": float(p.elevation) if p.elevation is not None else None,
            "hr": p.hr,
            "timestamp": p.timestamp.isoformat() if p.timestamp else None,
        }
        for p in points
    ]


@router.delete("/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    activity = db.query(Activity).filter(
        Activity.id == activity_id,
        Activity.user_id == current_user.id,
    ).first()
    if not activity:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity not found")
    db.delete(activity)
    db.commit()
