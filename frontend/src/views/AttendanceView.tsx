import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { offlineDb } from "../db";
import { WORKER_ROLES, type AttendanceEntryPayload, type AttendanceLog, type Crew, type Project, type WorkerRole } from "../types";
import {
  ABSENCE_REASONS,
  PARTIAL_HOURS_OPTIONS,
  formatSpanishDate,
  haversineMeters,
  normalizeWorkerRole,
  stampCrewPhoto,
  summarizeAttendance,
  triggerHaptic,
} from "../utils/attendanceUtils";
import "./AttendanceView.css";

type WizardStep = 1 | 2 | 3;

function IconCheck() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </svg>
  );
}

function IconX() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function IconCamera() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}

function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.05" y2="7.05" />
      <line x1="16.95" y1="16.95" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.05" y2="16.95" />
      <line x1="16.95" y1="7.05" x2="19.07" y2="4.93" />
    </svg>
  );
}

function IconPin() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function buildDefaultEntries(crew: Crew, existingLog?: AttendanceLog): AttendanceEntryPayload[] {
  if (existingLog && existingLog.entries.length > 0) {
    return existingLog.entries.map((e) => ({
      worker_id: e.worker_id,
      worker_name: e.worker_name,
      role: normalizeWorkerRole(e.role),
      status: e.status,
      normal_hours: e.normal_hours,
      extra_hours: e.extra_hours,
      reason: e.reason || "",
    }));
  }
  return crew.workers.map((w) => ({
    worker_id: w.id,
    worker_name: w.name,
    role: normalizeWorkerRole(w.role),
    status: "presente",
    normal_hours: 8,
    extra_hours: 0,
    reason: "",
  }));
}

