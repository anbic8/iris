import base64
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth import verify_password
from app.database import get_db
from app.models import Activity, Trackpoint, User
from app.routers.prs import invalidate_cache
from app.services.gpx_parser import parse_gpx

router = APIRouter()

_DAV_HEADERS = {"DAV": "1", "Allow": "OPTIONS, PUT", "MS-Author-Via": "DAV"}


def _authenticate(request: Request, db: Session) -> User | None:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Basic "):
        return None
    try:
        email, password = base64.b64decode(auth[6:]).decode().split(":", 1)
    except Exception:
        return None
    user = db.query(User).filter(User.email == email).first()
    return user if user and verify_password(password, user.password_hash) else None


def _unauthorized():
    return Response(
        status_code=401,
        headers={**_DAV_HEADERS, "WWW-Authenticate": 'Basic realm="IRIS"'},
    )


@router.options("/{path:path}")
def webdav_options(path: str = ""):
    return Response(status_code=200, headers=_DAV_HEADERS)


@router.put("/{filename}")
async def webdav_put(filename: str, request: Request, db: Session = Depends(get_db)):
    user = _authenticate(request, db)
    if not user:
        return _unauthorized()

    if not filename.lower().endswith(".gpx"):
        return Response(status_code=415, content="Only .gpx files are accepted")

    content = await request.body()
    if not content:
        return Response(status_code=400, content="Empty body")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".gpx", delete=False) as tmp:
            tmp.write(content)
            tmp_path = Path(tmp.name)
        parsed = parse_gpx(tmp_path)
    except Exception as exc:
        return Response(status_code=422, content=f"GPX parse error: {exc}")
    finally:
        if tmp_path:
            tmp_path.unlink(missing_ok=True)

    try:
        db_act = Activity(
            user_id=user.id,
            sport_type=parsed.sport_type,
            start_time=parsed.start_time,
            duration_s=parsed.duration_s,
            distance_m=parsed.distance_m,
            elevation_gain_m=parsed.elevation_gain_m,
            avg_hr=parsed.avg_hr,
            max_hr=parsed.max_hr,
            avg_pace=parsed.avg_pace,
        )
        db.add(db_act)
        db.flush()
        db.bulk_save_objects([
            Trackpoint(
                activity_id=db_act.id,
                lat=tp.lat, lon=tp.lon,
                elevation=tp.elevation,
                hr=tp.hr,
                timestamp=tp.timestamp,
            )
            for tp in parsed.trackpoints if tp.timestamp
        ])
        db.commit()
    except Exception:
        db.rollback()
        # 409 so RunnerUp doesn't retry endlessly on duplicates
        return Response(status_code=409, content="Activity already exists")

    invalidate_cache(user.id)
    return Response(status_code=201)
