"""Esquemas Pydantic de entrada y salida para la API REST de CFA."""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

WorkerRole = Literal["Albañil", "Ayudante"]
ALLOWED_WORKER_ROLES = ("Albañil", "Ayudante")


def _normalize_worker_role(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("El cargo debe ser 'Albañil' o 'Ayudante'")
    cleaned = value.strip().lower()
    if cleaned in {"albañil", "albanil"}:
        return "Albañil"
    if cleaned == "ayudante":
        return "Ayudante"
    raise ValueError("Cargo no permitido. Solo se aceptan 'Albañil' o 'Ayudante'")


class ProjectCreate(BaseModel):
    name: str
    location: str = ""
    geofence_lat: Optional[float] = None
    geofence_lng: Optional[float] = None
    geofence_radius_m: float = 100.0
    north_offset_deg: float = 0.0
    floorplan_svg: str = ""


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    geofence_lat: Optional[float] = None
    geofence_lng: Optional[float] = None
    geofence_radius_m: Optional[float] = None
    north_offset_deg: Optional[float] = None
    floorplan_svg: Optional[str] = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    location: str
    geofence_lat: Optional[float]
    geofence_lng: Optional[float]
    geofence_radius_m: float
    north_offset_deg: float
    floorplan_svg: str
    created_at: datetime


class WallElementCreate(BaseModel):
    code: str
    room_name: str
    wall_name: str
    svg_element_id: str = ""
    trade: str = "mamposteria"
    gross_area_m2: float = Field(gt=0)
    openings_area_m2: float = Field(ge=0, default=0.0)
    apu_target_m2_per_hh: float = Field(gt=0, default=1.2)
    expected_heading_deg: float = 0.0


class WallElementUpdate(BaseModel):
    room_name: Optional[str] = None
    wall_name: Optional[str] = None
    trade: Optional[str] = None
    gross_area_m2: Optional[float] = None
    openings_area_m2: Optional[float] = None
    apu_target_m2_per_hh: Optional[float] = None
    expected_heading_deg: Optional[float] = None


class WallElementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    code: str
    room_name: str
    wall_name: str
    svg_element_id: str
    trade: str
    gross_area_m2: float
    openings_area_m2: float
    net_area_m2: float
    apu_target_m2_per_hh: float
    expected_heading_deg: float
    day1_photo_path: Optional[str]
    day1_rectified_path: Optional[str]
    approved_area_m2: float
    status: str


class WorkerCreate(BaseModel):
    name: str
    role: WorkerRole = "Albañil"

    @field_validator("role", mode="before")
    @classmethod
    def validate_role(cls, value: object) -> str:
        return _normalize_worker_role(value)


class WorkerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    crew_id: int
    name: str
    role: str
    active: bool


class CrewCreate(BaseModel):
    name: str
    trade: str = "mamposteria"
    workers: List[WorkerCreate] = Field(default_factory=list)


class CrewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    trade: str
    workers: List[WorkerOut] = Field(default_factory=list)


class ScheduleItemUpsert(BaseModel):
    element_id: int
    crew_id: Optional[int] = None
    walk_order: int = 1
    active: bool = True
    turn_hint: str = ""


class ScheduleBulkUpdate(BaseModel):
    items: List[ScheduleItemUpsert]


class ScheduleItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    element_id: int
    crew_id: Optional[int]
    walk_order: int
    active: bool
    turn_hint: str
    element: WallElementOut
    crew: Optional[CrewOut] = None


class AttendanceEntryIn(BaseModel):
    worker_id: Optional[int] = None
    worker_name: str
    role: WorkerRole = "Albañil"
    status: Literal["presente", "parcial", "ausente"] = "presente"
    normal_hours: float = 8.0
    extra_hours: float = 0.0
    reason: str = ""

    @field_validator("role", mode="before")
    @classmethod
    def validate_role(cls, value: object) -> str:
        return _normalize_worker_role(value)


class AttendanceLogCreate(BaseModel):
    crew_id: int
    work_date: str
    inside_geofence: Optional[bool] = None
    distance_m: Optional[float] = None
    entries: List[AttendanceEntryIn]


class AttendanceEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    worker_id: Optional[int]
    worker_name: str
    role: str
    status: str
    normal_hours: float
    extra_hours: float
    reason: str


class AttendanceLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    crew_id: int
    work_date: str
    present_count: int
    total_workers: int
    total_hh: float
    inside_geofence: Optional[bool]
    distance_m: Optional[float]
    group_photo_path: Optional[str]
    created_at: datetime
    entries: List[AttendanceEntryOut] = Field(default_factory=list)


class NoProgressCreate(BaseModel):
    project_id: int
    element_id: int
    crew_id: Optional[int] = None
    work_date: str
    stop_reason: str  # lluvia | falta_material | espera_plano | retrabajo | otro
    notes: str = ""
    inside_geofence: Optional[bool] = None


class ApprovalDecision(BaseModel):
    decision: str  # approved | adjusted | rejected
    approved_area_m2: Optional[float] = None
    approved_by: str = "Supervisor Oficina"


class DailyCaptureOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    element_id: int
    crew_id: Optional[int]
    work_date: str
    capture_type: str
    stop_reason: str
    notes: str
    photo_path: Optional[str]
    overlay_path: Optional[str]
    voice_note_path: Optional[str]
    calculated_area_m2: float
    delta_area_m2: float
    alignment_inliers: int
    inside_geofence: Optional[bool]
    vision_notes: str
    approval_status: str
    approved_area_m2: Optional[float]
    approved_by: str
    approved_at: Optional[datetime]
    created_at: datetime
    element: Optional[WallElementOut] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    display_name: str
    role: str
    allowed_tabs: List[str]

