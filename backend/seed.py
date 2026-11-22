"""Generador de obra piloto precargada (Entrada → Cocina → Baño → Cuarto 2, 8 muros SVG)."""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from backend.models import (
    AttendanceEntry,
    AttendanceLog,
    Crew,
    Project,
    WallElement,
    WeeklyScheduleItem,
    Worker,
)

PILOT_FLOORPLAN_SVG = """<svg viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="480" fill="#0f172a" rx="14" />
  <!-- Zonas / Ambientes -->
  <rect x="40" y="40" width="220" height="190" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />
  <rect x="260" y="40" width="260" height="190" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />
  <rect x="520" y="40" width="240" height="190" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />
  <rect x="260" y="230" width="500" height="210" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />

  <!-- Etiquetas de ambientes -->
  <text x="150" y="140" fill="#94a3b8" font-size="16" font-weight="700" text-anchor="middle">ENTRADA</text>
  <text x="390" y="140" fill="#94a3b8" font-size="16" font-weight="700" text-anchor="middle">COCINA</text>
  <text x="640" y="140" fill="#94a3b8" font-size="16" font-weight="700" text-anchor="middle">BAÑO</text>
  <text x="510" y="340" fill="#94a3b8" font-size="18" font-weight="700" text-anchor="middle">CUARTO 2</text>

  <!-- Indicador de Norte -->
  <g transform="translate(115, 340)">
    <circle cx="0" cy="0" r="28" fill="#111827" stroke="#38bdf8" stroke-width="2" />
    <polygon points="0,-20 7,6 0,0 -7,6" fill="#38bdf8" />
    <text x="0" y="21" fill="#f8fafc" font-size="11" font-weight="800" text-anchor="middle">N</text>
  </g>

  <!-- 8 Muros interactivos (se colorean automáticamente: rojo/amarillo/verde) -->
  <line id="wall-m01" data-wall-code="M-01" x1="40" y1="40" x2="260" y2="40" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m02" data-wall-code="M-02" x1="40" y1="40" x2="40" y2="230" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m03" data-wall-code="M-03" x1="260" y1="40" x2="520" y2="40" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m04" data-wall-code="M-04" x1="520" y1="40" x2="520" y2="230" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m05" data-wall-code="M-05" x1="520" y1="40" x2="760" y2="40" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m06" data-wall-code="M-06" x1="760" y1="40" x2="760" y2="230" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m07" data-wall-code="M-07" x1="760" y1="230" x2="760" y2="440" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m08" data-wall-code="M-08" x1="260" y1="440" x2="760" y2="440" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />

  <!-- Etiquetas de códigos de muro -->
  <text x="150" y="28" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">M-01</text>
  <text x="22" y="140" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">M-02</text>
  <text x="390" y="28" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">M-03</text>
  <text x="502" y="135" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="end">M-04</text>
  <text x="640" y="28" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">M-05</text>
  <text x="780" y="140" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">M-06</text>
  <text x="780" y="340" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">M-07</text>
  <text x="510" y="462" fill="#cbd5e1" font-size="11" font-weight="700" text-anchor="middle">M-08</text>
</svg>
"""


