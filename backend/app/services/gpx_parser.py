from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import gpxpy
import lxml.etree as lxml_etree

SPORT_TYPE_MAP = {
    "running": "running",
    "cycling": "cycling",
    "biking": "cycling",
    "hiking": "hiking",
    "walking": "hiking",
    "trail": "trail",
    "trail_running": "trail",
    "trailrunning": "trail",
    "mountain_running": "trail",
}


@dataclass
class ParsedTrackpoint:
    lat: float
    lon: float
    elevation: Optional[float]
    hr: Optional[int]
    timestamp: Optional[datetime]


@dataclass
class ParsedActivity:
    sport_type: str
    start_time: datetime
    duration_s: int
    distance_m: float
    elevation_gain_m: Optional[float]
    avg_hr: Optional[int]
    max_hr: Optional[int]
    avg_pace: Optional[float]
    trackpoints: list[ParsedTrackpoint] = field(default_factory=list)


def _read_gpx(path: Path):
    with open(path, "rb") as f:
        content = f.read()
    try:
        return gpxpy.parse(content)
    except Exception:
        # Fallback: lxml with error recovery for malformed XML (e.g. RunnerUp truncation bug)
        parser = lxml_etree.XMLParser(recover=True)
        tree = lxml_etree.fromstring(content, parser=parser)
        return gpxpy.parse(lxml_etree.tostring(tree))


def parse_gpx(path: Path, fallback_sport: str = "other") -> ParsedActivity:
    gpx = _read_gpx(path)

    sport_type = fallback_sport
    if gpx.tracks:
        track_type = (gpx.tracks[0].type or "").lower()
        sport_type = SPORT_TYPE_MAP.get(track_type, fallback_sport)

    trackpoints: list[ParsedTrackpoint] = []
    hr_values: list[int] = []

    for track in gpx.tracks:
        for segment in track.segments:
            for point in segment.points:
                hr = _extract_hr(point)
                if hr is not None:
                    hr_values.append(hr)
                ts = point.time.replace(tzinfo=None) if point.time else None
                trackpoints.append(ParsedTrackpoint(
                    lat=point.latitude,
                    lon=point.longitude,
                    elevation=point.elevation,
                    hr=hr,
                    timestamp=ts,
                ))

    moving_data = gpx.get_moving_data()
    uphill, _ = gpx.get_uphill_downhill()
    start_time = gpx.get_time_bounds().start_time

    distance_m = moving_data.moving_distance if moving_data else 0.0
    duration_s = int(moving_data.moving_time) if moving_data else 0
    avg_pace = (duration_s / 60) / (distance_m / 1000) if distance_m > 0 else None

    return ParsedActivity(
        sport_type=sport_type,
        start_time=start_time.replace(tzinfo=None) if start_time else datetime.utcnow(),
        duration_s=duration_s,
        distance_m=round(distance_m, 2),
        elevation_gain_m=round(uphill, 2) if uphill else None,
        avg_hr=int(sum(hr_values) / len(hr_values)) if hr_values else None,
        max_hr=max(hr_values) if hr_values else None,
        avg_pace=round(avg_pace, 2) if avg_pace else None,
        trackpoints=trackpoints,
    )


def _extract_hr(point) -> Optional[int]:
    """Parse <gpxtpx:hr> from Garmin/Polar extensions."""
    if not point.extensions:
        return None
    for ext in point.extensions:
        for child in list(ext):
            if child.tag.endswith("hr"):
                try:
                    return int(child.text)
                except (ValueError, TypeError):
                    pass
    return None
