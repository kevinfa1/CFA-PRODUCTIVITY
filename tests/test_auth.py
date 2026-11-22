"""Pruebas del endpoint de inicio de sesión."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.main import app


def test_login_success_and_invalid_credentials() -> None:
    client = TestClient(app)

    ok_res = client.post("/api/auth/login", json={"username": "maestro", "password": "cfa2026"})
    assert ok_res.status_code == 200
    data = ok_res.json()
    assert data["username"] == "maestro"
    assert data["role"] == "maestro"
    assert data["allowed_tabs"] == ["attendance"]
    assert data["token"]

    bad_res = client.post("/api/auth/login", json={"username": "maestro", "password": "wrong"})
    assert bad_res.status_code == 401
