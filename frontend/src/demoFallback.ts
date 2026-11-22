import type {
  AttendanceEntryPayload,
  AttendanceLog,
  AuthSession,
  Crew,
  DailyCapture,
  DashboardData,
  FieldRouteResponse,
  Project,
  ScheduleItem,
  WorkerRole,
} from "./types";

const DEMO_SVG = `<svg viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg">
  <rect width="800" height="480" fill="#0f172a" rx="14" />
  <rect x="40" y="40" width="220" height="190" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />
  <rect x="260" y="40" width="260" height="190" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />
  <rect x="520" y="40" width="240" height="190" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />
  <rect x="260" y="230" width="500" height="210" fill="#1e293b" stroke="#334155" stroke-width="2" rx="6" />
  <text x="150" y="140" fill="#94a3b8" font-size="16" font-weight="700" text-anchor="middle">ENTRADA</text>
  <text x="390" y="140" fill="#94a3b8" font-size="16" font-weight="700" text-anchor="middle">COCINA</text>
  <text x="640" y="140" fill="#94a3b8" font-size="16" font-weight="700" text-anchor="middle">BAÑO</text>
  <text x="510" y="340" fill="#94a3b8" font-size="18" font-weight="700" text-anchor="middle">CUARTO 2</text>
  <g transform="translate(115, 340)">
    <circle cx="0" cy="0" r="28" fill="#111827" stroke="#38bdf8" stroke-width="2" />
    <polygon points="0,-20 7,6 0,0 -7,6" fill="#38bdf8" />
    <text x="0" y="21" fill="#f8fafc" font-size="11" font-weight="800" text-anchor="middle">N</text>
  </g>
  <line id="wall-m01" data-wall-code="M-01" x1="40" y1="40" x2="260" y2="40" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m02" data-wall-code="M-02" x1="40" y1="40" x2="40" y2="230" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m03" data-wall-code="M-03" x1="260" y1="40" x2="520" y2="40" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m04" data-wall-code="M-04" x1="520" y1="40" x2="520" y2="230" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m05" data-wall-code="M-05" x1="520" y1="40" x2="760" y2="40" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m06" data-wall-code="M-06" x1="760" y1="40" x2="760" y2="230" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m07" data-wall-code="M-07" x1="760" y1="230" x2="760" y2="440" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
  <line id="wall-m08" data-wall-code="M-08" x1="260" y1="440" x2="760" y2="440" stroke="#ef4444" stroke-width="10" stroke-linecap="round" />
</svg>`;

const project: Project = {
  id: 1,
  name: "Obra Piloto CFA — Apartamento 101",
  location: "Sector Norte, Frente Piloto",
  geofence_lat: 14.6349,
  geofence_lng: -90.5069,
  geofence_radius_m: 100,
  north_offset_deg: 0,
  floorplan_svg: DEMO_SVG,
};

let crews: Crew[] = [
  {
    id: 1,
    project_id: 1,
    name: "Planilla General",
    trade: "mamposteria",
    workers: [
      { id: 1, crew_id: 1, name: "Jose Alcides Noguera", role: "Albañil", active: true },
      { id: 2, crew_id: 1, name: "Moises Mendoza", role: "Albañil", active: true },
      { id: 3, crew_id: 1, name: "Manuel Reyes", role: "Albañil", active: true },
      { id: 4, crew_id: 1, name: "Maycol Lara", role: "Albañil", active: true },
      { id: 5, crew_id: 1, name: "Mario Blass", role: "Albañil", active: true },
      { id: 6, crew_id: 1, name: "Jose Alexander Alegria", role: "Albañil", active: true },
      { id: 7, crew_id: 1, name: "Pablo Blass", role: "Albañil", active: true },
      { id: 8, crew_id: 1, name: "Alberto Dormez", role: "Ayudante", active: true },
      { id: 9, crew_id: 1, name: "Uriel Hernandez", role: "Ayudante", active: true },
      { id: 10, crew_id: 1, name: "Nervin Hernandez", role: "Ayudante", active: true },
      { id: 11, crew_id: 1, name: "Jinner Palacios", role: "Ayudante", active: true },
      { id: 12, crew_id: 1, name: "Daniel Espinoza", role: "Ayudante", active: true },
      { id: 13, crew_id: 1, name: "Fernando Jose Sandino", role: "Ayudante", active: true },
      { id: 14, crew_id: 1, name: "Simon Bonilla", role: "Ayudante", active: true },
      { id: 15, crew_id: 1, name: "Edwin Jimenez", role: "Ayudante", active: true },
      { id: 16, crew_id: 1, name: "Juan Carlos Perez", role: "Ayudante", active: true },
      { id: 17, crew_id: 1, name: "Pedro Lopez", role: "Ayudante", active: true },
      { id: 18, crew_id: 1, name: "Cristhian Espinoza", role: "Ayudante", active: true },
      { id: 19, crew_id: 1, name: "Joel Gonzales", role: "Ayudante", active: true },
    ],
  },
];

