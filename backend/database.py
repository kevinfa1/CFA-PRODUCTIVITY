"""Configuración de base de datos SQLAlchemy (SQLite por defecto, migrable a PostgreSQL)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATA_DIR = Path(os.getenv("CFA_DATA_DIR", "data"))
UPLOADS_DIR = DATA_DIR / "uploads"
DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_DB_URL = f"sqlite:///{(DATA_DIR / 'cfa.db').as_posix()}"
DATABASE_URL = os.getenv("CFA_DATABASE_URL", DEFAULT_DB_URL)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    """Clase base declarativa de SQLAlchemy."""


def init_db() -> None:
    """Crea las tablas si no existen."""
    import backend.models  # noqa: F401

    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    """Dependencia de FastAPI para inyectar sesión de BD por solicitud."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
