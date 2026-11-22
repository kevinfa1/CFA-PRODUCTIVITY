import { useEffect, useState } from "react";
import { api } from "./api";
import { offlineDb } from "./db";
import type { Project } from "./types";
import { AttendanceView } from "./views/AttendanceView";
import { DashboardView } from "./views/DashboardView";
import { FieldWalkView } from "./views/FieldWalkView";
import { OfficeSetupView } from "./views/OfficeSetupView";

type TabId = "dashboard" | "field" | "attendance" | "office";

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const bootstrap = async () => {
      try {
        const projects = await api.listProjects();
        if (projects.length > 0) {
          setProject(projects[0]);
        } else {
          const pilot = await api.seedPilot();
          setProject(pilot);
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
  }, []);

  return (
    <div className={`app-shell ${activeTab === "attendance" ? "app-shell--sunlight" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          <span>CFA Productivity</span>
          {project && <span className="kpi-sub">· {project.name}</span>}
        </div>

        <nav className="nav-pills">
          <button
            type="button"
            className={`nav-pill ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            📊 Tablero y Aprobación
          </button>
          <button
            type="button"
            className={`nav-pill ${activeTab === "field" ? "active" : ""}`}
            onClick={() => setActiveTab("field")}
          >
            📱 Recorrido Guiado
          </button>
          <button
            type="button"
            className={`nav-pill ${activeTab === "attendance" ? "active" : ""}`}
            onClick={() => setActiveTab("attendance")}
          >
            👷 Asistencia
          </button>
          <button
            type="button"
            className={`nav-pill ${activeTab === "office" ? "active" : ""}`}
            onClick={() => setActiveTab("office")}
          >
            🗓️ Oficina / Ruta
          </button>
          {pendingOfflineCount > 0 && (
            <button type="button" className="btn sm warn" disabled={syncing} onClick={() => void runSync()}>
              {syncing ? "Sincronizando..." : `☁️ Pendientes: ${pendingOfflineCount}`}
            </button>
          )}
        </nav>
      </header>

      <main className="page-content">
        {error && <div className="alert-box">⚠️ {error}</div>}
        {!project && !error && <div className="card">Inicializando proyecto piloto CFA...</div>}

        {project && activeTab === "dashboard" && <DashboardView projectId={project.id} />}
        {project && activeTab === "field" && (
          <FieldWalkView projectId={project.id} onQueueChanged={() => void refreshQueueCount()} />
        )}
        {project && activeTab === "attendance" && (
          <AttendanceView project={project} onQueueChanged={() => void refreshQueueCount()} />
        )}
        {project && activeTab === "office" && (
          <OfficeSetupView project={project} onProjectUpdated={setProject} />
        )}
      </main>
    </div>
  );
}
