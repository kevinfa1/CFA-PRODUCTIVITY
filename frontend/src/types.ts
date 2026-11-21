export interface Project {
  id: number;
  name: string;
  location: string;
  geofence_lat: number | null;
  geofence_lng: number | null;
  geofence_radius_m: number;
  north_offset_deg: number;
  floorplan_svg: string;
}

export interface WallElement {
  id: number;
  project_id: number;
  code: string;
  room_name: string;
  wall_name: string;
  svg_element_id: string;
  trade: string;
  gross_area_m2: number;
  openings_area_m2: number;
  net_area_m2: number;
  apu_target_m2_per_hh: number;
  expected_heading_deg: number;
  day1_photo_path: string | null;
  approved_area_m2: number;
  status: "not_started" | "in_progress" | "completed";
}

export interface Worker {
  id: number;
  crew_id: number;
  name: string;
  role: string;
  active: boolean;
}

export interface Crew {
  id: number;
  project_id: number;
  name: string;
  trade: string;
  workers: Worker[];
}

export interface ScheduleItem {
  id: number;
  project_id: number;
  element_id: number;
  crew_id: number | null;
  walk_order: number;
  active: boolean;
  turn_hint: string;
  element: WallElement;
  crew?: Crew | null;
}

export interface FieldRouteStep {
  step_index: number;
  total_steps: number;
  schedule_item_id: number;
  element_id: number;
  code: string;
  room_name: string;
  wall_name: string;
  trade: string;
  net_area_m2: number;
  approved_area_m2: number;
  status: string;
  expected_heading_deg: number;
  needs_day1_ruler: boolean;
  ghost_photo_url: string | null;
  turn_hint: string;
  crew_id: number | null;
  crew_name: string;
  captured_today: boolean;
}

export interface FieldRouteResponse {
  project_id: number;
  project_name: string;
  work_date: string;
  geofence: {
    lat: number | null;
    lng: number | null;
    radius_m: number;
  };
  steps: FieldRouteStep[];
}

export interface DailyCapture {
  id: number;
  project_id: number;
  element_id: number;
  crew_id: number | null;
  work_date: string;
  capture_type: string;
  stop_reason: string;
  notes: string;
  photo_path: string | null;
  overlay_path: string | null;
  voice_note_path: string | null;
  calculated_area_m2: number;
  delta_area_m2: number;
  alignment_inliers: number;
  inside_geofence: boolean | null;
  vision_notes: string;
  approval_status: "pending" | "approved" | "adjusted" | "rejected";
  approved_area_m2: number | null;
  approved_by: string;
  created_at: string;
  element?: WallElement;
}

export interface DashboardData {
  project: {
    id: number;
    name: string;
    location: string;
    north_offset_deg: number;
    floorplan_svg: string;
  };
  work_date: string;
  kpis: {
    total_net_m2: number;
    total_approved_m2: number;
    progress_pct: number;
    delta_today_m2: number;
    total_hh_today: number;
    real_yield_m2_per_hh: number;
    apu_target_m2_per_hh: number;
    pending_approvals: number;
  };
  alerts: string[];
  stop_causes: Record<string, number>;
  elements: Array<{
    id: number;
    code: string;
    room_name: string;
    wall_name: string;
    svg_element_id: string;
    trade: string;
    net_area_m2: number;
    approved_area_m2: number;
    progress_pct: number;
    apu_target_m2_per_hh: number;
    status: "not_started" | "in_progress" | "completed";
  }>;
}

export interface AttendanceEntryPayload {
  worker_id?: number | null;
  worker_name: string;
  role: string;
  status: "presente" | "parcial" | "ausente";
  normal_hours: number;
  extra_hours: number;
  reason: string;
}

export interface AttendanceLog {
  id: number;
  project_id: number;
  crew_id: number;
  work_date: string;
  present_count: number;
  total_workers: number;
  total_hh: number;
  inside_geofence: boolean | null;
  distance_m: number | null;
  group_photo_path: string | null;
  entries: AttendanceEntryPayload[];
}
