import { useEffect, useState } from "react";
import { api } from "../api";
import { offlineDb } from "../db";
import type { AttendanceEntryPayload, AttendanceLog, Crew, Project } from "../types";

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<AttendanceEntryPayload[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [insideGeo, setInsideGeo] = useState<boolean | null>(null);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [groupPhotoBlob, setGroupPhotoBlob] = useState<Blob | undefined>(undefined);
  const [groupPhotoUrl, setGroupPhotoUrl] = useState<string | null>(null);
  const [newWorkerName, setNewWorkerName] = useState("");
  const [toast, setToast] = useState("");

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  const loadCrewsAndLogs = async () => {
    const [crewList, attLogs] = await Promise.all([api.getCrews(project.id), api.listAttendance(project.id)]);
    setCrews(crewList);
    setLogs(attLogs);
    if (crewList.length > 0 && selectedCrewId === null) {
      setSelectedCrewId(crewList[0].id);
      setEntries(
        crewList[0].workers.map((w) => ({
          worker_id: w.id,
          worker_name: w.name,
          role: w.role,
          status: "presente",
          normal_hours: 8,
          extra_hours: 0,
          reason: "",
        }))
      );
    }
  };

  useEffect(() => {
    void loadCrewsAndLogs();
  }, [project.id]);

  const handleCrewChange = (crewId: number) => {
    setSelectedCrewId(crewId);
    const crew = crews.find((c) => c.id === crewId);
    if (!crew) return;
    setEntries(
      crew.workers.map((w) => ({
        worker_id: w.id,
        worker_name: w.name,
        role: w.role,
        status: "presente",
        normal_hours: 8,
        extra_hours: 0,
        reason: "",
      }))
    );
  };

  const handleSameAsYesterday = () => {
    const lastForCrew = logs.find((l) => l.crew_id === selectedCrewId);
    if (lastForCrew && lastForCrew.entries.length > 0) {
      setEntries(lastForCrew.entries.map((e) => ({ ...e })));
      notify(`Copiado de ${lastForCrew.work_date}`);
    } else {
      setEntries((prev) => prev.map((e) => ({ ...e, status: "presente", normal_hours: 8, extra_hours: 0, reason: "" })));
      notify("Todos marcados presentes (8h)");
    }
  };

  const validateGps = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (project.geofence_lat != null && project.geofence_lng != null) {
          const dist = haversineMeters(
            pos.coords.latitude,
            pos.coords.longitude,
            project.geofence_lat,
            project.geofence_lng
          );
          setDistanceM(Math.round(dist));
          setInsideGeo(dist <= project.geofence_radius_m);
        } else {
          setDistanceM(0);
          setInsideGeo(true);
        }
      },
      () => notify("No se pudo leer el GPS")
    );
  };

  const handleSave = async () => {
    if (selectedCrewId === null) return;
    const payload = {
      crew_id: selectedCrewId,
      work_date: workDate,
      inside_geofence: insideGeo,
      distance_m: distanceM,
      entries,
    };

    try {
      await api.saveAttendance(project.id, payload, groupPhotoBlob);
      notify("✅ Asistencia guardada y sincronizada con Productividad (m²/HH)");
      setGroupPhotoBlob(undefined);
      await loadCrewsAndLogs();
    } catch {
      await offlineDb.pendingAttendance.add({
        projectId: project.id,
        crewId: selectedCrewId,
        workDate,
        insideGeofence: insideGeo,
        distanceM,
        entries,
        groupPhotoBlob,
        createdAt: new Date().toISOString(),
      });
      onQueueChanged();
      notify("📦 Asistencia guardada offline (se sincronizará al volver señal)");
    }
  };

  const handleAddWorker = async () => {
    if (!newWorkerName.trim() || selectedCrewId === null) return;
    await api.addWorker(selectedCrewId, newWorkerName.trim(), "Ayudante");
    setEntries((prev) => [
      ...prev,
      {
        worker_name: newWorkerName.trim(),
        role: "Ayudante",
        status: "presente",
        normal_hours: 8,
        extra_hours: 0,
        reason: "",
      },
    ]);
    setNewWorkerName("");
    await loadCrewsAndLogs();
  };

  const totalHH = entries.reduce(
    (sum, e) => sum + (e.status === "ausente" ? 0 : e.normal_hours + e.extra_hours),
    0
  );

  return (
    <section className="card" style={{ maxWidth: 680, margin: "0 auto", width: "100%" }}>
      {toast && <div className="alert-box">{toast}</div>}

      <div className="card-header">
        <div>
          <div className="card-title">Control de Asistencia en 1 Toque (Alimenta HH de Productividad)</div>
          <div className="kpi-sub">Total jornada: {totalHH.toFixed(1)} HH</div>
        </div>
        <div className="row">
          <button type="button" className="btn sm accent" onClick={handleSameAsYesterday}>
            Igual que ayer
          </button>
          <a className="btn sm ghost" href={`/api/projects/${project.id}/attendance/export.csv`} download>
            📥 CSV Planilla
          </a>
        </div>
      </div>

      <div className="row">
        <input className="input" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
        <select
          value={selectedCrewId ?? ""}
          onChange={(e) => handleCrewChange(Number(e.target.value))}
          style={{ flex: 1 }}
        >
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn sm" onClick={validateGps}>
          📍 Validar GPS (100 m)
        </button>
        {insideGeo !== null && (
          <span className={`badge ${insideGeo ? "green" : "red"}`}>
            {insideGeo ? `En obra (${distanceM} m)` : `Fuera (${distanceM} m)`}
          </span>
        )}
      </div>

      {/* Lista de trabajadores */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((e, idx) => (
          <div
            key={`${e.worker_name}_${idx}`}
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: 10,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div className="row between">
              <div>
                <strong>{e.worker_name}</strong> <span className="kpi-sub">· {e.role}</span>
              </div>
              <strong style={{ color: "var(--accent)" }}>
                {e.status === "ausente" ? "0.0" : (e.normal_hours + e.extra_hours).toFixed(1)} HH
              </strong>
            </div>
            <div className="row">
              {(["presente", "parcial", "ausente"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`btn sm ${e.status === st ? (st === "presente" ? "primary" : st === "parcial" ? "warn" : "danger") : "ghost"}`}
                  onClick={() => {
                    const copy = [...entries];
                    copy[idx] = {
                      ...e,
                      status: st,
                      normal_hours: st === "presente" ? 8 : st === "parcial" ? 4 : 0,
                      extra_hours: st === "presente" ? e.extra_hours : 0,
                      reason: st === "ausente" ? e.reason || "Falta" : "",
                    };
                    setEntries(copy);
                  }}
                >
                  {st === "presente" ? "✅ Presente" : st === "parcial" ? "⏰ Parcial" : "❌ Ausente"}
                </button>
              ))}
              {e.status === "presente" && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => {
                    const copy = [...entries];
                    copy[idx] = { ...e, extra_hours: (e.extra_hours + 1) % 4 };
                    setEntries(copy);
                  }}
                >
                  Extra: +{e.extra_hours}h
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Agregar trabajador rápido */}
      <div className="row">
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Agregar trabajador a esta cuadrilla..."
          value={newWorkerName}
          onChange={(e) => setNewWorkerName(e.target.value)}
        />
        <button type="button" className="btn sm accent" onClick={() => void handleAddWorker()}>
          + Agregar
        </button>
      </div>

      {/* Foto grupal anti-fraude */}
      <div className="row between">
        <label className="btn sm accent" style={{ cursor: "pointer" }}>
          📸 Foto grupal de cuadrilla
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setGroupPhotoBlob(f);
              setGroupPhotoUrl(URL.createObjectURL(f));
            }}
          />
        </label>
        <button type="button" className="btn primary" onClick={() => void handleSave()}>
          💾 Guardar asistencia ({totalHH.toFixed(1)} HH)
        </button>
      </div>

      {groupPhotoUrl && (
        <img
          src={groupPhotoUrl}
          alt="Foto grupal"
          style={{ width: "100%", maxHeight: 200, objectFit: "cover", borderRadius: 10 }}
        />
      )}
    </section>
  );
}
