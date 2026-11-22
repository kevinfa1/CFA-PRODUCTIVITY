import { offlineDb } from "./db";
import { demoFallback, isStaticPagesHost } from "./demoFallback";
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
import { blobToBase64 } from "./utils/attendanceUtils";

const API_BASE = import.meta.env.VITE_API_BASE || "";
const APPS_SCRIPT_STORAGE_KEY = "cfa_apps_script_url_v1";
const DEFAULT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbzEDg5uAeFjEDqmqQU22K2GGfO61_rInNZvJBI1eDrk-8rCP-3AaOElNfEVMOwcZF8B/exec";

type BackendMode = "fastapi" | "php" | "static";
let detectedModePromise: Promise<BackendMode> | null = null;

export async function detectBackendMode(): Promise<BackendMode> {
  if (isStaticPagesHost()) return "static";
  if (detectedModePromise) return detectedModePromise;

  detectedModePromise = (async () => {
    try {
      const phpRes = await fetch("./api.php?action=health", { cache: "no-store" });
      if (phpRes.ok) {
        const data = (await phpRes.json()) as { ok?: boolean; mode?: string };
        if (data?.ok && data?.mode === "php") return "php";
      }
    } catch {
      // No PHP endpoint
    }

    try {
      const apiRes = await fetch(`${API_BASE}/api/health`, { cache: "no-store" });
      if (apiRes.ok) {
        const data = (await apiRes.json()) as { status?: string };
        if (data?.status === "ok") return "fastapi";
      }
    } catch {
      // No FastAPI endpoint
    }

    return "static";
  })();

  return detectedModePromise;
}

export function getAppsScriptUrl(): string {
  const envUrl = (import.meta.env.VITE_APPS_SCRIPT_URL as string | undefined) || "";
  if (envUrl.trim()) return envUrl.trim();
  try {
    const saved = (localStorage.getItem(APPS_SCRIPT_STORAGE_KEY) || "").trim();
    if (saved) return saved;
  } catch {
    // ignore
  }
  return DEFAULT_APPS_SCRIPT_URL;
}

