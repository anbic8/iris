from datetime import datetime

from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, Enum as SAEnum,
    ForeignKey, Integer, Numeric, String, Text, UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    name             = Column(String(100), nullable=False)
    email            = Column(String(255), nullable=False, unique=True)
    password_hash    = Column(String(255), nullable=False)
    is_admin         = Column(Boolean, nullable=False, default=False)
    max_hr           = Column(Integer, nullable=True)
    birth_year       = Column(Integer, nullable=True)
    weight_kg        = Column(Numeric(5, 2), nullable=True)
    hr_zones         = Column(Text, nullable=True)
    resting_hr       = Column(Integer, nullable=True)
    gender           = Column(SAEnum("male", "female"), nullable=False, default="male")
    strength_enabled = Column(Boolean, nullable=False, default=False)
    created_at       = Column(DateTime, default=datetime.utcnow)


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


class LactateTest(Base):
    __tablename__ = "lactate_tests"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    test_date  = Column(Date, nullable=False)
    lt_pace    = Column(Numeric(6, 3), nullable=True)
    lt_hr      = Column(Integer, nullable=True)
    ias_pace   = Column(Numeric(6, 3), nullable=True)
    ias_hr     = Column(Integer, nullable=True)
    vo2max     = Column(Numeric(5, 1), nullable=True)
    notes      = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    stages     = relationship("LactateStage", cascade="all, delete-orphan", back_populates="test", order_by="LactateStage.stage_nr")


class LactateStage(Base):
    __tablename__ = "lactate_stages"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    test_id    = Column(Integer, ForeignKey("lactate_tests.id", ondelete="CASCADE"), nullable=False)
    stage_nr   = Column(Integer, nullable=False)
    speed_kmh  = Column(Numeric(4, 1), nullable=False)
    hr         = Column(Integer, nullable=True)
    lactate    = Column(Numeric(4, 2), nullable=True)
    test       = relationship("LactateTest", back_populates="stages")


class Exercise(Base):
    __tablename__ = "exercises"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    user_id   = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    name      = Column(String(100), nullable=False)
    category  = Column(String(50), nullable=True)
    muscles   = Column(String(200), nullable=True)
    is_global = Column(Boolean, nullable=False, default=False)


class WorkoutTemplate(Base):
    __tablename__ = "workout_templates"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name       = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class WorkoutSession(Base):
    __tablename__ = "workout_sessions"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    template_id  = Column(Integer, ForeignKey("workout_templates.id", ondelete="SET NULL"), nullable=True)
    session_date = Column(Date, nullable=False)
    duration_min = Column(Integer, nullable=True)
    notes        = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    sets         = relationship("WorkoutSet", cascade="all, delete-orphan", back_populates="session")


class WorkoutSet(Base):
    __tablename__ = "workout_sets"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    session_id  = Column(Integer, ForeignKey("workout_sessions.id", ondelete="CASCADE"), nullable=False)
    exercise_id = Column(Integer, ForeignKey("exercises.id", ondelete="CASCADE"), nullable=False)
    set_nr      = Column(Integer, nullable=False)
    reps        = Column(Integer, nullable=True)
    weight_kg   = Column(Numeric(5, 2), nullable=True)
    duration_s  = Column(Integer, nullable=True)
    session     = relationship("WorkoutSession", back_populates="sets")
    exercise    = relationship("Exercise")
