"""Pruebas dedicadas del módulo de Asistencia (cargos Albañil/Ayudante, foto grupal, upsert y CSV)."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.database import Base, get_db
from backend.main import app


def _make_client(tmp_path: Path) -> TestClient:
    db_url = f"sqlite:///{(tmp_path / 'attendance_test.db').as_posix()}"
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


def test_only_albanil_and_ayudante_roles_allowed(tmp_path: Path) -> None:
    client = _make_client(tmp_path)
    project = client.post("/api/projects/seed-pilot").json()
    pid = project["id"]

    crews = client.get(f"/api/projects/{pid}/crews").json()
    assert len(crews) >= 2
    for crew in crews:
        for worker in crew["workers"]:
            assert worker["role"] in {"Albañil", "Ayudante"}

    crew_id = crews[0]["id"]

    # Acepta "albanil" sin tilde y lo normaliza a "Albañil"
    ok_alb = client.post(f"/api/crews/{crew_id}/workers", json={"name": "Mario Ruiz", "role": "albanil"})
    assert ok_alb.status_code == 200
    assert ok_alb.json()["role"] == "Albañil"

    # Acepta "Ayudante"
    ok_ayu = client.post(f"/api/crews/{crew_id}/workers", json={"name": "Jorge Pérez", "role": "Ayudante"})
    assert ok_ayu.status_code == 200
    assert ok_ayu.json()["role"] == "Ayudante"

    # Rechaza otros cargos como "Oficial" o "Electricista"
    bad_oficial = client.post(f"/api/crews/{crew_id}/workers", json={"name": "Raúl", "role": "Oficial"})
    assert bad_oficial.status_code == 422

    bad_other = client.post(f"/api/crews/{crew_id}/workers", json={"name": "Raúl", "role": "Electricista"})
    assert bad_other.status_code == 422


def test_attendance_guided_flow_photo_preservation_and_csv(tmp_path: Path) -> None:
    client = _make_client(tmp_path)
    project = client.post("/api/projects/seed-pilot").json()
    pid = project["id"]
    crews = client.get(f"/api/projects/{pid}/crews").json()
    crew_id = crews[0]["id"]

    # Rechaza rol inválido en registro de asistencia
    invalid_att = client.post(
        f"/api/projects/{pid}/attendance",
        json={
            "crew_id": crew_id,
            "work_date": "2026-11-22",
            "inside_geofence": True,
            "distance_m": 10.0,
            "entries": [
                {"worker_name": "Carlos Méndez", "role": "Capataz", "status": "presente", "normal_hours": 8, "extra_hours": 0}
            ],
        },
    )
    assert invalid_att.status_code == 422

    # Guarda asistencia válida (Albañil presente + extra, Albañil parcial, Ayudante ausente)
    res = client.post(
        f"/api/projects/{pid}/attendance",
        json={
            "crew_id": crew_id,
            "work_date": "2026-11-22",
            "inside_geofence": True,
            "distance_m": 18.5,
            "entries": [
                {"worker_name": "Carlos Méndez", "role": "Albañil", "status": "presente", "normal_hours": 8, "extra_hours": 2, "reason": ""},
                {"worker_name": "José López", "role": "Albañil", "status": "parcial", "normal_hours": 4, "extra_hours": 0, "reason": ""},
                {"worker_name": "Luis Morales", "role": "Ayudante", "status": "ausente", "normal_hours": 0, "extra_hours": 0, "reason": "Permiso"},
            ],
        },
    )
    assert res.status_code == 200
    log = res.json()
    assert log["present_count"] == 2
    assert log["total_workers"] == 3
    assert log["total_hh"] == 14.0

    # Subir foto grupal sellada
    photo_res = client.post(
        f"/api/attendance/{log['id']}/group-photo",
        files={"photo": ("cuadrilla.jpg", b"\xff\xd8\xff\xe0fake-jpeg-bytes", "image/jpeg")},
    )
    assert photo_res.status_code == 200
    photo_url = photo_res.json()["group_photo_url"]
    assert photo_url.startswith("/uploads/")

    # Re-guardar el mismo día y cuadrilla conserva la foto grupal previa
    res2 = client.post(
        f"/api/projects/{pid}/attendance",
        json={
            "crew_id": crew_id,
            "work_date": "2026-11-22",
            "inside_geofence": True,
            "distance_m": 18.5,
            "entries": [
                {"worker_name": "Carlos Méndez", "role": "Albañil", "status": "presente", "normal_hours": 8, "extra_hours": 1, "reason": ""},
                {"worker_name": "José López", "role": "Albañil", "status": "presente", "normal_hours": 8, "extra_hours": 0, "reason": ""},
                {"worker_name": "Luis Morales", "role": "Ayudante", "status": "ausente", "normal_hours": 0, "extra_hours": 0, "reason": "Permiso"},
            ],
        },
    )
    assert res2.status_code == 200
    assert res2.json()["total_hh"] == 17.0
    assert res2.json()["group_photo_path"] == photo_url

    # Exportar CSV incluye roles Albañil y Ayudante y motivo
    csv_res = client.get(f"/api/projects/{pid}/attendance/export.csv")
    assert csv_res.status_code == 200
    assert "Albañil" in csv_res.text
    assert "Ayudante" in csv_res.text
    assert "Permiso" in csv_res.text