const elements: DashboardData["elements"] = [
  { id: 1, code: "M-01", room_name: "Entrada", wall_name: "Muro Norte", svg_element_id: "wall-m01", trade: "mamposteria", net_area_m2: 8.3, approved_area_m2: 8.3, progress_pct: 100, apu_target_m2_per_hh: 1.25, status: "completed" },
  { id: 2, code: "M-02", room_name: "Entrada", wall_name: "Muro Oeste", svg_element_id: "wall-m02", trade: "mamposteria", net_area_m2: 9.1, approved_area_m2: 5.2, progress_pct: 57.1, apu_target_m2_per_hh: 1.25, status: "in_progress" },
  { id: 3, code: "M-03", room_name: "Cocina", wall_name: "Muro Norte", svg_element_id: "wall-m03", trade: "mamposteria", net_area_m2: 10.2, approved_area_m2: 6.4, progress_pct: 62.7, apu_target_m2_per_hh: 1.2, status: "in_progress" },
  { id: 4, code: "M-04", room_name: "Cocina", wall_name: "Muro Este", svg_element_id: "wall-m04", trade: "mamposteria", net_area_m2: 9.6, approved_area_m2: 0.0, progress_pct: 0, apu_target_m2_per_hh: 1.2, status: "not_started" },
  { id: 5, code: "M-05", room_name: "Baño", wall_name: "Muro Norte", svg_element_id: "wall-m05", trade: "repello", net_area_m2: 7.6, approved_area_m2: 7.6, progress_pct: 100, apu_target_m2_per_hh: 1.5, status: "completed" },
  { id: 6, code: "M-06", room_name: "Baño", wall_name: "Muro Este", svg_element_id: "wall-m06", trade: "repello", net_area_m2: 7.8, approved_area_m2: 3.1, progress_pct: 39.7, apu_target_m2_per_hh: 1.5, status: "in_progress" },
  { id: 7, code: "M-07", room_name: "Cuarto 2", wall_name: "Muro Este", svg_element_id: "wall-m07", trade: "repello", net_area_m2: 9.7, approved_area_m2: 0.0, progress_pct: 0, apu_target_m2_per_hh: 1.45, status: "not_started" },
  { id: 8, code: "M-08", room_name: "Cuarto 2", wall_name: "Muro Sur", svg_element_id: "wall-m08", trade: "pintura", net_area_m2: 11.6, approved_area_m2: 0.0, progress_pct: 0, apu_target_m2_per_hh: 2.8, status: "not_started" },
];

const STORAGE_KEY_LOGS = "cfa_demo_attendance_logs_v1";

function loadLogs(): AttendanceLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOGS);
    if (raw) return JSON.parse(raw) as AttendanceLog[];
  } catch {
    // ignore
  }
  return [];
}

function saveLogs(logs: AttendanceLog[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_LOGS, JSON.stringify(logs));
  } catch {
    // ignore
  }
}

export const isStaticPagesHost = (): boolean =>
  typeof window !== "undefined" && window.location.hostname.endsWith("github.io");

