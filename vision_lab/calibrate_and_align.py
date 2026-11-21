"""Calibración métrica Día 1 (ArUco) y alineación sin regla Días 2+ (OpenCV).

Flujo geométrico determinista:
1. Día 1: Detecta los 2 marcadores ArUco DICT_4X4_50 (ej. ID 0 y ID 1) montados
   en la regla rígida de 1.00 m apoyada contra el muro. Resuelve la homografía
   del plano del muro con los 8 vértices conocidos en metros y rectifica la foto
   a una escala fija y exacta (pixels_per_meter).
2. Días 2+: Detecta rasgos estructurales fijos (SIFT/AKAZE) en la foto nueva
   sin regla, excluyendo la zona donde estuvo la regla el Día 1, y la alinea por
   homografía robusta (USAC_MAGSAC / RANSAC) directamente sobre la referencia
   rectificada del Día 1.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple

import cv2
import numpy as np


@dataclass
class Day1CalibrationResult:
    """Resultado de calibración métrica del Día 1."""

    pixels_per_meter: float
    pixels_per_m2: float
    rectified_width: int
    rectified_height: int
    homography_day1_to_rectified: list[list[float]]
    ruler_bbox_rectified: list[int]  # [x0, y0, x1, y1] para excluirla en Días 2+
    detected_ids: list[int]
    reprojection_error_mm: float
    scale_crosscheck_error_pct: float


@dataclass
class AlignmentResult:
    """Resultado de alineación por homografía de una foto de Día 2+."""

    success: bool
    num_matches: int
    num_inliers: int
    inlier_ratio: float
    reprojection_error_px: float
    homography: Optional[list[list[float]]]
    reason: str = ""


def detect_aruco_markers(image_bgr: np.ndarray) -> Dict[int, np.ndarray]:
    """Detecta marcadores DICT_4X4_50 y devuelve {marker_id: corners_4x2}."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)

    if hasattr(cv2.aruco, "ArucoDetector"):
        params = cv2.aruco.DetectorParameters()
        params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_SUBPIX
        detector = cv2.aruco.ArucoDetector(aruco_dict, params)
        corners_list, ids, _ = detector.detectMarkers(gray)
    else:
        params = cv2.aruco.DetectorParameters_create()
        corners_list, ids, _ = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=params)

    detected: Dict[int, np.ndarray] = {}
    if ids is None:
        return detected

    for marker_corners, marker_id in zip(corners_list, ids.flatten()):
        detected[int(marker_id)] = marker_corners.reshape(4, 2).astype(np.float64)
    return detected


def _marker_world_corners_m(center_x: float, center_y: float, marker_size_m: float) -> np.ndarray:
    """Devuelve las 4 esquinas en metros en orden estándar ArUco (TL, TR, BR, BL)."""
    half = marker_size_m / 2.0
    return np.array(
        [
            [center_x - half, center_y - half],
            [center_x + half, center_y - half],
            [center_x + half, center_y + half],
            [center_x - half, center_y + half],
        ],
        dtype=np.float64,
    )