export function setAppsScriptUrl(url: string): void {
  try {
    const clean = url.trim();
    if (clean) localStorage.setItem(APPS_SCRIPT_STORAGE_KEY, clean);
    else localStorage.removeItem(APPS_SCRIPT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, init);
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { detail?: string; error?: string };
      if (parsed.detail) detail = parsed.detail;
      else if (parsed.error) detail = parsed.error;
    } catch {
      // ignore non-json error
    }
    throw new Error(detail || `Error HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function phpFetch<T>(action: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`./api.php?action=${encodeURIComponent(action)}`, init);
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || (data && typeof data === "object" && "ok" in data && data.ok === false)) {
    throw new Error((data as { error?: string }).error || `Error HTTP ${res.status}`);
  }
  return data;
}

export const api = {
  login: async (username: string, password: string): Promise<AuthSession> => {
    const mode = await detectBackendMode();
    if (mode === "static") return demoFallback.login(username, password);
    if (mode === "php") {
      return phpFetch<AuthSession>("login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    }
    return jsonFetch<AuthSession>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  },
  seedPilot: async (): Promise<Project> => {
    const mode = await detectBackendMode();
    if (mode === "static") return demoFallback.seedPilot();
    if (mode === "php") {
      const list = await phpFetch<Project[]>("projects");
      return list[0];
    }
    return jsonFetch<Project>("/api/projects/seed-pilot", { method: "POST" });
  },
  listProjects: async (): Promise<Project[]> => {
    const mode = await detectBackendMode();
    if (mode === "static") return demoFallback.listProjects();
    if (mode === "php") return phpFetch<Project[]>("projects");
    return jsonFetch<Project[]>("/api/projects");
  },
  updateProject: (id: number, body: Partial<Project>) =>
    jsonFetch<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  importDxf: async (projectId: number, file: File, wallHeightM = 2.6) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("default_wall_height_m", String(wallHeightM));
    return jsonFetch<{ imported_walls: number; floorplan_svg: string }>(
      `/api/projects/${projectId}/import-dxf`,
      { method: "POST", body: fd }
    );
  },

  getDashboard: (projectId: number, workDate?: string) =>
    isStaticPagesHost()
      ? demoFallback.getDashboard(projectId, workDate)
      : jsonFetch<DashboardData>(
          `/api/projects/${projectId}/dashboard${workDate ? `?work_date=${encodeURIComponent(workDate)}` : ""}`
        ),

  getCrews: async (projectId: number): Promise<Crew[]> => {
    const mode = await detectBackendMode();
    if (mode === "static") return demoFallback.getCrews(projectId);
    if (mode === "php") return phpFetch<Crew[]>(`crews&project_id=${projectId}`);
    return jsonFetch<Crew[]>(`/api/projects/${projectId}/crews`);
  },
  addWorker: async (crewId: number, name: string, role: WorkerRole) => {
    const mode = await detectBackendMode();
    if (mode === "static") return demoFallback.addWorker(crewId, name, role);
    if (mode === "php") {
      return phpFetch("add_worker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crew_id: crewId, name, role }),
      });
    }
    return jsonFetch(`/api/crews/${crewId}/workers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role }),
    });
  },

  getSchedule: (projectId: number) =>
    isStaticPagesHost() ? demoFallback.getSchedule() : jsonFetch<ScheduleItem[]>(`/api/projects/${projectId}/schedule`),
  saveSchedule: (
    projectId: number,
    items: Array<{ element_id: number; crew_id: number | null; walk_order: number; active: boolean; turn_hint: string }>
  ) =>
    jsonFetch<ScheduleItem[]>(`/api/projects/${projectId}/schedule`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    }),

  getFieldRoute: async (projectId: number, workDate?: string): Promise<FieldRouteResponse> => {
    if (isStaticPagesHost()) return demoFallback.getFieldRoute(projectId, workDate);
    const cacheKey = `route_${projectId}`;
    try {
      const route = await jsonFetch<FieldRouteResponse>(
        `/api/projects/${projectId}/field-route${workDate ? `?work_date=${encodeURIComponent(workDate)}` : ""}`
      );
      await offlineDb.cachedRoutes.put({ key: cacheKey, route, updatedAt: new Date().toISOString() });
      return route;
    } catch (err) {
      const cached = await offlineDb.cachedRoutes.get(cacheKey);
      if (cached) return cached.route;
      throw err;
    }
  },

  listApprovals: (projectId: number, status?: string) =>
    isStaticPagesHost()
      ? demoFallback.listApprovals()
      : jsonFetch<DailyCapture[]>(
          `/api/projects/${projectId}/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`
        ),

  approveCapture: (captureId: number, decision: "approved" | "adjusted" | "rejected", approvedAreaM2?: number) =>
    jsonFetch<DailyCapture>(`/api/captures/${captureId}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        approved_area_m2: approvedAreaM2,
        approved_by: "Supervisor Oficina",
      }),
    }),

  uploadCapture: async (params: {
    projectId: number;
    elementId: number;
    crewId: number | null;
    workDate: string;
    captureType: string;
    notes?: string;
    insideGeofence?: boolean | null;
    photoBlob: Blob;
    voiceBlob?: Blob;
  }) => {
    const fd = new FormData();
    fd.append("project_id", String(params.projectId));
    fd.append("element_id", String(params.elementId));
    fd.append("work_date", params.workDate);
    fd.append("capture_type", params.captureType);
    if (params.crewId !== null) fd.append("crew_id", String(params.crewId));
    if (params.notes) fd.append("notes", params.notes);
    if (params.insideGeofence != null) fd.append("inside_geofence", String(params.insideGeofence));
    fd.append("photo", params.photoBlob, `capture_${params.elementId}.jpg`);
    if (params.voiceBlob) fd.append("voice_note", params.voiceBlob, `voice_${params.elementId}.webm`);

    return jsonFetch<DailyCapture>("/api/captures", { method: "POST", body: fd });
  },

  reportNoProgress: (payload: {
    project_id: number;
    element_id: number;
    crew_id: number | null;
    work_date: string;
    stop_reason: string;
    notes?: string;
    inside_geofence?: boolean | null;
  }) =>
    jsonFetch<DailyCapture>("/api/captures/no-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),

  listAttendance: async (projectId: number): Promise<AttendanceLog[]> => {
    const mode = await detectBackendMode();
    if (mode === "static") return demoFallback.listAttendance(projectId);
    if (mode === "php") return phpFetch<AttendanceLog[]>(`attendance&project_id=${projectId}`);
    return jsonFetch<AttendanceLog[]>(`/api/projects/${projectId}/attendance`);
  },

  saveAttendance: async (
    projectId: number,
    payload: {
      crew_id: number;
      work_date: string;
      inside_geofence: boolean | null;
      distance_m: number | null;
      entries: AttendanceEntryPayload[];
      project_name?: string;
      registered_by?: string;
    },
    groupPhotoBlob?: Blob
  ) => {
    const scriptUrl = getAppsScriptUrl();
    if (scriptUrl) {
      let photoBase64 = "";
      let photoMime = "image/jpeg";
      if (groupPhotoBlob) {
        photoBase64 = await blobToBase64(groupPhotoBlob);
        photoMime = groupPhotoBlob.type || "image/jpeg";
      }
      const res = await fetch(scriptUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          project_name: payload.project_name || `Proyecto #${projectId}`,
          work_date: payload.work_date,
          registered_by: payload.registered_by || "Maestro de Obra",
          inside_geofence: payload.inside_geofence,
          distance_m: payload.distance_m,
          entries: payload.entries,
          photo_base64: photoBase64,
          photo_mime: photoMime,
        }),
      });
      if (!res.ok) {
        throw new Error(`Error Google Apps Script HTTP ${res.status}`);
      }
      const data = (await res.json()) as { ok?: boolean; error?: string; photo_url?: string };
      if (!data.ok) {
        throw new Error(data.error || "Error al guardar en Google Drive");
      }
      if ((await detectBackendMode()) === "static") {
        return demoFallback.saveAttendance(projectId, payload, groupPhotoBlob);
      }
    }

    const mode = await detectBackendMode();
    if (mode === "static") {
      return demoFallback.saveAttendance(projectId, payload, groupPhotoBlob);
    }
    if (mode === "php") {
      let photoBase64 = "";
      if (groupPhotoBlob) {
        photoBase64 = await blobToBase64(groupPhotoBlob);
      }
      return phpFetch<AttendanceLog>("save_attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          ...payload,
          photo_base64: photoBase64,
        }),
      });
    }

    const log = await jsonFetch<AttendanceLog>(`/api/projects/${projectId}/attendance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (groupPhotoBlob) {
      const fd = new FormData();
      fd.append("photo", groupPhotoBlob, `group_${payload.work_date}.jpg`);
      await jsonFetch(`/api/attendance/${log.id}/group-photo`, { method: "POST", body: fd });
    }
    return log;
  },

  syncOfflineQueues: async (): Promise<{ syncedCaptures: number; syncedAttendance: number }> => {
    let syncedCaptures = 0;
    let syncedAttendance = 0;

    const pendingCaps = await offlineDb.pendingCaptures.toArray();
    for (const item of pendingCaps) {
      try {
        if (item.captureType === "no_progress") {
          await api.reportNoProgress({
            project_id: item.projectId,
            element_id: item.elementId,
            crew_id: item.crewId,
            work_date: item.workDate,
            stop_reason: item.stopReason || "otro",
            notes: item.notes,
            inside_geofence: item.insideGeofence,
          });
        } else if (item.photoBlob) {
          await api.uploadCapture({
            projectId: item.projectId,
            elementId: item.elementId,
            crewId: item.crewId,
            workDate: item.workDate,
            captureType: item.captureType,
            notes: item.notes,
            insideGeofence: item.insideGeofence,
            photoBlob: item.photoBlob,
            voiceBlob: item.voiceBlob,
          });
        }
        if (item.id !== undefined) await offlineDb.pendingCaptures.delete(item.id);
        syncedCaptures++;
      } catch {
        break;
      }
    }

    const pendingAtt = await offlineDb.pendingAttendance.toArray();
    for (const item of pendingAtt) {
      try {
        await api.saveAttendance(
          item.projectId,
          {
            crew_id: item.crewId,
            work_date: item.workDate,
            inside_geofence: item.insideGeofence,
            distance_m: item.distanceM,
            entries: item.entries,
            project_name: item.projectName,
            registered_by: item.registeredBy,
          },
          item.groupPhotoBlob
        );
        if (item.id !== undefined) await offlineDb.pendingAttendance.delete(item.id);
        syncedAttendance++;
      } catch {
        break;
      }
    }

    return { syncedCaptures, syncedAttendance };
  },
};
