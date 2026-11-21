"""Modelos SQL del sistema CFA: Proyectos, Elementos, Cuadrillas, Programación, Asistencia y Capturas."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    location: Mapped[str] = mapped_column(String(200), default="")
    geofence_lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    geofence_lng: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    geofence_radius_m: Mapped[float] = mapped_column(Float, default=100.0)
    north_offset_deg: Mapped[float] = mapped_column(Float, default=0.0)
    floorplan_svg: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    elements: Mapped[list["WallElement"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="WallElement.id"
    )
    crews: Mapped[list["Crew"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="Crew.id"
    )
    schedule_items: Mapped[list["WeeklyScheduleItem"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="WeeklyScheduleItem.walk_order"
    )


class WallElement(Base):
    __tablename__ = "wall_elements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    room_name: Mapped[str] = mapped_column(String(100), nullable=False)
    wall_name: Mapped[str] = mapped_column(String(120), nullable=False)
    svg_element_id: Mapped[str] = mapped_column(String(80), default="")
    trade: Mapped[str] = mapped_column(String(60), default="mamposteria")
    gross_area_m2: Mapped[float] = mapped_column(Float, default=10.0)
    openings_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    net_area_m2: Mapped[float] = mapped_column(Float, default=10.0)
    apu_target_m2_per_hh: Mapped[float] = mapped_column(Float, default=1.2)
    expected_heading_deg: Mapped[float] = mapped_column(Float, default=0.0)

    # Referencia Día 1 y estado acumulado aprobado
    day1_photo_path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    day1_rectified_path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    calibration_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(30), default="not_started")  # not_started | in_progress | completed

    project: Mapped["Project"] = relationship(back_populates="elements")
    captures: Mapped[list["DailyCapture"]] = relationship(
        back_populates="element", cascade="all, delete-orphan", order_by="DailyCapture.created_at.desc()"
    )


class Crew(Base):
    __tablename__ = "crews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    trade: Mapped[str] = mapped_column(String(60), default="mamposteria")

    project: Mapped["Project"] = relationship(back_populates="crews")
    workers: Mapped[list["Worker"]] = relationship(
        back_populates="crew", cascade="all, delete-orphan", order_by="Worker.id"
    )


class Worker(Base):
    __tablename__ = "workers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    crew_id: Mapped[int] = mapped_column(ForeignKey("crews.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(60), default="Oficial")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    crew: Mapped["Crew"] = relationship(back_populates="workers")


class WeeklyScheduleItem(Base):
    __tablename__ = "weekly_schedule_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    element_id: Mapped[int] = mapped_column(ForeignKey("wall_elements.id", ondelete="CASCADE"), index=True)
    crew_id: Mapped[Optional[int]] = mapped_column(ForeignKey("crews.id", ondelete="SET NULL"), nullable=True)
    walk_order: Mapped[int] = mapped_column(Integer, default=1)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    turn_hint: Mapped[str] = mapped_column(String(160), default="")

    project: Mapped["Project"] = relationship(back_populates="schedule_items")
    element: Mapped["WallElement"] = relationship()
    crew: Mapped[Optional["Crew"]] = relationship()


class AttendanceLog(Base):
    __tablename__ = "attendance_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    crew_id: Mapped[int] = mapped_column(ForeignKey("crews.id", ondelete="CASCADE"), index=True)
    work_date: Mapped[str] = mapped_column(String(16), index=True)  # YYYY-MM-DD
    present_count: Mapped[int] = mapped_column(Integer, default=0)
    total_workers: Mapped[int] = mapped_column(Integer, default=0)
    total_hh: Mapped[float] = mapped_column(Float, default=0.0)
    inside_geofence: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    distance_m: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    group_photo_path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    crew: Mapped["Crew"] = relationship()
    entries: Mapped[list["AttendanceEntry"]] = relationship(
        back_populates="log", cascade="all, delete-orphan", order_by="AttendanceEntry.id"
    )


class AttendanceEntry(Base):
    __tablename__ = "attendance_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    log_id: Mapped[int] = mapped_column(ForeignKey("attendance_logs.id", ondelete="CASCADE"), index=True)
    worker_id: Mapped[Optional[int]] = mapped_column(ForeignKey("workers.id", ondelete="SET NULL"), nullable=True)
    worker_name: Mapped[str] = mapped_column(String(120), nullable=False)
    role: Mapped[str] = mapped_column(String(60), default="Oficial")
    status: Mapped[str] = mapped_column(String(20), default="presente")  # presente | parcial | ausente
    normal_hours: Mapped[float] = mapped_column(Float, default=8.0)
    extra_hours: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str] = mapped_column(String(80), default="")

    log: Mapped["AttendanceLog"] = relationship(back_populates="entries")


class DailyCapture(Base):
    __tablename__ = "daily_captures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    element_id: Mapped[int] = mapped_column(ForeignKey("wall_elements.id", ondelete="CASCADE"), index=True)
    crew_id: Mapped[Optional[int]] = mapped_column(ForeignKey("crews.id", ondelete="SET NULL"), nullable=True)
    work_date: Mapped[str] = mapped_column(String(16), index=True)  # YYYY-MM-DD
    capture_type: Mapped[str] = mapped_column(
        String(30), default="daily_progress"
    )  # day1_calibration | daily_progress | no_progress | forced_voice_note
    stop_reason: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    photo_path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    overlay_path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    voice_note_path: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)

    calculated_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    delta_area_m2: Mapped[float] = mapped_column(Float, default=0.0)
    alignment_inliers: Mapped[int] = mapped_column(Integer, default=0)
    inside_geofence: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    vision_notes: Mapped[str] = mapped_column(Text, default="")
    gemini_audit_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    approval_status: Mapped[str] = mapped_column(
        String(20), default="pending"
    )  # pending | approved | adjusted | rejected
    approved_area_m2: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    approved_by: Mapped[str] = mapped_column(String(80), default="")
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    element: Mapped["WallElement"] = relationship(back_populates="captures")
    crew: Mapped[Optional["Crew"]] = relationship()
