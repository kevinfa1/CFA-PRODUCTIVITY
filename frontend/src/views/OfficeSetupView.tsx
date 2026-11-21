import { useEffect, useState } from "react";
import { api } from "../api";
import type { Crew, Project, ScheduleItem } from "../types";

export function OfficeSetupView({
  project,
  onProjectUpdated,
}: {
  project: Project;
  onProjectUpdated: (p: Project) => void;
}) {
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [northOffset, setNorthOffset] = useState(String(project.north_offset_deg));
  const [geoLat, setGeoLat] = useState(project.geofence_lat ? String(project.geofence_lat) : "");
  const [geoLng, setGeoLng] = useState(project.geofence_lng ? String(project.geofence_lng) : "");
  const [statusMsg, setStatusMsg] = useState("");

  const load = async () => {
    const [sched, crewList] = await Promise.all([api.getSchedule(project.id), api.getCrews(project.id)]);
    setSchedule(sched);
    setCrews(crewList);
  };

  useEffect(() => {
    void load();
  }, [project.id]);

  const moveItem = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= schedule.length) return;
    const copy = [...schedule];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    setSchedule(copy.map((item, idx) => ({ ...item, walk_order: idx + 1 })));
  };

  const handleSaveSchedule = async () => {
    const updated = await api.saveSchedule(
      project.id,
      schedule.map((item, idx) => ({
        element_id: item.element_id,
        crew_id: item.crew_id,
        walk_order: idx + 1,
        active: item.active,
        turn_hint: item.turn_hint,
      }))
    );
    setSchedule(updated);
    setStatusMsg("Programación semanal guardada y lista para el Modo Recorrido Guiado.");
  };

  const handleSaveProjectMeta = async () => {
    const updated = await api.updateProject(project.id, {
      north_offset_deg: Number(northOffset) || 0,
      geofence_lat: geoLat ? Number(geoLat) : null,
      geofence_lng: geoLng ? Number(geoLng) : null,
    });
    onProjectUpdated(updated);
    setStatusMsg("Configuración de Norte y Geofence guardada.");
  };

  const handleDxfUpload = async (file: File) => {
    setStatusMsg("Importando plano DXF...");
    try {
      const res = await api.importDxf(project.id, file);
      onProjectUpdated({ ...project, floorplan_svg: res.floorplan_svg });
      setStatusMsg(`DXF importado: ${res.imported_walls} muros convertidos a SVG.`);
      await load();
    } catch (err) {
      setStatusMsg(`Error DXF: ${(err as Error).message}`);
    }
  };

  return (
    <>
      {statusMsg && <div className="alert-box">✅ {statusMsg}</div>}

      {/* Carga única del proyecto */}
      <section className="card">
        <div className="card-header">
          <span className="card-title">Carga Única del Proyecto (Plano DXF, Norte y Geofence 100 m)</span>
          <label className="btn sm accent" style={{ cursor: "pointer" }}>
            📐 Importar plano .DXF
            <input
              type="file"
              accept=".dxf"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleDxfUpload(f);
              }}
            />
          </label>
        </div>
        <div className="row">
          <label className="kpi-sub">
            Desvío Norte (°):{" "}
            <input
              className="input"
              type="number"
              style={{ width: 90 }}
              value={northOffset}
              onChange={(e) => setNorthOffset(e.target.value)}
            />
          </label>
          <label className="kpi-sub">
            Latitud obra:{" "}
            <input
              className="input"
              type="number"
              step="0.0001"
              style={{ width: 120 }}
              value={geoLat}
              onChange={(e) => setGeoLat(e.target.value)}
            />
          </label>
          <label className="kpi-sub">
            Longitud obra:{" "}
            <input
              className="input"
              type="number"
              step="0.0001"
              style={{ width: 120 }}
              value={geoLng}
              onChange={(e) => setGeoLng(e.target.value)}
            />
          </label>
          <button type="button" className="btn primary sm" onClick={() => void handleSaveProjectMeta()}>
            Guardar configuración
          </button>
        </div>
      </section>

      {/* Programación semanal (5 minutos) */}
      <section className="card">
        <div className="card-header">
          <div>
            <div className="card-title">Programación Semanal (5 min) — Secuencia Física de Caminata</div>
            <div className="kpi-sub">
              Selecciona solo los frentes con cuadrilla asignada y ordena el recorrido físico del encargado.
            </div>
          </div>
          <button type="button" className="btn primary" onClick={() => void handleSaveSchedule()}>
            💾 Guardar Ruta Semanal
          </button>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Orden</th>
                <th>Activo</th>
                <th>Frente / Muro</th>
                <th>Cuadrilla asignada</th>
                <th>Indicación de caminata</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((item, idx) => (
                <tr key={item.id} style={{ opacity: item.active ? 1 : 0.45 }}>
                  <td>
                    <div className="row">
                      <strong>{idx + 1}</strong>
                      <button type="button" className="btn sm ghost" onClick={() => moveItem(idx, -1)}>
                        ↑
                      </button>
                      <button type="button" className="btn sm ghost" onClick={() => moveItem(idx, 1)}>
                        ↓
                      </button>
                    </div>
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={item.active}
                      onChange={(e) => {
                        const copy = [...schedule];
                        copy[idx] = { ...item, active: e.target.checked };
                        setSchedule(copy);
                      }}
                    />
                  </td>
                  <td>
                    <strong>{item.element.code}</strong> · {item.element.room_name} — {item.element.wall_name}
                    <div className="kpi-sub">
                      {item.element.trade} · {item.element.net_area_m2} m² netos
                    </div>
                  </td>
                  <td>
                    <select
                      value={item.crew_id ?? ""}
                      onChange={(e) => {
                        const copy = [...schedule];
                        copy[idx] = { ...item, crew_id: e.target.value ? Number(e.target.value) : null };
                        setSchedule(copy);
                      }}
                    >
                      <option value="">Sin cuadrilla</option>
                      {crews.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ width: "100%" }}
                      value={item.turn_hint}
                      onChange={(e) => {
                        const copy = [...schedule];
                        copy[idx] = { ...item, turn_hint: e.target.value };
                        setSchedule(copy);
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