def seed_pilot_project(db: Session) -> Project:
    """Crea un proyecto piloto completo si no existe uno, o retorna el existente."""
    existing = db.query(Project).order_by(Project.id.asc()).first()
    if existing is not None:
        return existing

    project = Project(
        name="Casa Las Flores",
        location="Casa Las Flores",
        geofence_lat=14.6349,
        geofence_lng=-90.5069,
        geofence_radius_m=100.0,
        north_offset_deg=0.0,
        floorplan_svg=PILOT_FLOORPLAN_SVG,
    )
    db.add(project)
    db.flush()

    crew_mamp = Crew(project_id=project.id, name="Planilla Casa Las Flores", trade="mamposteria")
    crew_rep = Crew(project_id=project.id, name="Apoyo Casa Las Flores", trade="repello")
    db.add_all([crew_mamp, crew_rep])
    db.flush()

    workers_mamp = [
        Worker(crew_id=crew_mamp.id, name="Moises Mendoza", role="Albañil"),
        Worker(crew_id=crew_mamp.id, name="Maycol Lara", role="Albañil"),
        Worker(crew_id=crew_mamp.id, name="Mario Blass", role="Albañil"),
        Worker(crew_id=crew_mamp.id, name="Jose Alexander Alegria", role="Albañil"),
        Worker(crew_id=crew_mamp.id, name="Celestino", role="Albañil"),
        Worker(crew_id=crew_mamp.id, name="Pablo Blass", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Alberto Dormez", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Uriel Hernandez", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Nervin Hernandez", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Daniel Espinoza", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Fernando Jose Sandino", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Simon Bonilla", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Edwin Jimenez", role="Ayudante"),
        Worker(crew_id=crew_mamp.id, name="Cristhian Espinoza", role="Ayudante"),
    ]
    workers_rep: list[Worker] = []
    db.add_all(workers_mamp)

    project_pia = Project(
        name="Pia Pia",
        location="Pia Pia",
        geofence_lat=14.6349,
        geofence_lng=-90.5069,
        geofence_radius_m=100.0,
        north_offset_deg=0.0,
        floorplan_svg=PILOT_FLOORPLAN_SVG,
    )
    db.add(project_pia)
    db.flush()

    crew_pia = Crew(project_id=project_pia.id, name="Planilla Pia Pia", trade="mamposteria")
    db.add(crew_pia)
    db.flush()
    db.add_all(
        [
            Worker(crew_id=crew_pia.id, name="Manuel Reyes", role="Albañil"),
            Worker(crew_id=crew_pia.id, name="Jose Alcides Noguera", role="Albañil"),
            Worker(crew_id=crew_pia.id, name="Gabriel Mena", role="Albañil"),
        ]
    )
    db.flush()

    wall_specs = [
        ("M-01", "Entrada", "Muro Norte", "wall-m01", "mamposteria", 10.4, 2.1, 1.25, 0.0, 8.3, "completed", crew_mamp.id, "Inicio del recorrido: Entrada"),
        ("M-02", "Entrada", "Muro Oeste", "wall-m02", "mamposteria", 9.1, 0.0, 1.25, 270.0, 5.2, "in_progress", crew_mamp.id, "Gira 90° izquierda: Muro Oeste"),
        ("M-03", "Cocina", "Muro Norte", "wall-m03", "mamposteria", 12.0, 1.8, 1.20, 0.0, 6.4, "in_progress", crew_mamp.id, "Camina a Cocina: Muro Norte"),
        ("M-04", "Cocina", "Muro Este", "wall-m04", "mamposteria", 9.6, 0.0, 1.20, 90.0, 0.0, "not_started", crew_mamp.id, "Gira a la derecha: Muro Este"),
        ("M-05", "Baño", "Muro Norte", "wall-m05", "repello", 8.5, 0.9, 1.50, 0.0, 7.6, "completed", crew_rep.id, "Camina a Baño: Muro Norte"),
        ("M-06", "Baño", "Muro Este", "wall-m06", "repello", 7.8, 0.0, 1.50, 90.0, 3.1, "in_progress", crew_rep.id, "Gira a la derecha: Muro Este"),
        ("M-07", "Cuarto 2", "Muro Este", "wall-m07", "repello", 11.2, 1.5, 1.45, 90.0, 0.0, "not_started", crew_rep.id, "Camina a Cuarto 2: Muro Este"),
        ("M-08", "Cuarto 2", "Muro Sur", "wall-m08", "pintura", 14.0, 2.4, 2.80, 180.0, 0.0, "not_started", crew_rep.id, "Gira a la derecha: Muro Sur"),
    ]

    for idx, spec in enumerate(wall_specs, start=1):
        code, room, wall, svg_id, trade, gross, openings, apu, heading, approved, status, crew_id, hint = spec
        net = round(max(gross - openings, 0.1), 2)
        elem = WallElement(
            project_id=project.id,
            code=code,
            room_name=room,
            wall_name=wall,
            svg_element_id=svg_id,
            trade=trade,
            gross_area_m2=gross,
            openings_area_m2=openings,
            net_area_m2=net,
            apu_target_m2_per_hh=apu,
            expected_heading_deg=heading,
            approved_area_m2=min(approved, net),
            status=status,
        )
        db.add(elem)
        db.flush()

        db.add(
            WeeklyScheduleItem(
                project_id=project.id,
                element_id=elem.id,
                crew_id=crew_id,
                walk_order=idx,
                active=True,
                turn_hint=hint,
            )
        )

    # Asistencia inicial del día de hoy para que los KPIs de productividad (m²/HH) muestren datos reales
    today_str = date.today().isoformat()
    log = AttendanceLog(
        project_id=project.id,
        crew_id=crew_mamp.id,
        work_date=today_str,
        present_count=len(workers_mamp),
        total_workers=len(workers_mamp),
        total_hh=float(len(workers_mamp) * 8),
        inside_geofence=True,
        distance_m=12.0,
    )
    db.add(log)
    db.flush()
    for w in workers_mamp:
        db.add(
            AttendanceEntry(
                log_id=log.id,
                worker_id=w.id,
                worker_name=w.name,
                role=w.role,
                status="presente",
                normal_hours=8.0,
                extra_hours=0.0,
            )
        )

    db.commit()
    db.refresh(project)
    return project
