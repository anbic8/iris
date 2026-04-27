import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.services.gpx_parser import ParsedActivity, ParsedTrackpoint


def _parse_ts(raw: str) -> Optional[datetime]:
    """Parse "YYYY-MM-DD HH:MM:SS ±HHMM" → naive UTC datetime."""
    try:
        dt = datetime.strptime(raw.strip(), "%Y-%m-%d %H:%M:%S %z")
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def parse_json_activity(path: Path, sport_type: str = "other") -> ParsedActivity:
    with open(path, "r", encoding="utf-8") as f:
        points = json.load(f)

    if not isinstance(points, list) or not points:
        raise ValueError("JSON enthält keine Trackpoints")

    # Validate expected keys
    required = {"timestamp", "latitude", "longitude"}
    if not required.issubset(points[0].keys()):
        raise ValueError(f"Unbekanntes JSON-Format – erwartet: {required}")

    last = points[-1]
    first = points[0]

    start_time = _parse_ts(first["timestamp"])
    if start_time is None:
        raise ValueError(f"Timestamp nicht lesbar: {first['timestamp']!r}")

    duration_s = int(last.get("duration", 0)) // 1000
    distance_m = float(last.get("distance", 0))
    elevation_gain_m = float(last.get("elevation_gain", 0)) or None
    avg_pace = round((duration_s / 60) / (distance_m / 1000), 2) if distance_m > 0 else None

    trackpoints = []
    for p in points:
        ts = _parse_ts(p["timestamp"])
        if ts is None:
            continue
        trackpoints.append(ParsedTrackpoint(
            lat=float(p["latitude"]),
            lon=float(p["longitude"]),
            elevation=float(p["altitude"]) if p.get("altitude") is not None else None,
            hr=None,
            timestamp=ts,
        ))

    return ParsedActivity(
        sport_type=sport_type,
        start_time=start_time,
        duration_s=max(duration_s, 1),
        distance_m=round(distance_m, 2),
        elevation_gain_m=round(elevation_gain_m, 2) if elevation_gain_m else None,
        avg_hr=None,
        max_hr=None,
        avg_pace=avg_pace,
        trackpoints=trackpoints,
    )
