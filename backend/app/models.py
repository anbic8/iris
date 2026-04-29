from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Enum as SAEnum,
    ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    name          = Column(String(100), nullable=False)
    email         = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    is_admin      = Column(Boolean, nullable=False, default=False)
    max_hr        = Column(Integer, nullable=True)
    birth_year    = Column(Integer, nullable=True)
    weight_kg     = Column(Numeric(5, 2), nullable=True)
    hr_zones      = Column(Text, nullable=True)
    resting_hr    = Column(Integer, nullable=True)
    gender        = Column(SAEnum("male", "female"), nullable=False, default="male")
    created_at    = Column(DateTime, default=datetime.utcnow)


class Activity(Base):
    __tablename__ = "activities"
    __table_args__ = (UniqueConstraint("user_id", "start_time", name="uq_activity"),)

    id               = Column(Integer, primary_key=True, autoincrement=True)
    user_id          = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sport_type       = Column(SAEnum("running", "cycling", "hiking", "other", "trail"), nullable=False, default="other")
    start_time       = Column(DateTime, nullable=False)
    duration_s       = Column(Integer, nullable=False)
    distance_m       = Column(Numeric(10, 2), nullable=False)
    elevation_gain_m = Column(Numeric(8, 2), nullable=True)
    avg_hr           = Column(Integer, nullable=True)
    max_hr           = Column(Integer, nullable=True)
    avg_pace         = Column(Numeric(8, 2), nullable=True)
    gpx_file_path    = Column(String(500), nullable=True)
    notes            = Column(Text, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)


class PersonalRecord(Base):
    __tablename__ = "personal_records"

    user_id     = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    distance_km = Column(Numeric(6, 3), primary_key=True)
    best_s      = Column(Integer, nullable=False)
    pace_min_km = Column(Numeric(8, 3), nullable=False)
    activity_id = Column(Integer, ForeignKey("activities.id", ondelete="SET NULL"), nullable=True)
    recorded_at = Column(DateTime, nullable=True)


class Trackpoint(Base):
    __tablename__ = "trackpoints"

    id          = Column(BigInteger, primary_key=True, autoincrement=True)
    activity_id = Column(Integer, ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    lat         = Column(Numeric(10, 7), nullable=False)
    lon         = Column(Numeric(10, 7), nullable=False)
    elevation   = Column(Numeric(8, 2), nullable=True)
    hr          = Column(Integer, nullable=True)
    timestamp   = Column(DateTime, nullable=False)