export function AttendanceView({
  project,
  onQueueChanged,
}: {
  project: Project;
  onQueueChanged: () => void;
}) {
  const [crews, setCrews] = useState<Crew[]>([]);
  const [selectedCrewId, setSelectedCrewId] = useState<number | null>(null);
  const [workDate, setWorkDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<AttendanceEntryPayload[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);

  const [step, setStep] = useState<WizardStep>(1);
  const [sunBoost, setSunBoost] = useState(true);
  const [insideGeo, setInsideGeo] = useState<boolean | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);

  const [groupPhotoBlob, setGroupPhotoBlob] = useState<Blob | undefined>(undefined);
  const [groupPhotoUrl, setGroupPhotoUrl] = useState<string | null>(null);
  const [stampingPhoto, setStampingPhoto] = useState(false);

  const [showAddWorker, setShowAddWorker] = useState(false);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newWorkerRole, setNewWorkerRole] = useState<WorkerRole>("Albañil");
  const [addingWorker, setAddingWorker] = useState(false);

  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState<{ offline: boolean; crewName: string; totalHH: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimerRef = useRef<number | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 3200);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (groupPhotoUrl && groupPhotoUrl.startsWith("blob:")) {
        URL.revokeObjectURL(groupPhotoUrl);
      }
    };
  }, [groupPhotoUrl]);

  const selectedCrew = useMemo(
    () => crews.find((c) => c.id === selectedCrewId) ?? null,
    [crews, selectedCrewId]
  );

  const summary = useMemo(() => summarizeAttendance(entries), [entries]);

  const todayLogsByCrew = useMemo(() => {
    const map = new Map<number, AttendanceLog>();
    for (const l of logs) {
      if (l.work_date === workDate && !map.has(l.crew_id)) {
        map.set(l.crew_id, l);
      }
    }
    return map;
  }, [logs, workDate]);

  const validateGps = (silent = false) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (!silent) notify("GPS no disponible en este navegador");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        if (project.geofence_lat != null && project.geofence_lng != null) {
          const dist = haversineMeters(
            pos.coords.latitude,
            pos.coords.longitude,
            project.geofence_lat,
            project.geofence_lng
          );
          const rounded = Math.round(dist);
          setDistanceM(rounded);
          setInsideGeo(dist <= project.geofence_radius_m);
        } else {
          setDistanceM(0);
          setInsideGeo(true);
        }
      },
      () => {
        setGpsLoading(false);
        if (!silent) notify("No se pudo leer el GPS. Verifique ubicación del Samsung.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const loadCrewsAndLogs = async (keepSelection = false) => {
    const [crewList, attLogs] = await Promise.all([
      api.getCrews(project.id),
      api.listAttendance(project.id),
    ]);
    setCrews(crewList);
    setLogs(attLogs);

    if (crewList.length > 0 && (!keepSelection || selectedCrewId === null)) {
      const targetCrew = crewList.find((c) => c.id === selectedCrewId) ?? crewList[0];
      setSelectedCrewId(targetCrew.id);
      const todayExisting = attLogs.find((l) => l.crew_id === targetCrew.id && l.work_date === workDate);
      setEntries(buildDefaultEntries(targetCrew, todayExisting));
      if (todayExisting?.group_photo_path) {
        setGroupPhotoUrl(todayExisting.group_photo_path);
      }
    }
  };

  useEffect(() => {
    void loadCrewsAndLogs(false);
    validateGps(true);
  }, [project.id]);

  const selectCrew = (crewId: number) => {
    triggerHaptic(18);
    setSelectedCrewId(crewId);
    setSavedBanner(null);
    setStep(1);
    setGroupPhotoBlob(undefined);
    const crew = crews.find((c) => c.id === crewId);
    if (!crew) return;
    const todayExisting = logs.find((l) => l.crew_id === crewId && l.work_date === workDate);
    setEntries(buildDefaultEntries(crew, todayExisting));
    setGroupPhotoUrl(todayExisting?.group_photo_path ?? null);
  };

  const handleDateChange = (newDate: string) => {
    setWorkDate(newDate);
    setSavedBanner(null);
    if (!selectedCrew) return;
    const existing = logs.find((l) => l.crew_id === selectedCrew.id && l.work_date === newDate);
    setEntries(buildDefaultEntries(selectedCrew, existing));
    setGroupPhotoBlob(undefined);
    setGroupPhotoUrl(existing?.group_photo_path ?? null);
  };

  const handleSameAsYesterday = () => {
    triggerHaptic(22);
    const prevLog = logs.find((l) => l.crew_id === selectedCrewId && l.work_date !== workDate)
      ?? logs.find((l) => l.crew_id === selectedCrewId);
    if (prevLog && prevLog.entries.length > 0) {
      setEntries(
        prevLog.entries.map((e) => ({
          ...e,
          role: normalizeWorkerRole(e.role),
        }))
      );
      notify(`Lista copiada del ${prevLog.work_date}`);
    } else {
      handleMarkAllPresent();
    }
  };

  const handleMarkAllPresent = () => {
    triggerHaptic(20);
    setEntries((prev) =>
      prev.map((e) => ({
        ...e,
        status: "presente",
        normal_hours: 8,
        extra_hours: 0,
        reason: "",
      }))
    );
    notify("Todos marcados Presente (8.0 HH)");
  };

  const updateWorkerStatus = (idx: number, status: "presente" | "parcial" | "ausente") => {
    triggerHaptic(16);
    setEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== idx) return entry;
        return {
          ...entry,
          status,
          normal_hours: status === "presente" ? 8 : status === "parcial" ? 4 : 0,
          extra_hours: status === "presente" ? entry.extra_hours : 0,
          reason: status === "ausente" ? entry.reason || "Falta" : "",
        };
      })
    );
  };

  const cycleExtraHours = (idx: number) => {
    triggerHaptic(14);
    setEntries((prev) =>
      prev.map((entry, i) => (i === idx ? { ...entry, extra_hours: (entry.extra_hours + 1) % 4 } : entry))
    );
  };

  const setPartialHours = (idx: number, hours: number) => {
    triggerHaptic(14);
    setEntries((prev) =>
      prev.map((entry, i) => (i === idx ? { ...entry, normal_hours: hours } : entry))
    );
  };

  const setAbsenceReason = (idx: number, reason: string) => {
    triggerHaptic(14);
    setEntries((prev) =>
      prev.map((entry, i) => (i === idx ? { ...entry, reason } : entry))
    );
  };

  const handleAddWorker = async () => {
    const trimmed = newWorkerName.trim();
    if (!trimmed || selectedCrewId === null || addingWorker) return;
    setAddingWorker(true);
    triggerHaptic(20);
    try {
      const created = (await api.addWorker(selectedCrewId, trimmed, newWorkerRole)) as {
        id?: number;
        name: string;
        role: WorkerRole;
      };
      setEntries((prev) => [
        ...prev,
        {
          worker_id: created.id ?? null,
          worker_name: trimmed,
          role: newWorkerRole,
          status: "presente",
          normal_hours: 8,
          extra_hours: 0,
          reason: "",
        },
      ]);
      setNewWorkerName("");
      setShowAddWorker(false);
      notify(`Agregado: ${trimmed} (${newWorkerRole})`);
      await loadCrewsAndLogs(true);
    } catch {
      // Fallback local si está sin señal en obra
      setEntries((prev) => [
        ...prev,
        {
          worker_id: null,
          worker_name: trimmed,
          role: newWorkerRole,
          status: "presente",
          normal_hours: 8,
          extra_hours: 0,
          reason: "",
        },
      ]);
      setNewWorkerName("");
      setShowAddWorker(false);
      notify(`Agregado en lista local: ${trimmed} (${newWorkerRole})`);
    } finally {
      setAddingWorker(false);
    }
  };

  const gpsLabel =
    insideGeo === true
      ? `En obra (${distanceM ?? 0} m)`
      : insideGeo === false
        ? `Fuera de obra (${distanceM ?? 0} m)`
        : "GPS pendiente";

  const handlePhotoSelected = async (file: File | undefined) => {
    if (!file) return;
    setStampingPhoto(true);
    triggerHaptic(25);
    try {
      const stamped = await stampCrewPhoto(file, {
        projectName: project.name,
        crewName: selectedCrew?.name ?? "Cuadrilla",
        workDate,
        presentCount: summary.presentCount,
        totalWorkers: summary.totalWorkers,
        albanilesPresent: summary.albanilesPresent,
        ayudantesPresent: summary.ayudantesPresent,
        gpsLabel,
      });
      setGroupPhotoBlob(stamped);
      setGroupPhotoUrl(URL.createObjectURL(stamped));
      notify("Foto sellada con fecha, cuadrilla y conteo");
    } finally {
      setStampingPhoto(false);
    }
  };

  const handleSave = async () => {
    if (selectedCrewId === null || saving) return;
    setSaving(true);
    triggerHaptic(35);

    const payload = {
      crew_id: selectedCrewId,
      work_date: workDate,
      inside_geofence: insideGeo,
      distance_m: distanceM,
      entries: entries.map((e) => ({
        ...e,
        role: normalizeWorkerRole(e.role),
      })),
    };

    try {
      await api.saveAttendance(project.id, payload, groupPhotoBlob);
      setSavedBanner({
        offline: false,
        crewName: selectedCrew?.name ?? "Cuadrilla",
        totalHH: summary.totalHH,
      });
      setGroupPhotoBlob(undefined);
      await loadCrewsAndLogs(true);
    } catch {
      await offlineDb.pendingAttendance.add({
        projectId: project.id,
        crewId: selectedCrewId,
        workDate,
        insideGeofence: insideGeo,
        distanceM,
        entries: payload.entries,
        groupPhotoBlob,
        createdAt: new Date().toISOString(),
      });
      onQueueChanged();
      setSavedBanner({
        offline: true,
        crewName: selectedCrew?.name ?? "Cuadrilla",
        totalHH: summary.totalHH,
      });
    } finally {
      setSaving(false);
    }
  };

  const nextPendingCrew = crews.find((c) => c.id !== selectedCrewId && !todayLogsByCrew.has(c.id)) ?? null;

  return (
    <section
      id="attendance-module"
      className={`att-shell ${sunBoost ? "sun-boost" : ""}`}
      aria-label="Control de Asistencia en Obra"
    >
      {/* Encabezado Corporativo de Alto Contraste */}
      <div className="att-hero">
        <div className="att-hero-top">
          <div>
            <div className="att-hero-eyebrow">CFA · CONTROL DE ASISTENCIA</div>
            <h1 className="att-hero-title">Pase de Lista en Obra</h1>
          </div>
          <button
            id="btn-sun-boost"
            type="button"
            className={`att-sun-toggle ${sunBoost ? "active" : ""}`}
            aria-pressed={sunBoost}
            onClick={() => {
              triggerHaptic(15);
              setSunBoost((v) => !v);
            }}
          >
            <IconSun />
            {sunBoost ? "Sol Alto: ON" : "Sol Alto: OFF"}
          </button>
        </div>

        <div className="att-hero-meta">
          <label className="att-date-chip" htmlFor="att-work-date">
            <span>{formatSpanishDate(workDate)}</span>
            <input
              id="att-work-date"
              className="att-date-input"
              type="date"
              aria-label="Fecha de asistencia"
              value={workDate}
              onChange={(e) => handleDateChange(e.target.value)}
            />
          </label>

          <button
            id="btn-gps-validate"
            type="button"
            className={`att-gps-pill ${insideGeo === true ? "ok" : insideGeo === false ? "warn" : ""}`}
            onClick={() => validateGps(false)}
          >
            <IconPin />
            {gpsLoading ? "Ubicando GPS..." : gpsLabel}
          </button>
        </div>
      </div>

      {toast && (
        <div className="att-toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {/* Indicador Guiado de 3 Pasos */}
      {!savedBanner && (
        <nav className="att-stepper" aria-label="Pasos de asistencia">
          <button
            id="step-btn-1"
            type="button"
            className={`att-step-btn ${step === 1 ? "active" : step > 1 ? "done" : ""}`}
            onClick={() => setStep(1)}
          >
            <span className="att-step-num">{step > 1 ? "✓" : "1"}</span>
            <span>Lista</span>
          </button>
          <button
            id="step-btn-2"
            type="button"
            className={`att-step-btn ${step === 2 ? "active" : step > 2 ? "done" : ""}`}
            onClick={() => setStep(2)}
          >
            <span className="att-step-num">{step > 2 ? "✓" : "2"}</span>
            <span>Foto Grupal</span>
          </button>
          <button
            id="step-btn-3"
            type="button"
            className={`att-step-btn ${step === 3 ? "active" : ""}`}
            onClick={() => setStep(3)}
          >
            <span className="att-step-num">3</span>
            <span>Confirmar</span>
          </button>
        </nav>
      )}

      {/* PANTALLA DE CONFIRMACIÓN EXITOSA */}
      {savedBanner && (
        <div className="att-success-card" role="status">
          <div className="att-success-title">
            {savedBanner.offline
              ? "Asistencia guardada en el teléfono (Sin señal)"
              : "Asistencia registrada correctamente"}
          </div>
          <p style={{ fontSize: 15, fontWeight: 600 }}>
            {savedBanner.crewName} · {summary.presentCount}/{summary.totalWorkers} presentes (
            {summary.albanilesPresent} Albañiles · {summary.ayudantesPresent} Ayudantes) ·{" "}
            <strong>{savedBanner.totalHH.toFixed(1)} HH</strong>
          </p>
          {savedBanner.offline && (
            <p style={{ fontSize: 14, fontWeight: 600 }}>
              Se enviará automáticamente a oficina en cuanto el Samsung recupere datos o Wi-Fi.
            </p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {nextPendingCrew && (
              <button
                id="btn-next-crew"
                type="button"
                className="att-btn-primary"
                onClick={() => selectCrew(nextPendingCrew.id)}
              >
                Pasar asistencia a: {nextPendingCrew.name} →
              </button>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className="att-btn-secondary"
                style={{ flex: 1 }}
                onClick={() => {
                  setSavedBanner(null);
                  setStep(1);
                }}
              >
                Editar lista
              </button>
              <a
                className="att-btn-secondary"
                style={{ flex: 1 }}
                href={`/api/projects/${project.id}/attendance/export.csv`}
                download
              >
                Descargar CSV
              </a>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================
          PASO 1: SELECCIONAR CUADRILLA Y MARCAR EXCEPCIONES (1 TOQUE)
         ================================================================= */}
      {!savedBanner && step === 1 && (
        <>
          <div className="att-card">
            <div className="att-section-head">
              <div>
                <div className="att-section-title">1. Seleccione la cuadrilla</div>
                <div className="att-section-sub">Toque la cuadrilla para pasar lista</div>
              </div>
              <a
                className="att-action-chip"
                href={`/api/projects/${project.id}/attendance/export.csv`}
                download
              >
                CSV Planilla
              </a>
            </div>

            <div className="att-crew-grid">
              {crews.map((crew) => {
                const isSelected = crew.id === selectedCrewId;
                const isDoneToday = todayLogsByCrew.has(crew.id);
                return (
                  <button
                    key={crew.id}
                    type="button"
                    className={`att-crew-chip ${isSelected ? "selected" : ""}`}
                    aria-pressed={isSelected}
                    onClick={() => selectCrew(crew.id)}
                  >
                    <span className="att-crew-name">{crew.name}</span>
                    <span className="att-crew-meta">
                      <span>{crew.workers.length} pers.</span>
                      <span className={`att-status-tag ${isDoneToday ? "done" : "pending"}`}>
                        {isDoneToday ? "✓ Listo" : "Pendiente"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="att-card">
            <div className="att-section-head">
              <div>
                <div className="att-section-title">2. Marque solo faltas o medios días</div>
                <div className="att-section-sub">
                  Todos inician como Presente (8h) para ahorrar tiempo
                </div>
              </div>
            </div>

            {/* Resumen en vivo de Albañiles, Ayudantes y HH */}
            <div className="att-kpi-strip" aria-label="Resumen de cuadrilla">
              <div className="att-kpi-box">
                <div className="att-kpi-num">
                  {summary.albanilesPresent}/{summary.albanilesTotal}
                </div>
                <div className="att-kpi-label">Albañiles</div>
              </div>
              <div className="att-kpi-box">
                <div className="att-kpi-num">
                  {summary.ayudantesPresent}/{summary.ayudantesTotal}
                </div>
                <div className="att-kpi-label">Ayudantes</div>
              </div>
              <div className="att-kpi-box">
                <div className="att-kpi-num">{summary.totalHH.toFixed(1)}</div>
                <div className="att-kpi-label">Total HH</div>
              </div>
            </div>

            <div className="att-quick-actions">
              <button
                id="btn-same-as-yesterday"
                type="button"
                className="att-action-chip"
                onClick={handleSameAsYesterday}
              >
                Repetir ayer
              </button>
              <button
                id="btn-all-present"
                type="button"
                className="att-action-chip"
                onClick={handleMarkAllPresent}
              >
                Todos presentes
              </button>
              <button
                id="btn-toggle-add-worker"
                type="button"
                className="att-action-chip"
                onClick={() => setShowAddWorker((v) => !v)}
              >
                {showAddWorker ? "Cerrar" : "+ Nuevo trabajador"}
              </button>
            </div>

            {/* Formulario compacto para agregar Albañil o Ayudante */}
            {showAddWorker && (
              <div className="att-add-box" aria-label="Agregar nuevo trabajador">
                <div className="att-section-title">Agregar trabajador a {selectedCrew?.name}</div>
                <input
                  id="input-new-worker-name"
                  className="att-text-input"
                  type="text"
                  placeholder="Nombre y apellido..."
                  value={newWorkerName}
                  onChange={(e) => setNewWorkerName(e.target.value)}
                />
                <div className="att-role-selector" role="radiogroup" aria-label="Cargo del trabajador">
                  {WORKER_ROLES.map((role) => (
                    <button
                      key={role}
                      type="button"
                      role="radio"
                      aria-checked={newWorkerRole === role}
                      className={`att-role-btn ${newWorkerRole === role ? "selected" : ""}`}
                      onClick={() => setNewWorkerRole(role)}
                    >
                      {role}
                    </button>
                  ))}
                </div>
                <button
                  id="btn-confirm-add-worker"
                  type="button"
                  className="att-btn-primary"
                  disabled={!newWorkerName.trim() || addingWorker}
                  onClick={() => void handleAddWorker()}
                >
                  {addingWorker ? "Agregando..." : `Agregar ${newWorkerRole}`}
                </button>
              </div>
            )}

            {/* Lista de trabajadores con botones grandes */}
            <div className="att-worker-list">
              {entries.map((entry, idx) => {
                const role = normalizeWorkerRole(entry.role);
                const workerHH =
                  entry.status === "ausente" ? 0 : entry.normal_hours + entry.extra_hours;

                return (
                  <article
                    key={`${entry.worker_name}_${idx}`}
                    className={`att-worker-card is-${entry.status}`}
                  >
                    <div className="att-worker-head">
                      <div>
                        <div className="att-worker-name">{entry.worker_name}</div>
                        <span className={`att-role-pill ${role === "Albañil" ? "albanil" : "ayudante"}`}>
                          {role}
                        </span>
                      </div>
                      <span className="att-hh-tag">{workerHH.toFixed(1)} HH</span>
                    </div>

                    <div className="att-status-grid">
                      <button
                        type="button"
                        aria-pressed={entry.status === "presente"}
                        className={`att-status-btn ${entry.status === "presente" ? "active-presente" : ""}`}
                        onClick={() => updateWorkerStatus(idx, "presente")}
                      >
                        <IconCheck /> Presente
                      </button>
                      <button
                        type="button"
                        aria-pressed={entry.status === "parcial"}
                        className={`att-status-btn ${entry.status === "parcial" ? "active-parcial" : ""}`}
                        onClick={() => updateWorkerStatus(idx, "parcial")}
                      >
                        <IconClock /> Parcial
                      </button>
                      <button
                        type="button"
                        aria-pressed={entry.status === "ausente"}
                        className={`att-status-btn ${entry.status === "ausente" ? "active-ausente" : ""}`}
                        onClick={() => updateWorkerStatus(idx, "ausente")}
                      >
                        <IconX /> Ausente
                      </button>
                    </div>

                    {entry.status === "presente" && (
                      <div className="att-subrow">
                        <span className="att-subrow-label">Horas extra:</span>
                        <button
                          type="button"
                          className={`att-choice-chip ${entry.extra_hours > 0 ? "selected" : ""}`}
                          onClick={() => cycleExtraHours(idx)}
                        >
                          {entry.extra_hours > 0 ? `+${entry.extra_hours}h extra` : "+ Agregar extra"}
                        </button>
                      </div>
                    )}

                    {entry.status === "parcial" && (
                      <div className="att-subrow">
                        <span className="att-subrow-label">Horas trabajadas:</span>
                        <div className="att-chip-group">
                          {PARTIAL_HOURS_OPTIONS.map((hrs) => (
                            <button
                              key={hrs}
                              type="button"
                              className={`att-choice-chip ${entry.normal_hours === hrs ? "selected" : ""}`}
                              onClick={() => setPartialHours(idx, hrs)}
                            >
                              {hrs}h {hrs === 4 ? "(½ día)" : ""}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {entry.status === "ausente" && (
                      <div className="att-subrow">
                        <span className="att-subrow-label">Motivo:</span>
                        <div className="att-chip-group">
                          {ABSENCE_REASONS.map((reason) => (
                            <button
                              key={reason}
                              type="button"
                              className={`att-choice-chip ${entry.reason === reason ? "selected" : ""}`}
                              onClick={() => setAbsenceReason(idx, reason)}
                            >
                              {reason}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>

          <div className="att-sticky-bar">
            <button
              id="btn-step1-next"
              type="button"
              className="att-btn-primary"
              disabled={entries.length === 0}
              onClick={() => {
                triggerHaptic(20);
                setStep(2);
              }}
            >
              Siguiente: Tomar Foto ({summary.presentCount} presentes) →
            </button>
          </div>
        </>
      )}

      {/* =================================================================
          PASO 2: FOTO GRUPAL GUIADA CON SELLO AUTOMÁTICO
         ================================================================= */}
      {!savedBanner && step === 2 && (
        <>
          <div className="att-card">
            <div className="att-section-title">Foto grupal de respaldo ({selectedCrew?.name})</div>

            <div className="att-photo-guide">
              <div className="att-guide-count">
                Reúna a los {summary.presentCount} trabajadores presentes:
                {" "}
                {summary.albanilesPresent} {summary.albanilesPresent === 1 ? "Albañil" : "Albañiles"} y{" "}
                {summary.ayudantesPresent} {summary.ayudantesPresent === 1 ? "Ayudante" : "Ayudantes"}
              </div>
              <ul className="att-guide-list">
                <li>1. Colóquese con el sol detrás de usted (evite contraluz).</li>
                <li>2. Verifique que todos salgan visibles en el encuadre.</li>
                <li>3. La app estampará fecha, hora, cuadrilla y GPS automáticamente.</li>
              </ul>
            </div>

            <label className="att-camera-cta" htmlFor="input-crew-photo">
              <IconCamera />
              <span>
                {stampingPhoto
                  ? "Procesando y sellando foto..."
                  : groupPhotoUrl
                    ? "REPETIR FOTO DE CUADRILLA"
                    : "TOMAR FOTO DE CUADRILLA"}
              </span>
              <input
                id="input-crew-photo"
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  void handlePhotoSelected(file);
                  e.target.value = "";
                }}
              />
            </label>

            {groupPhotoUrl ? (
              <div className="att-photo-preview-wrap">
                <div className="att-photo-badge">
                  <IconCheck /> Foto lista con sello corporativo CFA
                </div>
                <img
                  src={groupPhotoUrl}
                  alt="Vista previa de foto grupal de cuadrilla"
                  className="att-photo-preview"
                />
              </div>
            ) : (
              <button
                id="btn-skip-photo"
                type="button"
                className="att-skip-link"
                onClick={() => setStep(3)}
              >
                Continuar sin foto por ahora
              </button>
            )}
          </div>

          <div className="att-sticky-bar">
            <button
              id="btn-step2-back"
              type="button"
              className="att-btn-secondary"
              onClick={() => setStep(1)}
            >
              ← Lista
            </button>
            <button
              id="btn-step2-next"
              type="button"
              className="att-btn-primary"
              disabled={stampingPhoto}
              onClick={() => {
                triggerHaptic(20);
                setStep(3);
              }}
            >
              {groupPhotoUrl ? "Foto correcta: Confirmar →" : "Ir a Confirmar →"}
            </button>
          </div>
        </>
      )}

      {/* =================================================================
          PASO 3: RESUMEN CORPORATIVO Y GUARDAR EN 1 TOQUE
         ================================================================= */}
      {!savedBanner && step === 3 && (
        <>
          <div className="att-card">
            <div className="att-section-head">
              <div>
                <div className="att-section-title">Resumen antes de guardar</div>
                <div className="att-section-sub">
                  {selectedCrew?.name} · {formatSpanishDate(workDate)}
                </div>
              </div>
            </div>

            <div className="att-receipt-grid">
              <div className="att-receipt-item">
                <div className="att-receipt-label">Albañiles presentes</div>
                <div className="att-receipt-val">
                  {summary.albanilesPresent} / {summary.albanilesTotal}
                </div>
              </div>
              <div className="att-receipt-item">
                <div className="att-receipt-label">Ayudantes presentes</div>
                <div className="att-receipt-val">
                  {summary.ayudantesPresent} / {summary.ayudantesTotal}
                </div>
              </div>
              <div className="att-receipt-item">
                <div className="att-receipt-label">Total Horas Hombre</div>
                <div className="att-receipt-val">{summary.totalHH.toFixed(1)} HH</div>
              </div>
              <div className="att-receipt-item">
                <div className="att-receipt-label">Ubicación GPS</div>
                <div className="att-receipt-val" style={{ fontSize: 15 }}>
                  {gpsLabel}
                </div>
              </div>
            </div>

            {groupPhotoUrl ? (
              <img
                src={groupPhotoUrl}
                alt="Foto grupal sellada"
                className="att-photo-preview"
                style={{ maxHeight: 190 }}
              />
            ) : (
              <div className="att-warning-banner">
                Sin foto grupal adjunta. Puede regresar al Paso 2 para tomarla.
              </div>
            )}

            <table className="att-summary-table">
              <thead>
                <tr>
                  <th>Trabajador</th>
                  <th>Cargo</th>
                  <th>Estado</th>
                  <th style={{ textAlign: "right" }}>HH</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => {
                  const hh = e.status === "ausente" ? 0 : e.normal_hours + e.extra_hours;
                  return (
                    <tr key={`${e.worker_name}_${i}`}>
                      <td>
                        <strong>{e.worker_name}</strong>
                        {e.reason ? <div style={{ fontSize: 12, color: "#7f1d1d" }}>{e.reason}</div> : null}
                      </td>
                      <td>{normalizeWorkerRole(e.role)}</td>
                      <td style={{ textTransform: "capitalize", fontWeight: 700 }}>{e.status}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{hh.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="att-sticky-bar">
            <button
              id="btn-step3-back"
              type="button"
              className="att-btn-secondary"
              onClick={() => setStep(2)}
            >
              ← Foto
            </button>
            <button
              id="btn-save-attendance"
              type="button"
              className="att-btn-primary confirm"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              <IconCheck />
              {saving ? "Guardando..." : `Confirmar y Guardar (${summary.totalHH.toFixed(1)} HH)`}
            </button>
          </div>
        </>
      )}

      {/* Historial reciente de asistencias */}
      <div className="att-card">
        <div className="att-section-head">
          <div className="att-section-title">Historial de Asistencias ({logs.length})</div>
          <button
            id="btn-toggle-history"
            type="button"
            className="att-action-chip"
            onClick={() => setShowHistory((v) => !v)}
          >
            {showHistory ? "Ocultar" : "Ver historial"}
          </button>
        </div>

        {showHistory && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {logs.length === 0 ? (
              <div className="att-section-sub">Aún no hay asistencias registradas.</div>
            ) : (
              logs.slice(0, 8).map((log) => {
                const crewName = crews.find((c) => c.id === log.crew_id)?.name ?? `Cuadrilla #${log.crew_id}`;
                return (
                  <div key={log.id} className="att-history-item">
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 15 }}>{crewName}</div>
                      <div className="att-section-sub">
                        {log.work_date} · {log.present_count}/{log.total_workers} presentes ·{" "}
                        <strong>{log.total_hh.toFixed(1)} HH</strong>
                      </div>
                    </div>
                    {log.group_photo_path ? (
                      <span className="att-status-tag done">✓ Con foto</span>
                    ) : (
                      <span className="att-status-tag pending">Sin foto</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </section>
  );
}
