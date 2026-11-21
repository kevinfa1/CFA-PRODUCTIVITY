"""Servicio de visión del backend: conecta OpenCV (ArUco + homografía), segmentación y overlay."""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from vision_lab.calibrate_and_align import align_daily_photo, calibrate_day1
from vision_lab.segmenters import DiffThresholdSegmenter


def _render_approval_overlay(
    image_bgr: np.ndarray,
    mask: Optional[np.ndarray],
    area_m2: float,
    net_area_m2: float,
    subtitle: str,
) -> np.ndarray:
    """Genera la imagen con máscara semitransparente verde para la validación de 5 segundos."""
    vis = image_bgr.copy()
    if mask is not None and np.count_nonzero(mask) > 0:
        green = np.zeros_like(vis)
        green[:, :, 1] = 220
        m_bool = mask > 0
        vis[m_bool] = cv2.addWeighted(vis[m_bool], 0.62, green[m_bool], 0.38, 0)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(vis, contours, -1, (0, 255, 0), 2)

    pct = min(100.0, (area_m2 / net_area_m2 * 100.0)) if net_area_m2 > 0 else 0.0
    banner_h = min(64, max(44, vis.shape[0] // 10))
    cv2.rectangle(vis, (0, 0), (vis.shape[1], banner_h), (15, 23, 42), -1)
    cv2.putText(
        vis,
        f"Avance IA: {area_m2:.2f} / {net_area_m2:.2f} m2 ({pct:.1f}%)",
        (12, int(banner_h * 0.45)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.6,
        (248, 250, 252),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        vis,
        subtitle[:70],
        (12, int(banner_h * 0.85)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.48,
        (134, 239, 172),
        1,
        cv2.LINE_AA,
    )
    return vis


def process_day1_photo(
    photo_path: Path,
    rectified_out_path: Path,
    marker_size_m: float = 0.15,
    center_distance_m: float = 0.80,
) -> tuple[Optional[str], Optional[str], str]:
    """Intenta calibrar con regla ArUco; si no detecta marcadores, guarda referencia base sin bloquear."""
    img = cv2.imread(str(photo_path))
    if img is None:
        return None, None, "No se pudo leer la imagen Día 1."

    try:
        rectified, cal = calibrate_day1(
            day1_bgr=img,
            marker_size_m=marker_size_m,
            center_distance_m=center_distance_m,
            pixels_per_meter=260.0,
        )
        rectified_out_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(rectified_out_path), rectified)
        return (
            str(rectified_out_path),
            json.dumps(asdict(cal)),
            f"Calibración ArUco OK ({cal.pixels_per_meter:.1f} px/m, err {cal.reprojection_error_mm:.2f} mm).",
        )
    except Exception as exc:
        # Fallback operativo: guardar foto sin rectificar para permitir seguimiento visual y ajuste manual
        rectified_out_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(rectified_out_path), img)
        return (
            str(rectified_out_path),
            None,
            f"Referencia Día 1 guardada sin regla ArUco ({exc}). Escala estimada por área neta del plano.",
        )


def process_daily_progress_photo(
    photo_path: Path,
    day1_rectified_path: Optional[Path],
    calibration_json: Optional[str],
    net_area_m2: float,
    previous_approved_m2: float,
    overlay_out_path: Path,
) -> dict:
    """Alinea foto diaria contra Día 1, segmenta avance, aplica tope al área neta y genera overlay."""
    day_bgr = cv2.imread(str(photo_path))
    if day_bgr is None:
        return {
            "calculated_area_m2": previous_approved_m2,
            "delta_area_m2": 0.0,
            "alignment_inliers": 0,
            "overlay_path": None,
            "vision_notes": "No se pudo leer la fotografía subida.",
        }

    overlay_out_path.parent.mkdir(parents=True, exist_ok=True)

    if day1_rectified_path is None or not day1_rectified_path.exists():
        vis = _render_approval_overlay(day_bgr, None, previous_approved_m2, net_area_m2, "Sin referencia Dia 1")
        cv2.imwrite(str(overlay_out_path), vis)
        return {
            "calculated_area_m2": previous_approved_m2,
            "delta_area_m2": 0.0,
            "alignment_inliers": 0,
            "overlay_path": str(overlay_out_path),
            "vision_notes": "Falta foto de referencia del Día 1. Ajusta el avance manualmente en Oficina.",
        }

    ref_bgr = cv2.imread(str(day1_rectified_path))
    cal_data = json.loads(calibration_json) if calibration_json else None
    exclude_bbox = cal_data.get("ruler_bbox_rectified") if cal_data else None

    aligned_bgr, align_res = align_daily_photo(
        day_bgr=day_bgr,
        day1_rectified_bgr=ref_bgr,
        exclude_bbox_day1=exclude_bbox,
    )

    if not align_res.success or aligned_bgr is None:
        vis = _render_approval_overlay(
            day_bgr,
            None,
            previous_approved_m2,
            net_area_m2,
            f"Alineacion baja ({align_res.num_inliers} inliers)",
        )
        cv2.imwrite(str(overlay_out_path), vis)
        return {
            "calculated_area_m2": previous_approved_m2,
            "delta_area_m2": 0.0,
            "alignment_inliers": align_res.num_inliers,
            "overlay_path": str(overlay_out_path),
            "vision_notes": f"Alineación no concluyente: {align_res.reason}. Requiere revisión en Oficina.",
        }

    roi_mask = np.full(ref_bgr.shape[:2], 255, dtype=np.uint8)
    if exclude_bbox and len(exclude_bbox) == 4:
        rx0, ry0, rx1, ry1 = exclude_bbox
        roi_mask[ry0:ry1, rx0:rx1] = 0

    segmenter = DiffThresholdSegmenter(lab_threshold=22.0)
    mask = segmenter.segment(ref_bgr, aligned_bgr, photo_path.stem, roi_mask=roi_mask)

    area_px = int(np.count_nonzero(mask))
    if cal_data and cal_data.get("pixels_per_m2"):
        raw_m2 = area_px / float(cal_data["pixels_per_m2"])
        scale_note = f"OpenCV ArUco ({align_res.num_inliers} inliers)"
    else:
        # Escala de respaldo proporcional al área neta del plano si Día 1 no tuvo regla ArUco
        total_valid_px = max(int(np.count_nonzero(roi_mask)), 1)
        raw_m2 = (area_px / total_valid_px) * net_area_m2
        scale_note = f"Escala relativa plano ({align_res.num_inliers} inliers)"

    capped_m2 = round(min(raw_m2, net_area_m2), 2)
    delta_m2 = round(max(0.0, capped_m2 - previous_approved_m2), 2)

    vis = _render_approval_overlay(aligned_bgr, mask, capped_m2, net_area_m2, scale_note)
    cv2.imwrite(str(overlay_out_path), vis)

    gemini_json = None
    if os.getenv("GEMINI_API_KEY"):
        try:
            from vision_lab.audit_gemini import run_gemini_audit

            audit = run_gemini_audit(
                prev_photo=day1_rectified_path,
                curr_photo=photo_path,
                net_area_m2=net_area_m2,
            )
            gemini_json = json.dumps(audit, ensure_ascii=False)
        except Exception:
            gemini_json = None

    return {
        "calculated_area_m2": capped_m2,
        "delta_area_m2": delta_m2,
        "alignment_inliers": align_res.num_inliers,
        "overlay_path": str(overlay_out_path),
        "vision_notes": f"{scale_note}. Error reproyección: {align_res.reprojection_error_px:.2f} px.",
        "gemini_audit_json": gemini_json,
    }
