import math
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import Activity, Trackpoint, User

router = APIRouter()

_cache: dict[int, dict] = {}


def invalidate_cache(user_id: int) -> None:
    _cache.pop(user_id, None)

STANDARD_KM = [1.0, 5.0, 10.0, 21.095, 42.195]
STANDARD_LABELS = ["1 km", "5 km", "10 km", "Halbmarathon", "Marathon"]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _best_time_s(trackpoints: list, target_km: float) -> Optional[int]:
    """Sliding window: fastest time to cover target_km within a trackpoint list."""
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


@router.get("/")
def get_prs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.id in _cache:
        return _cache[current_user.id]

    all_acts = db.query(Activity).filter(Activity.user_id == current_user.id).all()
    running  = [a for a in all_acts if a.sport_type == "running"]

    # Load all trackpoints for running activities in one query
    run_ids = [a.id for a in running]
    raw_tp = (
        db.query(Trackpoint)
        .filter(Trackpoint.activity_id.in_(run_ids))
        .order_by(Trackpoint.activity_id, Trackpoint.timestamp)
        .all()
    ) if run_ids else []

    tp_by_act: dict[int, list] = defaultdict(list)
    for tp in raw_tp:
        tp_by_act[tp.activity_id].append(tp)

    # Standard distance PRs
    standard = []
    for target_km, label in zip(STANDARD_KM, STANDARD_LABELS):
        best_entry = None
        for a in running:
            if a.distance_m and float(a.distance_m) / 1000 < target_km * 0.95:
                continue
            t = _best_time_s(tp_by_act[a.id], target_km)
            if t and (best_entry is None or t < best_entry["best_s"]):
                pace = (t / 60) / target_km
                best_entry = {
                    "label": label,
                    "km": target_km,
                    "best_s": t,
                    "pace_min_km": round(pace, 3),
                    "activity_id": a.id,
                    "date": a.start_time.isoformat() if a.start_time else None,
                }
        standard.append(best_entry)

    # Records (all sports)
    longest    = max(all_acts, key=lambda a: float(a.distance_m or 0), default=None)
    most_ele   = max((a for a in all_acts if a.elevation_gain_m), key=lambda a: float(a.elevation_gain_m), default=None)
    fast_pace  = min((a for a in running if a.avg_pace), key=lambda a: float(a.avg_pace), default=None)

    result = {
        "standard": standard,
        "records": {
            "longest":        _summary(longest)   if longest   else None,
            "most_elevation": _summary(most_ele)  if most_ele  else None,
            "fastest_pace":   _summary(fast_pace) if fast_pace else None,
        },
    }
    _cache[current_user.id] = result
    return result
