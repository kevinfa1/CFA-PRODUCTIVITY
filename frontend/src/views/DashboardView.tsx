import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DailyCapture, DashboardData } from "../types";

const STATUS_COLORS: Record<string, string> = {
  not_started: "#ef4444",
  in_progress: "#f59e0b",
  completed: "#22c55e",
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "Sin iniciar",
  in_progress: "En proceso",
  completed: "Terminado",
};

export function DashboardView({ projectId }: { projectId: number }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [pending, setPending] = useState<DailyCapture[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [adjustValues, setAdjustValues] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const svgHostRef = useRef<HTMLDivElement>(null);

  const loadAll = async () => {
    const [dash, approvals] = await Promise.all([
      api.getDashboard(projectId),
      api.listApprovals(projectId, "pending"),
    ]);
    setData(dash);
    setPending(approvals);
  };

  useEffect(() => {
    void loadAll();
  }, [projectId]);

  // Colorear el mapa de calor sobre el plano SVG y escuchar clics en cada muro
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host || !data) return;

    const cleanups: Array<() => void> = [];
    data.elements.forEach((el) => {
      if (!el.svg_element_id) return;
      const node = host.querySelector<SVGElement>(`#${CSS.escape(el.svg_element_id)}`);
      if (!node) return;
      node.style.stroke = STATUS_COLORS[el.status] || "#ef4444";
      const onClick = () => setSelectedCode(el.code);
      node.addEventListener("click", onClick);
      cleanups.push(() => node.removeEventListener("click", onClick));
    });

    return () => cleanups.forEach((fn) => fn());
  }, [data]);

  const handleDecision = async (cap: DailyCapture, decision: "approved" | "adjusted" | "rejected") => {
    setBusyId(cap.id);
    try {
      const override = adjustValues[cap.id];
      const finalArea =
        decision === "adjusted" && override !== undefined && override !== ""
          ? Number(override)
          : cap.calculated_area_m2;
      await api.approveCapture(cap.id, decision, finalArea);
      await loadAll();
    } finally {
      setBusyId(null);
    }
  };

  if (!data) {
    return <div className="card">Cargando tablero de control...</div>;
  }

  const selectedWall = data.elements.find((e) => e.code === selectedCode) || data.elements[0];
  const yieldRatio =
    data.kpis.apu_target_m2_per_hh > 0
      ? (data.kpis.real_yield_m2_per_hh / data.kpis.apu_target_m2_per_hh) * 100
      : 0;

  return (
    <>
      {/* Alertas tempranas */}
      {data.alerts.map((msg, i) => (
        <div key={i} className="alert-box">
          ⚠️ {msg}
        </div>
      ))}

      {/* KPIs principales */}
      <section className="kpi-grid">
        <div className="card">
          <div className="card-title">Avance Acumulado</div>
          <div className="kpi-value" style={{ color: "var(--green)" }}>
            {data.kpis.progress_pct}%
          </div>
          <div className="kpi-sub">
            {data.kpis.total_approved_m2} / {data.kpis.total_net_m2} m² netos
          </div>
        </div>
        <div className="card">
          <div className="card-title">Producción Hoy (Δm²)</div>
          <div className="kpi-value" style={{ color: "var(--accent)" }}>
            +{data.kpis.delta_today_m2} m²
          </div>
          <div className="kpi-sub">Fecha: {data.work_date}</div>
        </div>
        <div className="card">
          <div className="card-title">Rendimiento Real vs APU</div>
          <div
            className="kpi-value"
            style={{ color: yieldRatio >= 90 ? "var(--green)" : "var(--yellow)" }}
          >
            {data.kpis.real_yield_m2_per_hh.toFixed(2)}
          </div>
          <div className="kpi-sub">
            m²/HH (Meta APU: {data.kpis.apu_target_m2_per_hh} | {data.kpis.total_hh_today} HH hoy)
          </div>
        </div>
        <div className="card">
          <div className="card-title">Pendientes Aprobación</div>
          <div className="kpi-value" style={{ color: data.kpis.pending_approvals > 0 ? "var(--yellow)" : "var(--text)" }}>
            {data.kpis.pending_approvals}
          </div>
          <div className="row">
            <a className="btn sm accent" href={`/api/projects/${projectId}/payroll/export.csv`} download>
              📥 CSV Destajo
            </a>
          </div>
        </div>
      </section>

      <section className="grid-2">
        {/* Mapa de calor SVG interactivo */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Mapa de Calor del Plano SVG</span>
            <div className="row">
              <span className="badge red">● Sin iniciar</span>
              <span className="badge yellow">● En proceso</span>
              <span className="badge green">● Terminado</span>
            </div>
          </div>
          <div
            ref={svgHostRef}
            className="svg-container"
            dangerouslySetInnerHTML={{ __html: data.project.floorplan_svg }}
          />
          {selectedWall && (
            <div className="row between" style={{ background: "#0f172a", padding: 10, borderRadius: 10 }}>
              <div>
                <strong>
                  {selectedWall.code} · {selectedWall.room_name} — {selectedWall.wall_name}
                </strong>
                <div className="kpi-sub">
                  Partida: {selectedWall.trade} · Meta APU: {selectedWall.apu_target_m2_per_hh} m²/HH
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span
                  className={`badge ${
                    selectedWall.status === "completed"
                      ? "green"
                      : selectedWall.status === "in_progress"
                        ? "yellow"
                        : "red"
                  }`}
                >
                  {STATUS_LABELS[selectedWall.status]} ({selectedWall.progress_pct}%)
                </span>
                <div className="kpi-sub" style={{ marginTop: 4 }}>
                  {selectedWall.approved_area_m2} / {selectedWall.net_area_m2} m²
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Validación rápida de 5 segundos */}
        <div className="card">
          <div className="card-header">
            <span className="card-title">Validación Rápida (5 segundos)</span>
            <button type="button" className="btn sm ghost" onClick={() => void loadAll()}>
              ↻ Actualizar
            </button>
          </div>
          {pending.length === 0 ? (
            <div className="kpi-sub" style={{ padding: "24px 0" }}>
              No hay capturas pendientes de aprobación. Cuando campo suba fotos en el Modo Recorrido Guiado, aparecerán aquí con su máscara verde lista para aprobar en 1 toque.
            </div>
          ) : (
            pending.map((cap) => (
              <div
                key={cap.id}
                style={{
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: 12,
                  padding: 12,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div className="row between">
                  <strong>
                    {cap.element?.code} · {cap.element?.room_name} — {cap.element?.wall_name}
                  </strong>
                  <span className="badge blue">IA: {cap.calculated_area_m2.toFixed(2)} m²</span>
                </div>
                {(cap.overlay_path || cap.photo_path) && (
                  <img
                    src={cap.overlay_path || cap.photo_path || ""}
                    alt="Máscara de avance"
                    style={{ width: "100%", borderRadius: 10, maxHeight: 230, objectFit: "cover" }}
                  />
                )}
                <div className="kpi-sub">{cap.vision_notes}</div>
                <div className="row">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyId === cap.id}
                    onClick={() => void handleDecision(cap, "approved")}
                  >
                    ✅ Aprobar ({cap.calculated_area_m2.toFixed(2)} m²)
                  </button>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    style={{ width: 92 }}
                    placeholder="Ajustar m²"
                    value={adjustValues[cap.id] ?? ""}
                    onChange={(e) => setAdjustValues({ ...adjustValues, [cap.id]: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn warn sm"
                    disabled={busyId === cap.id}
                    onClick={() => void handleDecision(cap, "adjusted")}
                  >
                    Ajustar
                  </button>
                  <button
                    type="button"
                    className="btn danger sm"
                    disabled={busyId === cap.id}
                    onClick={() => void handleDecision(cap, "rejected")}
                  >
                    Rechazar
                  </button>
                </div>
              </div>
            ))
          )}

          {Object.keys(data.stop_causes).length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div className="card-title" style={{ marginBottom: 6 }}>
                Causas de Paro Hoy
              </div>
              <div className="row">
                {Object.entries(data.stop_causes).map(([cause, count]) => (
                  <span key={cause} className="badge red">
                    {cause}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Tabla resumen por muro */}
      <section className="card">
        <div className="card-title">Detalle de Frentes / Muros</div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Ambiente</th>
                <th>Muro</th>
                <th>Partida</th>
                <th>Área Neta</th>
                <th>Aprobado</th>
                <th>Avance</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.elements.map((el) => (
                <tr key={el.id} onClick={() => setSelectedCode(el.code)} style={{ cursor: "pointer" }}>
                  <td><strong>{el.code}</strong></td>
                  <td>{el.room_name}</td>
                  <td>{el.wall_name}</td>
                  <td>{el.trade}</td>
                  <td>{el.net_area_m2.toFixed(2)} m²</td>
                  <td>{el.approved_area_m2.toFixed(2)} m²</td>
                  <td>{el.progress_pct}%</td>
                  <td>
                    <span className={`badge ${el.status === "completed" ? "green" : el.status === "in_progress" ? "yellow" : "red"}`}>
                      {STATUS_LABELS[el.status]}
                    </span>
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