def calibrate_day1(
    day1_bgr: np.ndarray,
    left_id: int = 0,
    right_id: int = 1,
    marker_size_m: float = 0.15,
    center_distance_m: float = 0.80,
    pixels_per_meter: float = 300.0,
    max_rectified_dim: int = 3200,
) -> Tuple[np.ndarray, Day1CalibrationResult]:
    """Calibra escala métrica y rectifica la foto del Día 1 usando los 2 marcadores ArUco."""
    detected = detect_aruco_markers(day1_bgr)
    if left_id not in detected or right_id not in detected:
        found = sorted(detected.keys())
        raise ValueError(
            f"No se detectaron ambos marcadores ArUco requeridos ({left_id}, {right_id}). "
            f"Detectados: {found}. Verifica nitidez, luz y que el papel sea mate."
        )

    src_pts = np.vstack([detected[left_id], detected[right_id]])
    world_pts_m = np.vstack(
        [
            _marker_world_corners_m(0.0, 0.0, marker_size_m),
            _marker_world_corners_m(center_distance_m, 0.0, marker_size_m),
        ]
    )

    # Homografía desde píxeles de imagen Día 1 -> metros del plano del muro
    h_img_to_m, _ = cv2.findHomography(src_pts, world_pts_m, method=0)
    if h_img_to_m is None:
        raise RuntimeError("No se pudo calcular la homografía con los marcadores ArUco.")

    # Error de reproyección de los 8 vértices en milímetros
    projected_m = cv2.perspectiveTransform(src_pts.reshape(-1, 1, 2), h_img_to_m).reshape(-1, 2)
    reproj_err_mm = float(np.mean(np.linalg.norm(projected_m - world_pts_m, axis=1)) * 1000.0)

    # Verificación cruzada: distancia medida entre centros vs lados promedio
    c_left_m = np.mean(projected_m[:4], axis=0)
    c_right_m = np.mean(projected_m[4:], axis=0)
    measured_dist_m = float(np.linalg.norm(c_right_m - c_left_m))
    scale_crosscheck_err_pct = abs(measured_dist_m - center_distance_m) / center_distance_m * 100.0

    # Proyectar las 4 esquinas de la foto completa para calcular el lienzo rectificado
    h_img, w_img = day1_bgr.shape[:2]
    img_corners = np.array(
        [[[0.0, 0.0]], [[w_img - 1.0, 0.0]], [[w_img - 1.0, h_img - 1.0]], [[0.0, h_img - 1.0]]],
        dtype=np.float64,
    )
    warped_corners_m = cv2.perspectiveTransform(img_corners, h_img_to_m).reshape(-1, 2)

    min_x, min_y = np.min(warped_corners_m, axis=0)
    max_x, max_y = np.max(warped_corners_m, axis=0)

    span_w_m = max(max_x - min_x, 0.1)
    span_h_m = max(max_y - min_y, 0.1)

    # Ajustar pixels_per_meter si el lienzo excede max_rectified_dim para evitar OOM
    effective_ppm = float(pixels_per_meter)
    est_w = span_w_m * effective_ppm
    est_h = span_h_m * effective_ppm
    if max(est_w, est_h) > max_rectified_dim:
        scale_down = max_rectified_dim / max(est_w, est_h)
        effective_ppm *= scale_down

    out_w = max(int(round(span_w_m * effective_ppm)), 64)
    out_h = max(int(round(span_h_m * effective_ppm)), 64)

    # Matriz de traslado y escala: metros -> píxeles del lienzo rectificado
    t_scale = np.array(
        [
            [effective_ppm, 0.0, -min_x * effective_ppm],
            [0.0, effective_ppm, -min_y * effective_ppm],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )
    h_day1_to_rect = t_scale @ h_img_to_m

    rectified = cv2.warpPerspective(
        day1_bgr,
        h_day1_to_rect,
        (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )

    # Bounding box de la regla en el lienzo rectificado (+ margen de 5 cm) para excluirla en Días 2+
    ruler_pts_rect = cv2.perspectiveTransform(src_pts.reshape(-1, 1, 2), h_day1_to_rect).reshape(-1, 2)
    pad_px = int(round(0.06 * effective_ppm))
    rx0 = max(0, int(np.floor(np.min(ruler_pts_rect[:, 0]))) - pad_px)
    ry0 = max(0, int(np.floor(np.min(ruler_pts_rect[:, 1]))) - pad_px)
    rx1 = min(out_w, int(np.ceil(np.max(ruler_pts_rect[:, 0]))) + pad_px)
    ry1 = min(out_h, int(np.ceil(np.max(ruler_pts_rect[:, 1]))) + pad_px)

    result = Day1CalibrationResult(
        pixels_per_meter=effective_ppm,
        pixels_per_m2=effective_ppm * effective_ppm,
        rectified_width=out_w,
        rectified_height=out_h,
        homography_day1_to_rectified=h_day1_to_rect.tolist(),
        ruler_bbox_rectified=[rx0, ry0, rx1, ry1],
        detected_ids=[left_id, right_id],
        reprojection_error_mm=reproj_err_mm,
        scale_crosscheck_error_pct=scale_crosscheck_err_pct,
    )
    return rectified, result


def _create_feature_detector() -> Tuple[cv2.Feature2D, int]:
    """Crea SIFT si está disponible; si no, recurre a AKAZE."""
    if hasattr(cv2, "SIFT_create"):
        return cv2.SIFT_create(nfeatures=4000), cv2.NORM_L2
    return cv2.AKAZE_create(), cv2.NORM_HAMMING


def align_daily_photo(
    day_bgr: np.ndarray,
    day1_rectified_bgr: np.ndarray,
    exclude_bbox_day1: Optional[list[int]] = None,
    ratio_thresh: float = 0.75,
    ransac_reproj_thresh: float = 4.0,
    min_inliers: int = 20,
) -> Tuple[Optional[np.ndarray], AlignmentResult]:
    """Alinea una foto de Día 2+ (sin regla) sobre la foto rectificada del Día 1."""
    ref_gray = cv2.cvtColor(day1_rectified_bgr, cv2.COLOR_BGR2GRAY)
    cur_gray = cv2.cvtColor(day_bgr, cv2.COLOR_BGR2GRAY)

    # Máscara sobre la referencia del Día 1: ignorar bordes negros y la zona donde estuvo la regla
    ref_mask = (ref_gray > 5).astype(np.uint8) * 255
    if exclude_bbox_day1 is not None and len(exclude_bbox_day1) == 4:
        rx0, ry0, rx1, ry1 = exclude_bbox_day1
        ref_mask[ry0:ry1, rx0:rx1] = 0

    detector, norm_type = _create_feature_detector()
    kp_ref, des_ref = detector.detectAndCompute(ref_gray, ref_mask)
    kp_cur, des_cur = detector.detectAndCompute(cur_gray, None)

    if des_ref is None or des_cur is None or len(kp_ref) < min_inliers or len(kp_cur) < min_inliers:
        return None, AlignmentResult(
            success=False,
            num_matches=0,
            num_inliers=0,
            inlier_ratio=0.0,
            reprojection_error_px=float("inf"),
            homography=None,
            reason="Insuficientes rasgos estructurales detectados.",
        )

    matcher = cv2.BFMatcher(norm_type)
    raw_matches = matcher.knnMatch(des_cur, des_ref, k=2)

    good_matches = []
    for pair in raw_matches:
        if len(pair) == 2 and pair[0].distance < ratio_thresh * pair[1].distance:
            good_matches.append(pair[0])

    if len(good_matches) < min_inliers:
        return None, AlignmentResult(
            success=False,
            num_matches=len(good_matches),
            num_inliers=0,
            inlier_ratio=0.0,
            reprojection_error_px=float("inf"),
            homography=None,
            reason=f"Muy pocas correspondencias válidas ({len(good_matches)} < {min_inliers}).",
        )

    src_pts = np.float32([kp_cur[m.queryIdx].pt for m in good_matches]).reshape(-1, 1, 2)
    dst_pts = np.float32([kp_ref[m.trainIdx].pt for m in good_matches]).reshape(-1, 1, 2)

    method = getattr(cv2, "USAC_MAGSAC", cv2.RANSAC)
    h_cur_to_ref, inliers_mask = cv2.findHomography(src_pts, dst_pts, method, ransac_reproj_thresh)

    if h_cur_to_ref is None or inliers_mask is None:
        return None, AlignmentResult(
            success=False,
            num_matches=len(good_matches),
            num_inliers=0,
            inlier_ratio=0.0,
            reprojection_error_px=float("inf"),
            homography=None,
            reason="No se pudo estimar homografía robusta.",
        )

    inliers_bool = inliers_mask.ravel().astype(bool)
    num_inliers = int(np.sum(inliers_bool))
    inlier_ratio = num_inliers / max(len(good_matches), 1)

    if num_inliers < min_inliers:
        return None, AlignmentResult(
            success=False,
            num_matches=len(good_matches),
            num_inliers=num_inliers,
            inlier_ratio=inlier_ratio,
            reprojection_error_px=float("inf"),
            homography=None,
            reason=f"Pocos inliers tras RANSAC ({num_inliers} < {min_inliers}).",
        )

    projected = cv2.perspectiveTransform(src_pts[inliers_bool], h_cur_to_ref)
    reproj_err_px = float(np.mean(np.linalg.norm(projected - dst_pts[inliers_bool], axis=2)))

    out_h, out_w = day1_rectified_bgr.shape[:2]
    aligned = cv2.warpPerspective(
        day_bgr,
        h_cur_to_ref,
        (out_w, out_h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )

    return aligned, AlignmentResult(
        success=True,
        num_matches=len(good_matches),
        num_inliers=num_inliers,
        inlier_ratio=inlier_ratio,
        reprojection_error_px=reproj_err_px,
        homography=h_cur_to_ref.tolist(),
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prueba individual de calibración Día 1 (ArUco) y alineación Día 2+ (OpenCV)."
    )
    parser.add_argument("--day1", type=Path, required=True, help="Foto del Día 1 con la regla ArUco.")
    parser.add_argument("--day-n", type=Path, help="Foto opcional del Día 2+ (sin regla) para alinear.")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/align_check"), help="Carpeta de salida.")
    parser.add_argument("--marker-size-m", type=float, default=0.15, help="Lado del marcador en metros (default: 0.15).")
    parser.add_argument(
        "--center-distance-m",
        type=float,
        default=0.80,
        help="Distancia centro-a-centro entre marcadores en metros (default: 0.80).",
    )
    parser.add_argument("--ppm", type=float, default=300.0, help="Escala objetivo en píxeles/metro (default: 300).")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    day1_bgr = cv2.imread(str(args.day1))
    if day1_bgr is None:
        raise FileNotFoundError(f"No se pudo leer la imagen Día 1: {args.day1}")

    rectified, cal = calibrate_day1(
        day1_bgr=day1_bgr,
        marker_size_m=args.marker_size_m,
        center_distance_m=args.center_distance_m,
        pixels_per_meter=args.ppm,
    )
    cv2.imwrite(str(args.output_dir / "day1_rectified.jpg"), rectified)
    (args.output_dir / "calibration.json").write_text(json.dumps(asdict(cal), indent=2), encoding="utf-8")

    print(
        f"[Día 1] Calibrado OK | escala={cal.pixels_per_meter:.2f} px/m "
        f"({cal.pixels_per_m2:.0f} px²/m²) | error reproyección={cal.reprojection_error_mm:.2f} mm"
    )

    if args.day_n is not None:
        day_n_bgr = cv2.imread(str(args.day_n))
        if day_n_bgr is None:
            raise FileNotFoundError(f"No se pudo leer la imagen Día N: {args.day_n}")
        aligned, align_res = align_daily_photo(
            day_bgr=day_n_bgr,
            day1_rectified_bgr=rectified,
            exclude_bbox_day1=cal.ruler_bbox_rectified,
        )
        print(
            f"[Día N] success={align_res.success} | matches={align_res.num_matches} | "
            f"inliers={align_res.num_inliers} ({align_res.inlier_ratio * 100:.1f}%) | "
            f"reproj={align_res.reprojection_error_px:.2f} px"
        )
        if aligned is not None:
            cv2.imwrite(str(args.output_dir / f"{args.day_n.stem}_aligned.jpg"), aligned)
            blend = cv2.addWeighted(rectified, 0.5, aligned, 0.5, 0)
            cv2.imwrite(str(args.output_dir / f"{args.day_n.stem}_blend_check.jpg"), blend)


if __name__ == "__main__":
    main()
