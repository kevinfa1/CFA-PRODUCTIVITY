import type { AttendanceDraftEntry, WorkerRole } from "../types";

export const ABSENCE_REASONS = ["Falta", "Enfermedad", "Permiso", "Otro"] as const;
export const PARTIAL_HOURS_OPTIONS = [4, 6] as const;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function normalizeWorkerRole(role: string | undefined | null): WorkerRole {
  const cleaned = (role ?? "").trim().toLowerCase();
  if (cleaned === "ayudante") return "Ayudante";
  return "Albañil";
}

export interface AttendanceSummary {
  totalWorkers: number;
  unmarkedCount: number;
  presentCount: number;
  partialCount: number;
  absentCount: number;
  totalHH: number;
  albanilesTotal: number;
  albanilesPresent: number;
  ayudantesTotal: number;
  ayudantesPresent: number;
}

export function summarizeAttendance(entries: AttendanceDraftEntry[]): AttendanceSummary {
  let unmarkedCount = 0;
  let presentCount = 0;
  let partialCount = 0;
  let absentCount = 0;
  let totalHH = 0;
  let albanilesTotal = 0;
  let albanilesPresent = 0;
  let ayudantesTotal = 0;
  let ayudantesPresent = 0;

  for (const e of entries) {
    const role = normalizeWorkerRole(e.role);
    const isPresent = e.status === "presente" || e.status === "parcial";

    if (role === "Albañil") {
      albanilesTotal += 1;
      if (isPresent) albanilesPresent += 1;
    } else {
      ayudantesTotal += 1;
      if (isPresent) ayudantesPresent += 1;
    }

    if (e.status === null) {
      unmarkedCount += 1;
    } else if (e.status === "presente") {
      presentCount += 1;
      totalHH += e.normal_hours + e.extra_hours;
    } else if (e.status === "parcial") {
      presentCount += 1;
      partialCount += 1;
      totalHH += e.normal_hours + e.extra_hours;
    } else {
      absentCount += 1;
    }
  }

  return {
    totalWorkers: entries.length,
    unmarkedCount,
    presentCount,
    partialCount,
    absentCount,
    totalHH: Math.round(totalHH * 10) / 10,
    albanilesTotal,
    albanilesPresent,
    ayudantesTotal,
    ayudantesPresent,
  };
}

export function formatSpanishDate(isoDate: string): string {
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return isoDate;
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
  try {
    return new Intl.DateTimeFormat("es-GT", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(dateObj);
  } catch {
    return isoDate;
  }
}

export function triggerHaptic(ms = 20): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(ms);
    }
  } catch {
    // Ignore on unsupported browsers
  }
}

export interface PhotoStampMeta {
  projectName: string;
  workDate: string;
  presentCount: number;
  totalWorkers: number;
  albanilesPresent: number;
  ayudantesPresent: number;
  gpsLabel: string;
}

/**
 * Comprime la foto para redes móviles de obra y estampa un sello corporativo
 * de alto contraste (proyecto, fecha/hora, conteo global Albañil/Ayudante y GPS).
 */
export async function stampCrewPhoto(file: File, meta: PhotoStampMeta): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    return file;
  }

  try {
    const bitmap = await createImageBitmap(file);
    const maxWidth = 1440;
    const scale = bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const bannerHeight = Math.max(96, Math.round(height * 0.14));
    const y0 = height - bannerHeight;

    // Fondo corporativo azul marino sólido + franja ámbar superior
    ctx.fillStyle = "rgba(11, 31, 58, 0.94)";
    ctx.fillRect(0, y0, width, bannerHeight);
    ctx.fillStyle = "#F59E0B";
    ctx.fillRect(0, y0, width, Math.max(4, Math.round(bannerHeight * 0.06)));

    const padX = Math.max(16, Math.round(width * 0.025));
    const titleSize = Math.max(18, Math.round(bannerHeight * 0.28));
    const subSize = Math.max(14, Math.round(bannerHeight * 0.21));
    const timeStr = new Date().toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit" });

    ctx.fillStyle = "#FFFFFF";
    ctx.font = `700 ${titleSize}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.fillText(`CFA · ${meta.projectName}`, padX, y0 + Math.round(bannerHeight * 0.42));

    ctx.fillStyle = "#FDE68A";
    ctx.font = `600 ${subSize}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.fillText(
      `Presentes: ${meta.presentCount}/${meta.totalWorkers} (${meta.albanilesPresent} Alb. · ${meta.ayudantesPresent} Ayud.)  |  ${meta.workDate} ${timeStr}  |  ${meta.gpsLabel}`,
      padX,
      y0 + Math.round(bannerHeight * 0.78)
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.86)
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
