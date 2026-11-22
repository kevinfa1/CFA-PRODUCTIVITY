"""API REST principal de CFA: Oficina, Recorrido Guiado, Asistencia, Motor de Visión y Tablero."""

from __future__ import annotations

import csv
import io
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session, joinedload

from backend.database import UPLOADS_DIR, get_db, init_db
from backend.dxf_importer import import_dxf_to_svg_and_elements
from backend.models import (
    AttendanceEntry,
    AttendanceLog,
    Crew,
    DailyCapture,
    Project,
    WallElement,
    WeeklyScheduleItem,
    Worker,
)
from backend.schemas import (
    ApprovalDecision,
    AttendanceLogCreate,
    AttendanceLogOut,
    CrewCreate,
    CrewOut,
    DailyCaptureOut,
    NoProgressCreate,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    ScheduleBulkUpdate,
    ScheduleItemOut,
    WallElementCreate,
    WallElementOut,
    WallElementUpdate,
    WorkerCreate,
    WorkerOut,
)
from backend.seed import seed_pilot_project
from backend.vision_service import process_daily_progress_photo, process_day1_photo


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="CFA Productivity API",
    description="Sistema Interno de Control de Avance, Productividad y Asistencia en Obra",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")


def _to_public_upload_url(path_str: Optional[str]) -> Optional[str]:
    if not path_str:
        return None
    p = Path(path_str)
    try:
        rel = p.resolve().relative_to(UPLOADS_DIR.resolve())
        return f"/uploads/{rel.as_posix()}"
    except ValueError:
        return path_str


def _save_upload_file(upload: UploadFile, subdir: str, suffix_fallback: str = ".jpg") -> Path:
    dest_dir = UPLOADS_DIR / subdir
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(upload.filename or "").suffix.lower() or suffix_fallback
    dest = dest_dir / f"{uuid.uuid4().hex}{ext}"
    content = upload.file.read()
    dest.write_bytes(content)
    return dest


def _recompute_element_status(element: WallElement) -> None:
    if element.approved_area_m2 <= 0.01:
        element.status = "not_started"
    elif element.approved_area_m2 >= element.net_area_m2 * 0.98:
        element.status = "completed"
    else:
        element.status = "in_progress"


# ---------------------------------------------------------------------------
# Health & Proyectos
# ---------------------------------------------------------------------------


@app.get("/api/health")
def health_check() -> dict:
    return {"status": "ok", "service": "cfa-productivity-api"}