export const demoFallback = {
  login: async (username: string, password: string): Promise<AuthSession> => {
    const cleanUser = username.trim().toLowerCase();
    const accounts: Record<string, { username: string; password: string; display_name: string; role: string }> = {
      moises: { username: "Moises", password: "flores2026", display_name: "Moisés (Maestro de Obra)", role: "maestro" },
      kevin: { username: "kevin", password: "kevin2026", display_name: "Kevin", role: "admin" },
      norman: { username: "norman", password: "norman2026", display_name: "Norman", role: "admin" },
      maestro: { username: "maestro", password: "cfa2026", display_name: "Maestro de Obra", role: "maestro" },
      admin: { username: "admin", password: "cfa_admin_2026", display_name: "Residente / Oficina", role: "admin" },
    };
    const match = accounts[cleanUser];
    if (match && password === match.password) {
      return {
        token: `demo-${cleanUser}-token`,
        username: match.username,
        display_name: match.display_name,
        role: match.role,
        allowed_tabs: ["attendance"],
      };
    }
    throw new Error("Usuario o contraseña incorrectos");
  },
  listProjects: async (): Promise<Project[]> => [project],
  seedPilot: async (): Promise<Project> => project,
  getCrews: async (): Promise<Crew[]> => crews,
  addWorker: async (crewId: number, name: string, role: WorkerRole) => {
    const worker = { id: Date.now(), crew_id: crewId, name, role, active: true };
    crews = crews.map((c) => (c.id === crewId ? { ...c, workers: [...c.workers, worker] } : c));
    return worker;
  },
  listAttendance: async (): Promise<AttendanceLog[]> => loadLogs(),
  saveAttendance: async (
    projectId: number,
    payload: {
      crew_id: number;
      work_date: string;
      inside_geofence: boolean | null;
      distance_m: number | null;
      entries: AttendanceEntryPayload[];
    },
    groupPhotoBlob?: Blob
  ): Promise<AttendanceLog> => {
    const logs = loadLogs().filter((l) => l.work_date !== payload.work_date);
    const presentCount = payload.entries.filter((e) => e.status !== "ausente").length;
    const totalHH = payload.entries.reduce(
      (sum, e) => sum + (e.status === "ausente" ? 0 : e.normal_hours + e.extra_hours),
      0
    );
    const newLog: AttendanceLog = {
      id: Date.now(),
      project_id: projectId,
      crew_id: payload.crew_id,
      work_date: payload.work_date,
      present_count: presentCount,
      total_workers: payload.entries.length,
      total_hh: Math.round(totalHH * 10) / 10,
      inside_geofence: payload.inside_geofence,
      distance_m: payload.distance_m,
      group_photo_path: groupPhotoBlob ? URL.createObjectURL(groupPhotoBlob) : null,
      entries: payload.entries,
    };
    const updated = [newLog, ...logs];
    saveLogs(updated);
    return newLog;
  },
  getDashboard: async (_projectId: number, workDate?: string): Promise<DashboardData> => {
    const today = workDate || new Date().toISOString().slice(0, 10);
    const logs = loadLogs().filter((l) => l.work_date === today);
    const totalHH = logs.reduce((s, l) => s + l.total_hh, 0) || 24;
    const totalNet = elements.reduce((s, e) => s + e.net_area_m2, 0);
    const totalApp = elements.reduce((s, e) => s + e.approved_area_m2, 0);
    return {
      project: {
        id: project.id,
        name: project.name,
        location: project.location,
        north_offset_deg: project.north_offset_deg,
        floorplan_svg: project.floorplan_svg,
      },
      work_date: today,
      kpis: {
        total_net_m2: Math.round(totalNet * 10) / 10,
        total_approved_m2: Math.round(totalApp * 10) / 10,
        progress_pct: Math.round((totalApp / totalNet) * 1000) / 10,
        delta_today_m2: 6.4,
        total_hh_today: totalHH,
        real_yield_m2_per_hh: Math.round((6.4 / totalHH) * 100) / 100,
        apu_target_m2_per_hh: 1.35,
        pending_approvals: 0,
      },
      alerts: ["Modo vista previa estática en GitHub Pages (los datos de asistencia se guardan en este teléfono)."],
      stop_causes: {},
      elements,
    };
  },
  listApprovals: async (): Promise<DailyCapture[]> => [],
  getFieldRoute: async (_projectId: number, workDate?: string): Promise<FieldRouteResponse> => ({
    project_id: project.id,
    project_name: project.name,
    work_date: workDate || new Date().toISOString().slice(0, 10),
    geofence: { lat: project.geofence_lat, lng: project.geofence_lng, radius_m: project.geofence_radius_m },
    steps: elements.map((el, idx) => ({
      step_index: idx + 1,
      total_steps: elements.length,
      schedule_item_id: el.id,
      element_id: el.id,
      code: el.code,
      room_name: el.room_name,
      wall_name: el.wall_name,
      trade: el.trade,
      net_area_m2: el.net_area_m2,
      approved_area_m2: el.approved_area_m2,
      status: el.status,
      expected_heading_deg: (idx * 90) % 360,
      needs_day1_ruler: idx > 2,
      ghost_photo_url: null,
      turn_hint: `${el.room_name} — ${el.wall_name}`,
      crew_id: idx < 4 ? 1 : 2,
      crew_name: idx < 4 ? "Cuadrilla Mampostería A" : "Cuadrilla Repello B",
      captured_today: false,
    })),
  }),
  getSchedule: async (): Promise<ScheduleItem[]> =>
    elements.map((el, idx) => ({
      id: el.id,
      project_id: 1,
      element_id: el.id,
      crew_id: idx < 4 ? 1 : 2,
      walk_order: idx + 1,
      active: true,
      turn_hint: `${el.room_name} — ${el.wall_name}`,
      element: {
        id: el.id,
        project_id: 1,
        code: el.code,
        room_name: el.room_name,
        wall_name: el.wall_name,
        svg_element_id: el.svg_element_id,
        trade: el.trade,
        gross_area_m2: el.net_area_m2,
        openings_area_m2: 0,
        net_area_m2: el.net_area_m2,
        apu_target_m2_per_hh: el.apu_target_m2_per_hh,
        expected_heading_deg: 0,
        day1_photo_path: null,
        approved_area_m2: el.approved_area_m2,
        status: el.status,
      },
    })),
};
