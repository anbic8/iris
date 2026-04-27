import math
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Activity, PersonalRecord, Trackpoint, User

router = APIRouter()

_cache: dict[int, dict] = {}

STANDARD_KM     = [1.0, 3.0, 5.0, 10.0, 21.095, 42.195]
STANDARD_LABELS = ["1 km", "3 km", "5 km", "10 km", "Halbmarathon", "Marathon"]


def invalidate_cache(user_id: int) -> None:
    _cache.pop(user_id, None)


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _best_time_s(trackpoints: list, target_km: float) -> Optional[int]:
    if len(trackpoints) < 2:
        return None
    cum = [0.0]
    for i in range(1, len(trackpoints)):
        p, q = trackpoints[i - 1], trackpoints[i]
        cum.append(cum[-1] + _haversine_km(float(p.lat), float(p.lon), float(q.lat), float(q.lon)))
    if cum[-1] < target_km * 0.95:
        return None
    best: Optional[int] = None
    right = 0
    for left in range(len(trackpoints)):
        while right < len(trackpoints) - 1 and cum[right] - cum[left] < target_km:
            right += 1
        if cum[right] - cum[left] >= target_km:
            t0, t1 = trackpoints[left].timestamp, trackpoints[right].timestamp
            if t0 and t1:
                elapsed = int((t1 - t0).total_seconds())
                if elapsed > 0 and (best is None or elapsed < best):
                    best = elapsed
    return best


def _summary(a: Activity) -> dict:
    return {
        "id": a.id,
        "sport_type": a.sport_type,
        "start_time": a.start_time.isoformat() if a.start_time else None,
        "distance_m": float(a.distance_m) if a.distance_m else None,
        "elevation_gain_m": float(a.elevation_gain_m) if a.elevation_gain_m else None,
        "avg_pace": float(a.avg_pace) if a.avg_pace else None,
        "duration_s": a.duration_s,
    }


def _load_standard_prs(user_id: int, db: Session) -> list:
    rows = db.query(PersonalRecord).filter(PersonalRecord.user_id == user_id).all()
    pr_map = {float(r.distance_km): r for r in rows}
    result = []
    for km, label in zip(STANDARD_KM, STANDARD_LABELS):
        r = pr_map.get(km)
        result.append({
            "label": label,
            "km": km,
            "best_s": r.best_s,
            "pace_min_km": float(r.pace_min_km),
            "activity_id": r.activity_id,
            "date": r.recorded_at.isoformat() if r.recorded_at else None,
        } if r else None)
    return result


def _compute_records(user_id: int, db: Session) -> dict:
    all_acts = db.query(Activity).filter(Activity.user_id == user_id).all()
    running  = [a for a in all_acts if a.sport_type == "running"]
    longest  = max(all_acts, key=lambda a: float(a.distance_m or 0), default=None)
    most_ele = max((a for a in all_acts if a.elevation_gain_m), key=lambda a: float(a.elevation_gain_m), default=None)
    fast_pace = min((a for a in running if a.avg_pace), key=lambda a: float(a.avg_pace), default=None)
    return {
        "longest":        _summary(longest)    if longest    else None,
        "most_elevation": _summary(most_ele)   if most_ele   else None,
        "fastest_pace":   _summary(fast_pace)  if fast_pace  else None,
    }


def full_recalculate_prs(user_id: int, db: Session) -> None:
    """Full recalculation from all trackpoints. Used after delete or sport_type change."""
    db.query(PersonalRecord).filter(PersonalRecord.user_id == user_id).delete()

    running = db.query(Activity).filter(
        Activity.user_id == user_id,
        Activity.sport_type == "running",
    ).all()

    if running:
        run_ids = [a.id for a in running]
        raw_tp = (
            db.query(Trackpoint)
            .filter(Trackpoint.activity_id.in_(run_ids))
            .order_by(Trackpoint.activity_id, Trackpoint.timestamp)
            .all()
        )
        tp_by_act: dict[int, list] = defaultdict(list)
        for tp in raw_tp:
            tp_by_act[tp.activity_id].append(tp)

        best: dict[float, tuple] = {}
        for a in running:
            tps = tp_by_act[a.id]
            for target_km in STANDARD_KM:
                if a.distance_m and float(a.distance_m) / 1000 < target_km * 0.95:
                    continue
                t = _best_time_s(tps, target_km)
                if t and (target_km not in best or t < best[target_km][0]):
                    best[target_km] = (t, a.id, a.start_time)

        for target_km, (best_s, act_id, date) in best.items():
            db.add(PersonalRecord(
                user_id=user_id,
                distance_km=target_km,
                best_s=best_s,
                pace_min_km=round((best_s / 60) / target_km, 3),
                activity_id=act_id,
                recorded_at=date,
            ))

    db.commit()
    invalidate_cache(user_id)


def update_prs_for_activity(activity_id: int, user_id: int, db: Session) -> None:
    """Check a single new activity against stored PRs. Fast path for uploads."""
    activity = db.query(Activity).filter(Activity.id == activity_id).first()
    if not activity or activity.sport_type != "running":
        return

    trackpoints = (
        db.query(Trackpoint)
        .filter(Trackpoint.activity_id == activity_id)
        .order_by(Trackpoint.timestamp)
        .all()
    )
    if len(trackpoints) < 2:
        return

    changed = False
    for target_km in STANDARD_KM:
        if activity.distance_m and float(activity.distance_m) / 1000 < target_km * 0.95:
            continue
        t = _best_time_s(trackpoints, target_km)
        if t is None:
            continue
        existing = db.query(PersonalRecord).filter(
            PersonalRecord.user_id == user_id,
            PersonalRecord.distance_km == target_km,
        ).first()
        if existing is None or t < existing.best_s:
            if existing is None:
                db.add(PersonalRecord(
                    user_id=user_id,
                    distance_km=target_km,
                    best_s=t,
                    pace_min_km=round((t / 60) / target_km, 3),
                    activity_id=activity.id,
                    recorded_at=activity.start_time,
                ))
            else:
                existing.best_s = t
                existing.pace_min_km = round((t / 60) / target_km, 3)
                existing.activity_id = activity.id
                existing.recorded_at = activity.start_time
            changed = True

    if changed:
        db.commit()
    invalidate_cache(user_id)


@router.get("/")
def get_prs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.id in _cache:
        return _cache[current_user.id]

    # First request: if no PRs stored yet, run full calculation once
    has_any = db.query(PersonalRecord).filter(
        PersonalRecord.user_id == current_user.id
    ).first()
    if not has_any:
        full_recalculate_prs(current_user.id, db)

    result = {
        "standard": _load_standard_prs(current_user.id, db),
        "records":  _compute_records(current_user.id, db),
    }
    _cache[current_user.id] = result
    return result


@router.post("/recalculate", status_code=status.HTTP_202_ACCEPTED)
def recalculate_prs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Force full PR recalculation. Useful after manual data fixes."""
    full_recalculate_prs(current_user.id, db)
    return {"detail": "Neuberechnung abgeschlossen"}
