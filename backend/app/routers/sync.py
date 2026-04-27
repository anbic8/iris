import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user
from app.config import settings
from app.models import User

router = APIRouter()


@router.post("/")
def trigger_sync(current_user: User = Depends(get_current_user)):
    if not current_user.nas_sync_path:
        raise HTTPException(status_code=400, detail="Kein NAS-Pfad konfiguriert (⚙ Einstellungen → NAS Sync)")
    if not settings.NAS_HOST:
        raise HTTPException(status_code=500, detail="NAS_HOST nicht in .env gesetzt")

    inbox = Path(f"/app/gpx/{current_user.id}/inbox")
    inbox.mkdir(parents=True, exist_ok=True)

    key = settings.NAS_SSH_KEY_PATH
    cmd = ["rsync", "-avz", "--ignore-existing"]
    if key and Path(key).exists():
        cmd += ["-e", f"ssh -i {key} -o StrictHostKeyChecking=no -o BatchMode=yes"]
    cmd += [
        f"{settings.NAS_USER}@{settings.NAS_HOST}:{current_user.nas_sync_path}/",
        str(inbox) + "/",
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=500, detail="Sync-Timeout (>2 Min)")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="rsync nicht gefunden")

    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=result.stderr.strip() or "Sync fehlgeschlagen")

    transferred = [l for l in result.stdout.splitlines() if l.strip().lower().endswith(".gpx")]
    return {"transferred": len(transferred), "detail": f"{len(transferred)} neue GPX-Datei(en) übertragen"}
