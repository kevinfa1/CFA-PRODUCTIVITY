import Dexie, { type EntityTable } from "dexie";
import type { AttendanceEntryPayload, FieldRouteResponse } from "./types";

export interface OfflineCaptureQueueItem {
  id?: number;
  projectId: number;
  elementId: number;
  crewId: number | null;
  workDate: string;
  captureType: "day1_calibration" | "daily_progress" | "no_progress" | "forced_voice_note";
  stopReason?: string;
  notes?: string;
  insideGeofence?: boolean | null;
  photoBlob?: Blob;
  voiceBlob?: Blob;
  createdAt: string;
}

export interface OfflineAttendanceQueueItem {
  id?: number;
  projectId: number;
  projectName?: string;
  registeredBy?: string;
  crewId: number;
  workDate: string;
  insideGeofence: boolean | null;
  distanceM: number | null;
  entries: AttendanceEntryPayload[];
  groupPhotoBlob?: Blob;
  createdAt: string;
}

export interface CachedRoute {
  key: string;
  route: FieldRouteResponse;
  updatedAt: string;
}

class CfaOfflineDatabase extends Dexie {
  pendingCaptures!: EntityTable<OfflineCaptureQueueItem, "id">;
  pendingAttendance!: EntityTable<OfflineAttendanceQueueItem, "id">;
  cachedRoutes!: EntityTable<CachedRoute, "key">;

  constructor() {
    super("cfa_productivity_offline_v1");
    this.version(1).stores({
      pendingCaptures: "++id, projectId, elementId, createdAt",
      pendingAttendance: "++id, projectId, crewId, workDate",
      cachedRoutes: "key",
    });
  }
}

export const offlineDb = new CfaOfflineDatabase();
