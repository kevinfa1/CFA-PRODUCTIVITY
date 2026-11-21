"""Pruebas end-to-end del backend FastAPI (Piloto, DXF, Ruta de campo, Asistencia, Capturas, Aprobación y KPIs)."""

from __future__ import annotations

import os
from pathlib import Path

import cv2
import ezdxf
import numpy as np
from fastapi.testclient import TestClient

from vision_lab.generate_ruler import generate_aruco_marker_array


from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db
from backend.main import app


def _make_client(tmp_path: Path) -> TestClient:
    db_url = f"sqlite:///{(tmp_path / 'test.db').as_posix()}"
    engine = create_engine(db_url, connect_args={"check_same_thread": False}, future=True)
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    return TestClient(app)


def _encode_synthetic_wall_png(with_ruler: bool, progress: bool) -> bytes:
    rng = np.random.default_rng(7)
    img = rng.integers(100, 140, size=(500, 800, 3), dtype=np.uint8)
    for y in range(0, 500, 25):
        cv2.line(img, (0, y), (800, y), (70, 70, 75), 2)
    for x in range(0, 800, 60):
        cv2.line(img, (x, 0), (x, 500), (70, 70, 75), 2)
    cv2.rectangle(img, (0, 0), (80, 500), (160, 160, 160), -1)
    cv2.rectangle(img, (720, 0), (800, 500), (160, 160, 160), -1)

    if with_ruler:
        cv2.rectangle(img, (220, 340), (460, 405), (245, 245, 245), -1)
        m0 = cv2.cvtColor(generate_aruco_marker_array(0, 30), cv2.COLOR_GRAY2BGR)
        m1 = cv2.cvtColor(generate_aruco_marker_array(1, 30), cv2.COLOR_GRAY2BGR)
        img[355:385, 245:275] = m0
        img[355:385, 405:435] = m1

    if progress:
        img[80:260, 140:540] = (235, 235, 230)

    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def test_full_backend_workflow(tmp_path: Path) -> None:
    client = _make_client(tmp_path)

    # 1. Seed proyecto piloto
    r = client.post("/api/projects/seed-pilot")
    assert r.status_code == 200
    project = r.json()
    pid = project["id"]
    assert "<svg" in project["floorplan_svg"]

    # 2. Ruta de campo ordenada
    route = client.get(f"/api/projects/{pid}/field-route").json()
    assert len(route["steps"]) == 8
    first_step = route["steps"][0]
    el_id = first_step["element_id"]

    # 3. Registrar asistencia y exportar CSV
    crews = client.get(f"/api/projects/{pid}/crews").json()
    crew_id = crews[0]["id"]
    att_res = client.post(
        f"/api/projects/{pid}/attendance",
        json={
            "crew_id": crew_id,
            "work_date": "2026-11-21",
            "inside_geofence": True,
            "distance_m": 15.0,
            "entries": [
                {"worker_name": "Carlos Méndez", "role": "Oficial", "status": "presente", "normal_hours": 8, "extra_hours": 1},
                {"worker_name": "Luis Morales", "role": "Ayudante", "status": "ausente", "normal_hours": 0, "extra_hours": 0, "reason": "Falta"},
            ],
        },
    )
    assert att_res.status_code == 200
    assert att_res.json()["total_hh"] == 9.0

    csv_att = client.get(f"/api/projects/{pid}/attendance/export.csv")
    assert csv_att.status_code == 200
    assert "Carlos Méndez" in csv_att.text

    # 4. Captura Día 1 (calibración ArUco) y Día 2 (avance + aprobación 5 seg)
    day1_bytes = _encode_synthetic_wall_png(with_ruler=True, progress=False)
    c1 = client.post(
        "/api/captures",
        data={"project_id": str(pid), "element_id": str(el_id), "work_date": "2026-11-21", "capture_type": "day1_calibration"},
        files={"photo": ("day1.png", day1_bytes, "image/png")},
    )
    assert c1.status_code == 200
    assert c1.json()["capture_type"] == "day1_calibration"

    day2_bytes = _encode_synthetic_wall_png(with_ruler=False, progress=True)
    c2 = client.post(
        "/api/captures",
        data={"project_id": str(pid), "element_id": str(el_id), "crew_id": str(crew_id), "work_date": "2026-11-21"},
        files={"photo": ("day2.png", day2_bytes, "image/png")},
    )
    assert c2.status_code == 200
    cap2 = c2.json()
    assert cap2["approval_status"] == "pending"
    assert cap2["overlay_path"] is not None

    # Aprobar en 5 segundos con ajuste opcional
    ap = client.post(
        f"/api/captures/{cap2['id']}/approve",
        json={"decision": "approved", "approved_area_m2": 8.3, "approved_by": "Ing. Kevin"},
    )
    assert ap.status_code == 200
    assert ap.json()["approval_status"] == "approved"

    # 5. Válvula de escape: Sin avance hoy
    np_res = client.post(
        "/api/captures/no-progress",
        json={"project_id": pid, "element_id": route["steps"][1]["element_id"], "work_date": "2026-11-21", "stop_reason": "lluvia"},
    )
    assert np_res.status_code == 200

    # 6. Tablero de control y exportación de planilla por destajo
    dash = client.get(f"/api/projects/{pid}/dashboard?work_date=2026-11-21").json()
    assert dash["kpis"]["total_hh_today"] == 9.0
    assert dash["stop_causes"].get("lluvia") == 1

    csv_pay = client.get(f"/api/projects/{pid}/payroll/export.csv")
    assert csv_pay.status_code == 200
    assert "Ing. Kevin" in csv_pay.text


def test_dxf_import(tmp_path: Path) -> None:
    client = _make_client(tmp_path)
    p = client.post("/api/projects", json={"name": "Obra DXF"}).json()

    dxf_file = tmp_path / "sample.dxf"
    doc = ezdxf.new("R2010")
    msp = doc.modelspace()
    msp.add_line((0, 0), (4, 0), dxfattribs={"layer": "Cocina"})
    msp.add_line((4, 0), (4, 3), dxfattribs={"layer": "Cocina"})
    doc.saveas(str(dxf_file))

    res = client.post(
        f"/api/projects/{p['id']}/import-dxf",
        files={"file": ("sample.dxf", dxf_file.read_bytes(), "application/dxf")},
    )
    assert res.status_code == 200
    assert res.json()["imported_walls"] == 2
    assert "wall-dxf-01" in res.json()["floorplan_svg"]
