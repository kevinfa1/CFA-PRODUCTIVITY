import { useEffect, useState } from "react";
import { api } from "./api";
import { offlineDb } from "./db";
import type { AuthSession, Project } from "./types";
import { AttendanceView } from "./views/AttendanceView";
import { LoginView } from "./views/LoginView";

const SESSION_STORAGE_KEY = "cfa_auth_session_v1";

function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    return parsed?.token && parsed?.username ? parsed : null;
  } catch {
    return null;
  }
}

export function App() {
  const [session, setSession] = useState<AuthSession | null>(() => loadStoredSession());
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.find((p) => p.id === selectedProjectId) ?? projects[0] ?? null;

  const refreshQueueCount = async () => {
    const [c, a] = await Promise.all([
      offlineDb.pendingCaptures.count(),
      offlineDb.pendingAttendance.count(),
    ]);
    setPendingOfflineCount(c + a);
  };

  const runSync = async () => {
    setSyncing(true);
    try {
      await api.syncOfflineQueues();
      await refreshQueueCount();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!session) return;

    const bootstrap = async () => {
      try {
        const list = await api.listProjects();
        if (list.length > 0) {
          setProjects(list);
          setSelectedProjectId((prev) => prev ?? list[0].id);
        } else {
          const pilot = await api.seedPilot();
          const refreshed = await api.listProjects();
          const finalList = refreshed.length > 0 ? refreshed : [pilot];
          setProjects(finalList);
          setSelectedProjectId(finalList[0].id);
        }
      } catch (err) {
        setError(`No se pudo conectar al backend FastAPI: ${(err as Error).message}`);
      }
      await refreshQueueCount();
    };
    void bootstrap();

    const onOnline = () => void runSync();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [session]);

  const handleAuthenticated = (newSession: AuthSession) => {
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
    } catch {
      // ignore storage errors
    }
    setError(null);
    setSession(newSession);
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    setSession(null);
    setProjects([]);
    setSelectedProjectId(null);
  };

  if (!session) {
    return <LoginView onAuthenticated={handleAuthenticated} />;
  }

  return (
    <div className="app-shell app-shell--sunlight">
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>CFA · Asistencia</span>
          {project && <span className="kpi-sub">· {project.name}</span>}
        </div>

        <nav className="nav-pills" aria-label="Navegación">
          <span className="nav-pill active" aria-current="page">
            👷 Asistencia
          </span>
          {pendingOfflineCount > 0 && (
            <button type="button" className="btn sm warn" disabled={syncing} onClick={() => void runSync()}>
              {syncing ? "Sincronizando..." : `☁️ Pendientes: ${pendingOfflineCount}`}
            </button>
          )}
          <button
            id="btn-logout"
            type="button"
            className="nav-pill"
            onClick={handleLogout}
            title={`Sesión: ${session.display_name}`}
          >
            Salir ({session.username})
          </button>
        </nav>
      </header>

      <main className="page-content">
        {error && <div className="alert-box">⚠️ {error}</div>}
        {!project && !error && <div className="card">Cargando proyecto...</div>}

        {project && (
          <AttendanceView
            project={project}
            projects={projects}
            onSelectProject={setSelectedProjectId}
            onQueueChanged={() => void refreshQueueCount()}
          />
        )}
      </main>
    </div>
  );
}
