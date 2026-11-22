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
</svg>`;

const projects: Project[] = [
  {
    id: 1,
    name: "Casa Las Flores",
    location: "Casa Las Flores",
    geofence_lat: 14.6349,
    geofence_lng: -90.5069,
    geofence_radius_m: 100,
    north_offset_deg: 0,
    floorplan_svg: DEMO_SVG,
  },
  {
    id: 2,
    name: "Pia Pia",
    location: "Pia Pia",
    geofence_lat: 14.6349,
    geofence_lng: -90.5069,
    geofence_radius_m: 100,
    north_offset_deg: 0,
    floorplan_svg: DEMO_SVG,
  },
];

let crewsByProject: Record<number, Crew[]> = {
  1: [
    {
      id: 1,
      project_id: 1,
      name: "Planilla Casa Las Flores",
      trade: "mamposteria",
      workers: [
        { id: 1, crew_id: 1, name: "Moises Mendoza", role: "Albañil", active: true },
        { id: 2, crew_id: 1, name: "Maycol Lara", role: "Albañil", active: true },
        { id: 3, crew_id: 1, name: "Mario Blass", role: "Albañil", active: true },
        { id: 4, crew_id: 1, name: "Jose Alexander Alegria", role: "Albañil", active: true },
        { id: 5, crew_id: 1, name: "Celestino", role: "Albañil", active: true },
        { id: 6, crew_id: 1, name: "Pablo Blass", role: "Ayudante", active: true },
        { id: 7, crew_id: 1, name: "Alberto Dormez", role: "Ayudante", active: true },
        { id: 8, crew_id: 1, name: "Uriel Hernandez", role: "Ayudante", active: true },
        { id: 9, crew_id: 1, name: "Nervin Hernandez", role: "Ayudante", active: true },
        { id: 10, crew_id: 1, name: "Daniel Espinoza", role: "Ayudante", active: true },
        { id: 11, crew_id: 1, name: "Fernando Jose Sandino", role: "Ayudante", active: true },
        { id: 12, crew_id: 1, name: "Simon Bonilla", role: "Ayudante", active: true },
        { id: 13, crew_id: 1, name: "Edwin Jimenez", role: "Ayudante", active: true },
        { id: 14, crew_id: 1, name: "Cristhian Espinoza", role: "Ayudante", active: true },
      ],
    },
  ],
  2: [
    {
      id: 2,
      project_id: 2,
      name: "Planilla Pia Pia",
      trade: "mamposteria",
      workers: [
        { id: 101, crew_id: 2, name: "Manuel Reyes", role: "Albañil", active: true },
        { id: 102, crew_id: 2, name: "Jose Alcides Noguera", role: "Albañil", active: true },
        { id: 103, crew_id: 2, name: "Gabriel Mena", role: "Albañil", active: true },
      ],
    },
  ],
};

const STORAGE_KEY_LOGS = "cfa_demo_attendance_logs_v2";

function loadAllLogs(): AttendanceLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_LOGS);
    if (raw) return JSON.parse(raw) as AttendanceLog[];
  } catch {
    // ignore
  }
  return [];
}

function saveAllLogs(logs: AttendanceLog[]): void {
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
  listProjects: async (): Promise<Project[]> => projects,
  seedPilot: async (): Promise<Project> => projects[0],
  getCrews: async (projectId = 1): Promise<Crew[]> => crewsByProject[projectId] ?? [],
  addWorker: async (crewId: number, name: string, role: WorkerRole) => {
    const worker = { id: Date.now(), crew_id: crewId, name, role, active: true };
    for (const pid of Object.keys(crewsByProject).map(Number)) {
      crewsByProject[pid] = crewsByProject[pid].map((c) =>
        c.id === crewId ? { ...c, workers: [...c.workers, worker] } : c
      );
    }
    return worker;
  },
  listAttendance: async (projectId = 1): Promise<AttendanceLog[]> =>
    loadAllLogs().filter((l) => l.project_id === projectId),
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
    const remaining = loadAllLogs().filter(
      (l) => !(l.project_id === projectId && l.work_date === payload.work_date)
    );
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
    const updated = [newLog, ...remaining];
    saveAllLogs(updated);
    return newLog;
  },
  getDashboard: async (_projectId?: number, _workDate?: string): Promise<DashboardData> => {
    throw new Error("Dashboard deshabilitado temporalmente");
  },
  listApprovals: async (): Promise<DailyCapture[]> => [],
  getFieldRoute: async (_projectId?: number, _workDate?: string): Promise<FieldRouteResponse> => {
    throw new Error("Recorrido deshabilitado temporalmente");
  },
  getSchedule: async (): Promise<ScheduleItem[]> => [],
};