@app.get("/api/projects", response_model=List[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).order_by(Project.id.asc()).all()


@app.post("/api/projects/seed-pilot", response_model=ProjectOut)
def create_or_get_pilot_project(db: Session = Depends(get_db)):
    return seed_pilot_project(db)


@app.post("/api/projects", response_model=ProjectOut)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(**payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@app.patch("/api/projects/{project_id}", response_model=ProjectOut)
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(project, k, v)
    db.commit()
    db.refresh(project)
    return project


@app.post("/api/projects/{project_id}/import-dxf")
def import_project_dxf(
    project_id: int,
    file: UploadFile = File(...),
    default_wall_height_m: float = Form(2.60),
    db: Session = Depends(get_db),
):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    saved_dxf = _save_upload_file(file, f"project_{project_id}/plans", suffix_fallback=".dxf")
    try:
        svg_str, extracted_walls = import_dxf_to_svg_and_elements(
            saved_dxf, default_wall_height_m=default_wall_height_m
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Error al leer DXF: {exc}") from exc

    project.floorplan_svg = svg_str
    created = []
    for item in extracted_walls:
        elem = WallElement(project_id=project_id, **item)
        db.add(elem)
        created.append(elem)
    db.commit()
    return {
        "project_id": project_id,
        "imported_walls": len(created),
        "floorplan_svg": svg_str,
    }


# ---------------------------------------------------------------------------
# Elementos (Muros / Zonas)
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/elements", response_model=List[WallElementOut])
def list_elements(project_id: int, db: Session = Depends(get_db)):
    items = (
        db.query(WallElement)
        .filter(WallElement.project_id == project_id)
        .order_by(WallElement.id.asc())
        .all()
    )
    for e in items:
        e.day1_photo_path = _to_public_upload_url(e.day1_photo_path)
        e.day1_rectified_path = _to_public_upload_url(e.day1_rectified_path)
    return items


@app.post("/api/projects/{project_id}/elements", response_model=WallElementOut)
def create_element(project_id: int, payload: WallElementCreate, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    net_area = round(max(payload.gross_area_m2 - payload.openings_area_m2, 0.1), 2)
    elem = WallElement(
        project_id=project_id,
        **payload.model_dump(),
        net_area_m2=net_area,
    )
    db.add(elem)
    db.commit()
    db.refresh(elem)
    return elem


@app.patch("/api/elements/{element_id}", response_model=WallElementOut)
def update_element(element_id: int, payload: WallElementUpdate, db: Session = Depends(get_db)):
    elem = db.get(WallElement, element_id)
    if not elem:
        raise HTTPException(status_code=404, detail="Elemento no encontrado")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(elem, k, v)
    elem.net_area_m2 = round(max(elem.gross_area_m2 - elem.openings_area_m2, 0.1), 2)
    _recompute_element_status(elem)
    db.commit()
    db.refresh(elem)
    return elem


# ---------------------------------------------------------------------------
# Cuadrillas y Trabajadores
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/crews", response_model=List[CrewOut])
def list_crews(project_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Crew)
        .options(joinedload(Crew.workers))
        .filter(Crew.project_id == project_id)
        .order_by(Crew.id.asc())
        .all()
    )


@app.post("/api/projects/{project_id}/crews", response_model=CrewOut)
def create_crew(project_id: int, payload: CrewCreate, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")
    crew = Crew(project_id=project_id, name=payload.name, trade=payload.trade)
    db.add(crew)
    db.flush()
    for w in payload.workers:
        db.add(Worker(crew_id=crew.id, name=w.name, role=w.role))
    db.commit()
    db.refresh(crew)
    return crew


@app.post("/api/crews/{crew_id}/workers", response_model=WorkerOut)
def add_worker(crew_id: int, payload: WorkerCreate, db: Session = Depends(get_db)):
    if not db.get(Crew, crew_id):
        raise HTTPException(status_code=404, detail="Cuadrilla no encontrada")
    worker = Worker(crew_id=crew_id, name=payload.name, role=payload.role)
    db.add(worker)
    db.commit()
    db.refresh(worker)
    return worker


# ---------------------------------------------------------------------------
# Programación Semanal y Ruta de Campo
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/schedule", response_model=List[ScheduleItemOut])
def get_schedule(project_id: int, db: Session = Depends(get_db)):
    return (
        db.query(WeeklyScheduleItem)
        .options(
            joinedload(WeeklyScheduleItem.element),
            joinedload(WeeklyScheduleItem.crew).joinedload(Crew.workers),
        )
        .filter(WeeklyScheduleItem.project_id == project_id)
        .order_by(WeeklyScheduleItem.walk_order.asc())
        .all()
    )


@app.put("/api/projects/{project_id}/schedule", response_model=List[ScheduleItemOut])
def save_schedule(project_id: int, payload: ScheduleBulkUpdate, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    db.query(WeeklyScheduleItem).filter(WeeklyScheduleItem.project_id == project_id).delete()
    for idx, item in enumerate(payload.items, start=1):
        db.add(
            WeeklyScheduleItem(
                project_id=project_id,
                element_id=item.element_id,
                crew_id=item.crew_id,
                walk_order=item.walk_order or idx,
                active=item.active,
                turn_hint=item.turn_hint,
            )
        )
    db.commit()
    return get_schedule(project_id, db)


@app.get("/api/projects/{project_id}/field-route")
def get_field_route(project_id: int, work_date: Optional[str] = None, db: Session = Depends(get_db)):
    """Entrega la ruta secuencial ordenada para el Modo Recorrido Guiado (PWA)."""
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    target_date = work_date or date.today().isoformat()
    schedule_items = (
        db.query(WeeklyScheduleItem)
        .options(
            joinedload(WeeklyScheduleItem.element),
            joinedload(WeeklyScheduleItem.crew).joinedload(Crew.workers),
        )
        .filter(WeeklyScheduleItem.project_id == project_id, WeeklyScheduleItem.active.is_(True))
        .order_by(WeeklyScheduleItem.walk_order.asc())
        .all()
    )

    today_captures = (
        db.query(DailyCapture)
        .filter(DailyCapture.project_id == project_id, DailyCapture.work_date == target_date)
        .all()
    )
    captured_element_ids = {c.element_id for c in today_captures}

    steps = []
    for idx, item in enumerate(schedule_items, start=1):
        el = item.element
        steps.append(
            {
                "step_index": idx,
                "total_steps": len(schedule_items),
                "schedule_item_id": item.id,
                "element_id": el.id,
                "code": el.code,
                "room_name": el.room_name,
                "wall_name": el.wall_name,
                "trade": el.trade,
                "net_area_m2": el.net_area_m2,
                "approved_area_m2": el.approved_area_m2,
                "status": el.status,
                "expected_heading_deg": (el.expected_heading_deg + project.north_offset_deg) % 360.0,
                "needs_day1_ruler": el.day1_photo_path is None,
                "ghost_photo_url": _to_public_upload_url(el.day1_photo_path),
                "turn_hint": item.turn_hint or f"{el.room_name} — {el.wall_name}",
                "crew_id": item.crew_id,
                "crew_name": item.crew.name if item.crew else "Sin cuadrilla",
                "captured_today": el.id in captured_element_ids,
            }
        )

    return {
        "project_id": project.id,
        "project_name": project.name,
        "work_date": target_date,
        "geofence": {
            "lat": project.geofence_lat,
            "lng": project.geofence_lng,
            "radius_m": project.geofence_radius_m,
        },
        "steps": steps,
    }


# ---------------------------------------------------------------------------
# Asistencia en 1 Toque (alimenta HH reales de productividad y planilla)
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/attendance", response_model=List[AttendanceLogOut])
def list_attendance(project_id: int, work_date: Optional[str] = None, db: Session = Depends(get_db)):
    q = (
        db.query(AttendanceLog)
        .options(joinedload(AttendanceLog.entries))
        .filter(AttendanceLog.project_id == project_id)
    )
    if work_date:
        q = q.filter(AttendanceLog.work_date == work_date)
    logs = q.order_by(AttendanceLog.work_date.desc(), AttendanceLog.id.desc()).all()
    for log in logs:
        log.group_photo_path = _to_public_upload_url(log.group_photo_path)
    return logs


@app.post("/api/projects/{project_id}/attendance", response_model=AttendanceLogOut)
def upsert_attendance(project_id: int, payload: AttendanceLogCreate, db: Session = Depends(get_db)):
    if not db.get(Project, project_id):
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    # Reemplazar registro del mismo día y cuadrilla si ya existía
    existing = (
        db.query(AttendanceLog)
        .filter(
            AttendanceLog.project_id == project_id,
            AttendanceLog.crew_id == payload.crew_id,
            AttendanceLog.work_date == payload.work_date,
        )
        .first()
    )
    if existing:
        db.delete(existing)
        db.flush()

    present_count = sum(1 for e in payload.entries if e.status != "ausente")
    total_hh = round(
        sum((e.normal_hours + e.extra_hours) for e in payload.entries if e.status != "ausente"),
        2,
    )

    log = AttendanceLog(
        project_id=project_id,
        crew_id=payload.crew_id,
        work_date=payload.work_date,
        present_count=present_count,
        total_workers=len(payload.entries),
        total_hh=total_hh,
        inside_geofence=payload.inside_geofence,
        distance_m=payload.distance_m,
    )
    db.add(log)
    db.flush()

    for entry in payload.entries:
        db.add(AttendanceEntry(log_id=log.id, **entry.model_dump()))

    db.commit()
    db.refresh(log)
    return log


@app.post("/api/attendance/{log_id}/group-photo")
def upload_attendance_group_photo(log_id: int, photo: UploadFile = File(...), db: Session = Depends(get_db)):
    log = db.get(AttendanceLog, log_id)
    if not log:
        raise HTTPException(status_code=404, detail="Registro de asistencia no encontrado")
    saved = _save_upload_file(photo, f"project_{log.project_id}/attendance")
    log.group_photo_path = str(saved)
    db.commit()
    return {"log_id": log_id, "group_photo_url": _to_public_upload_url(str(saved))}


@app.get("/api/projects/{project_id}/attendance/export.csv", response_class=PlainTextResponse)
def export_attendance_csv(project_id: int, db: Session = Depends(get_db)):
    logs = (
        db.query(AttendanceLog)
        .options(joinedload(AttendanceLog.entries), joinedload(AttendanceLog.crew))
        .filter(AttendanceLog.project_id == project_id)
        .order_by(AttendanceLog.work_date.desc())
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "fecha",
            "cuadrilla",
            "trabajador",
            "rol",
            "estado",
            "horas_normales",
            "horas_extra",
            "total_hh",
            "motivo_ausencia",
            "en_obra_100m",
            "distancia_m",
        ]
    )
    for log in logs:
        crew_name = log.crew.name if log.crew else str(log.crew_id)
        for e in log.entries:
            hh = 0.0 if e.status == "ausente" else round(e.normal_hours + e.extra_hours, 2)
            writer.writerow(
                [
                    log.work_date,
                    crew_name,
                    e.worker_name,
                    e.role,
                    e.status,
                    e.normal_hours,
                    e.extra_hours,
                    hh,
                    e.reason,
                    "SI" if log.inside_geofence else ("NO" if log.inside_geofence is False else "N/A"),
                    round(log.distance_m, 1) if log.distance_m is not None else "",
                ]
            )
    return PlainTextResponse(
        content="\ufeff" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="cfa_asistencia_proyecto_{project_id}.csv"'},
    )


# ---------------------------------------------------------------------------
# Capturas de Campo, Válvulas de Escape y Aprobación Rápida (5 segundos)
# ---------------------------------------------------------------------------


@app.post("/api/captures", response_model=DailyCaptureOut)
def upload_daily_capture(
    project_id: int = Form(...),
    element_id: int = Form(...),
    work_date: str = Form(default_factory=lambda: date.today().isoformat()),
    crew_id: Optional[int] = Form(None),
    capture_type: str = Form("daily_progress"),
    notes: str = Form(""),
    inside_geofence: Optional[bool] = Form(None),
    photo: UploadFile = File(...),
    voice_note: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    element = db.get(WallElement, element_id)
    if not element or element.project_id != project_id:
        raise HTTPException(status_code=404, detail="Muro/elemento no encontrado en el proyecto")

    saved_photo = _save_upload_file(photo, f"project_{project_id}/captures")
    saved_voice = _save_upload_file(voice_note, f"project_{project_id}/voice", suffix_fallback=".webm") if voice_note else None

    calculated_m2 = element.approved_area_m2
    delta_m2 = 0.0
    inliers = 0
    overlay_path_str: Optional[str] = None
    vision_notes = ""
    gemini_json: Optional[str] = None

    # Si el muro aún no tiene referencia del Día 1, procesamos esta foto como calibración Día 1
    is_day1 = (capture_type == "day1_calibration") or (element.day1_photo_path is None)
    if is_day1:
        capture_type = "day1_calibration"
        rect_out = UPLOADS_DIR / f"project_{project_id}/rectified/el_{element_id}_day1.jpg"
        rect_path, cal_json, vision_notes = process_day1_photo(saved_photo, rect_out)
        element.day1_photo_path = str(saved_photo)
        element.day1_rectified_path = rect_path
        element.calibration_json = cal_json
        overlay_path_str = rect_path
    else:
        overlay_out = UPLOADS_DIR / f"project_{project_id}/overlays/{saved_photo.stem}_overlay.jpg"
        res = process_daily_progress_photo(
            photo_path=saved_photo,
            day1_rectified_path=Path(element.day1_rectified_path) if element.day1_rectified_path else None,
            calibration_json=element.calibration_json,
            net_area_m2=element.net_area_m2,
            previous_approved_m2=element.approved_area_m2,
            overlay_out_path=overlay_out,
        )
        calculated_m2 = res["calculated_area_m2"]
        delta_m2 = res["delta_area_m2"]
        inliers = res["alignment_inliers"]
        overlay_path_str = res["overlay_path"]
        vision_notes = res["vision_notes"]
        gemini_json = res.get("gemini_audit_json")

    capture = DailyCapture(
        project_id=project_id,
        element_id=element_id,
        crew_id=crew_id,
        work_date=work_date,
        capture_type=capture_type,
        notes=notes,
        photo_path=str(saved_photo),
        overlay_path=overlay_path_str,
        voice_note_path=str(saved_voice) if saved_voice else None,
        calculated_area_m2=calculated_m2,
        delta_area_m2=delta_m2,
        alignment_inliers=inliers,
        inside_geofence=inside_geofence,
        vision_notes=vision_notes,
        gemini_audit_json=gemini_json,
        approval_status="approved" if is_day1 else "pending",
        approved_area_m2=element.approved_area_m2 if is_day1 else None,
    )
    db.add(capture)
    db.commit()
    db.refresh(capture)

    capture.photo_path = _to_public_upload_url(capture.photo_path)
    capture.overlay_path = _to_public_upload_url(capture.overlay_path)
    capture.voice_note_path = _to_public_upload_url(capture.voice_note_path)
    return capture


@app.post("/api/captures/no-progress", response_model=DailyCaptureOut)
def report_no_progress(payload: NoProgressCreate, db: Session = Depends(get_db)):
    element = db.get(WallElement, payload.element_id)
    if not element or element.project_id != payload.project_id:
        raise HTTPException(status_code=404, detail="Muro/elemento no encontrado")

    capture = DailyCapture(
        project_id=payload.project_id,
        element_id=payload.element_id,
        crew_id=payload.crew_id,
        work_date=payload.work_date,
        capture_type="no_progress",
        stop_reason=payload.stop_reason,
        notes=payload.notes,
        calculated_area_m2=element.approved_area_m2,
        delta_area_m2=0.0,
        inside_geofence=payload.inside_geofence,
        vision_notes=f"Sin avance reportado en campo: {payload.stop_reason}",
        approval_status="approved",
        approved_area_m2=element.approved_area_m2,
    )
    db.add(capture)
    db.commit()
    db.refresh(capture)
    return capture


@app.get("/api/projects/{project_id}/approvals", response_model=List[DailyCaptureOut])
def list_approvals(project_id: int, status: Optional[str] = None, db: Session = Depends(get_db)):
    q = (
        db.query(DailyCapture)
        .options(joinedload(DailyCapture.element))
        .filter(DailyCapture.project_id == project_id)
    )
    if status:
        q = q.filter(DailyCapture.approval_status == status)
    items = q.order_by(DailyCapture.created_at.desc()).limit(50).all()
    for c in items:
        c.photo_path = _to_public_upload_url(c.photo_path)
        c.overlay_path = _to_public_upload_url(c.overlay_path)
        c.voice_note_path = _to_public_upload_url(c.voice_note_path)
    return items


@app.post("/api/captures/{capture_id}/approve", response_model=DailyCaptureOut)
def approve_capture(capture_id: int, payload: ApprovalDecision, db: Session = Depends(get_db)):
    capture = (
        db.query(DailyCapture)
        .options(joinedload(DailyCapture.element))
        .filter(DailyCapture.id == capture_id)
        .first()
    )
    if not capture:
        raise HTTPException(status_code=404, detail="Captura no encontrada")

    if payload.decision not in {"approved", "adjusted", "rejected"}:
        raise HTTPException(status_code=400, detail="Decisión inválida. Usa approved, adjusted o rejected.")

    capture.approval_status = payload.decision
    capture.approved_by = payload.approved_by
    capture.approved_at = datetime.now(timezone.utc)

    if payload.decision in {"approved", "adjusted"}:
        final_area = (
            payload.approved_area_m2
            if payload.approved_area_m2 is not None
            else capture.calculated_area_m2
        )
        final_area = round(min(max(final_area, 0.0), capture.element.net_area_m2), 2)
        prev_area = capture.element.approved_area_m2
        capture.approved_area_m2 = final_area
        capture.delta_area_m2 = round(max(0.0, final_area - prev_area), 2)
        capture.element.approved_area_m2 = final_area
        _recompute_element_status(capture.element)

    db.commit()
    db.refresh(capture)
    capture.photo_path = _to_public_upload_url(capture.photo_path)
    capture.overlay_path = _to_public_upload_url(capture.overlay_path)
    return capture


# ---------------------------------------------------------------------------
# Tablero de Control, KPIs de Productividad (m²/HH vs APU) y Planilla Destajo
# ---------------------------------------------------------------------------


@app.get("/api/projects/{project_id}/dashboard")
def get_project_dashboard(project_id: int, work_date: Optional[str] = None, db: Session = Depends(get_db)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    target_date = work_date or date.today().isoformat()
    elements = db.query(WallElement).filter(WallElement.project_id == project_id).order_by(WallElement.id.asc()).all()
    captures_today = (
        db.query(DailyCapture)
        .filter(DailyCapture.project_id == project_id, DailyCapture.work_date == target_date)
        .all()
    )
    pending_count = (
        db.query(DailyCapture)
        .filter(DailyCapture.project_id == project_id, DailyCapture.approval_status == "pending")
        .count()
    )
    attendance_today = (
        db.query(AttendanceLog)
        .filter(AttendanceLog.project_id == project_id, AttendanceLog.work_date == target_date)
        .all()
    )

    total_net_m2 = round(sum(e.net_area_m2 for e in elements), 2)
    total_approved_m2 = round(sum(e.approved_area_m2 for e in elements), 2)
    progress_pct = round((total_approved_m2 / total_net_m2 * 100.0), 1) if total_net_m2 > 0 else 0.0

    delta_today_m2 = round(
        sum(c.delta_area_m2 for c in captures_today if c.approval_status in {"approved", "adjusted"}),
        2,
    )
    total_hh_today = round(sum(a.total_hh for a in attendance_today), 2)
    real_yield = round(delta_today_m2 / total_hh_today, 3) if total_hh_today > 0 else 0.0

    avg_apu_target = (
        round(sum(e.apu_target_m2_per_hh for e in elements) / len(elements), 2) if elements else 1.2
    )

    stop_causes: dict[str, int] = {}
    for c in captures_today:
        if c.capture_type == "no_progress" and c.stop_reason:
            stop_causes[c.stop_reason] = stop_causes.get(c.stop_reason, 0) + 1

    alerts = []
    if total_hh_today > 0 and delta_today_m2 == 0 and len(captures_today) > 0:
        alerts.append("Alerta de horas improductivas: se registraron HH hoy sin avance físico aprobado.")
    if total_hh_today > 0 and real_yield < avg_apu_target * 0.8:
        alerts.append(
            f"Desvío de productividad: rendimiento real ({real_yield:.2f} m²/HH) por debajo de meta APU ({avg_apu_target:.2f} m²/HH)."
        )
    if pending_count > 0:
        alerts.append(f"Tienes {pending_count} captura(s) pendiente(s) de aprobación rápida (5 seg).")

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "location": project.location,
            "north_offset_deg": project.north_offset_deg,
            "floorplan_svg": project.floorplan_svg,
        },
        "work_date": target_date,
        "kpis": {
            "total_net_m2": total_net_m2,
            "total_approved_m2": total_approved_m2,
            "progress_pct": progress_pct,
            "delta_today_m2": delta_today_m2,
            "total_hh_today": total_hh_today,
            "real_yield_m2_per_hh": real_yield,
            "apu_target_m2_per_hh": avg_apu_target,
            "pending_approvals": pending_count,
        },
        "alerts": alerts,
        "stop_causes": stop_causes,
        "elements": [
            {
                "id": e.id,
                "code": e.code,
                "room_name": e.room_name,
                "wall_name": e.wall_name,
                "svg_element_id": e.svg_element_id,
                "trade": e.trade,
                "net_area_m2": e.net_area_m2,
                "approved_area_m2": e.approved_area_m2,
                "progress_pct": round(min(100.0, (e.approved_area_m2 / e.net_area_m2) * 100.0), 1)
                if e.net_area_m2 > 0
                else 0.0,
                "apu_target_m2_per_hh": e.apu_target_m2_per_hh,
                "status": e.status,
            }
            for e in elements
        ],
    }


@app.get("/api/projects/{project_id}/payroll/export.csv", response_class=PlainTextResponse)
def export_piecework_payroll_csv(project_id: int, db: Session = Depends(get_db)):
    """Exporta respaldo de planilla por destajo (avance aprobado por fecha, muro y cuadrilla)."""
    captures = (
        db.query(DailyCapture)
        .options(joinedload(DailyCapture.element), joinedload(DailyCapture.crew))
        .filter(
            DailyCapture.project_id == project_id,
            DailyCapture.approval_status.in_(["approved", "adjusted"]),
        )
        .order_by(DailyCapture.work_date.desc(), DailyCapture.id.desc())
        .all()
    )
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        [
            "fecha",
            "codigo_muro",
            "ambiente",
            "muro",
            "partida",
            "cuadrilla",
            "delta_m2_aprobado",
            "acumulado_m2",
            "area_neta_m2",
            "estado_aprobacion",
            "aprobado_por",
        ]
    )
    for c in captures:
        el = c.element
        writer.writerow(
            [
                c.work_date,
                el.code if el else "",
                el.room_name if el else "",
                el.wall_name if el else "",
                el.trade if el else "",
                c.crew.name if c.crew else "",
                round(c.delta_area_m2, 2),
                round(c.approved_area_m2 or 0.0, 2),
                round(el.net_area_m2, 2) if el else "",
                c.approval_status,
                c.approved_by,
            ]
        )
    return PlainTextResponse(
        content="\ufeff" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="cfa_destajo_proyecto_{project_id}.csv"'},
    )


# ---------------------------------------------------------------------------
# Servir PWA compilada (frontend/dist) en producción (1 sola URL HTTPS)
# ---------------------------------------------------------------------------

FRONTEND_DIST_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if (FRONTEND_DIST_DIR / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST_DIR), html=True), name="frontend")

