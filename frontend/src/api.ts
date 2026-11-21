import { offlineDb } from "./db";
import type {
  AttendanceEntryPayload,
  AttendanceLog,
  Crew,
  DailyCapture,
  DashboardData,
  FieldRouteResponse,
  Project,
  ScheduleItem,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "";

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Error HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  seedPilot: () => jsonFetch<Project>("/api/projects/seed-pilot", { method: "POST" }),
  listProjects: () => jsonFetch<Project[]>("/api/projects"),
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
    jsonFetch<DashboardData>(
      `/api/projects/${projectId}/dashboard${workDate ? `?work_date=${encodeURIComponent(workDate)}` : ""}`
    ),

  getCrews: (projectId: number) => jsonFetch<Crew[]>(`/api/projects/${projectId}/crews`),
  addWorker: (crewId: number, name: string, role: string) =>
    jsonFetch(`/api/crews/${crewId}/workers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, role }),
    }),

  getSchedule: (projectId: number) => jsonFetch<ScheduleItem[]>(`/api/projects/${projectId}/schedule`),
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
    jsonFetch<DailyCapture[]>(
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

  listAttendance: (projectId: number) => jsonFetch<AttendanceLog[]>(`/api/projects/${projectId}/attendance`),

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
  ) => {
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
