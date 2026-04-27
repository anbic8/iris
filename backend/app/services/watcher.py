import logging
import shutil
import time
from pathlib import Path

from watchdog.events import FileCreatedEvent, FileSystemEventHandler
from watchdog.observers import Observer

from app.database import SessionLocal
from app.models import Activity, Trackpoint
from app.services.gpx_parser import parse_gpx

logger = logging.getLogger(__name__)
GPX_ROOT = Path("/app/gpx")


class GpxHandler(FileSystemEventHandler):
    def on_created(self, event: FileCreatedEvent):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() != ".gpx":
            return
        # Expected structure: gpx/<user_id>/inbox/<file>.gpx
        try:
            user_id = int(path.parts[-3])
        except (IndexError, ValueError):
            logger.warning("Cannot determine user_id from path: %s", path)
            return
        _wait_for_stable(path)
        _process(path, user_id)


def _wait_for_stable(path: Path, interval: float = 1.0, retries: int = 10) -> None:
    """Wait until the file size stops changing (write complete)."""
    last_size = -1
    for _ in range(retries):
        try:
            size = path.stat().st_size
        except FileNotFoundError:
            return
        if size == last_size:
            return
        last_size = size
        time.sleep(interval)


def _process(path: Path, user_id: int) -> None:
    processed_dir = path.parent.parent / "processed"
    failed_dir = path.parent.parent / "failed"
    processed_dir.mkdir(exist_ok=True)
    failed_dir.mkdir(exist_ok=True)

    try:
        activity = parse_gpx(path)
        db = SessionLocal()
        try:
            db_activity = Activity(
                user_id=user_id,
                sport_type=activity.sport_type,
                start_time=activity.start_time,
                duration_s=activity.duration_s,
                distance_m=activity.distance_m,
                elevation_gain_m=activity.elevation_gain_m,
                avg_hr=activity.avg_hr,
                max_hr=activity.max_hr,
                avg_pace=activity.avg_pace,
                gpx_file_path=str(processed_dir / path.name),
            )
            db.add(db_activity)
            db.flush()
            db.bulk_save_objects([
                Trackpoint(
                    activity_id=db_activity.id,
                    lat=tp.lat,
                    lon=tp.lon,
                    elevation=tp.elevation,
                    hr=tp.hr,
                    timestamp=tp.timestamp,
                )
                for tp in activity.trackpoints
                if tp.timestamp
            ])
            db.commit()
            logger.info("Imported %s for user %d, activity %d", path.name, user_id, db_activity.id)
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
        shutil.move(str(path), processed_dir / path.name)
    except Exception as exc:
        logger.error("Failed to process %s: %s", path, exc)
        shutil.move(str(path), failed_dir / path.name)


def start_watcher() -> Observer:
    observer = Observer()
    observer.schedule(GpxHandler(), str(GPX_ROOT), recursive=True)
    observer.start()
    logger.info("Watching %s for GPX files", GPX_ROOT)
    return observer
