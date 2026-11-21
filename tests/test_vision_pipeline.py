"""Pruebas automatizadas end-to-end del Kit de Validación Métrica.

Simula un muro real de 4.0 m x 2.5 m con columnas, vigas y textura estructural:
- Día 1: foto con perspectiva de mano alzada y regla ArUco de 1.00 m (IDs 0 y 1).
- Días 2 y 3: fotos sin regla con distinta perspectiva y avance conocido en m².
Verifica:
1. Generación de activos imprimibles de la regla (PNG + PDF).
2. Calibración Día 1 con ArUco y error de reproyección < 3 mm.
3. Alineación sin regla Días 2+ con OpenCV (100% alineadas).
4. Cálculo determinista de área con error < 5% y veredicto GO.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

import cv2
import numpy as np

from vision_lab.evaluate_progress import run_evaluation
from vision_lab.generate_ruler import generate_aruco_marker_array, generate_ruler_assets
from vision_lab.segmenters import DiffThresholdSegmenter

PPM_SYNTH = 250  # 250 px/m -> muro de 4.0 m x 2.5 m = 1000 x 625 px


def _build_base_wall() -> np.ndarray:
    """Crea una pared sintética texturizada con columnas, vigas y ladrillo."""
    rng = np.random.default_rng(42)
    h, w = int(2.5 * PPM_SYNTH), int(4.0 * PPM_SYNTH)
    wall = rng.integers(105, 145, size=(h, w, 3), dtype=np.uint8)
    # Tono ladrillo / concreto crudo
    wall[:, :, 0] = np.clip(wall[:, :, 0].astype(np.int16) - 20, 0, 255).astype(np.uint8)
    wall[:, :, 2] = np.clip(wall[:, :, 2].astype(np.int16) + 25, 0, 255).astype(np.uint8)

    # Juntas horizontales y verticales tipo mampostería para textura rica
    for y in range(0, h, 28):
        cv2.line(wall, (0, y), (w, y), (75, 75, 80), 2)
    for row_idx, y in enumerate(range(0, h, 28)):
        offset = 35 if row_idx % 2 == 0 else 0
        for x in range(offset, w, 70):
            cv2.line(wall, (x, y), (x, min(h, y + 28)), (75, 75, 80), 2)

    # Columnas laterales y viga superior con patrones estructurales fijos
    cv2.rectangle(wall, (0, 0), (110, h), (165, 165, 160), -1)
    cv2.rectangle(wall, (w - 110, 0), (w, h), (165, 165, 160), -1)
    cv2.rectangle(wall, (0, 0), (w, 85), (155, 155, 150), -1)
    cv2.rectangle(wall, (0, h - 75), (w, h), (150, 150, 145), -1)

    # Detalles estructurales fijos (cajas eléctricas, juntas, marcas de encofrado)
    for x in (35, w - 75):
        for y in range(110, h - 100, 95):
            cv2.rectangle(wall, (x, y), (x + 40, y + 40), (60, 60, 65), 2)
            cv2.circle(wall, (x + 20, y + 20), 8, (40, 40, 45), -1)
    for x in range(140, w - 140, 130):
        cv2.rectangle(wall, (x, 20), (x + 55, 65), (70, 70, 75), 2)
        cv2.line(wall, (x, 20), (x + 55, 65), (70, 70, 75), 2)
        cv2.rectangle(wall, (x, h - 60), (x + 55, h - 18), (65, 65, 70), 2)

    return wall


def _place_aruco_ruler(wall: np.ndarray) -> np.ndarray:
    """Coloca una regla rígida de 1.00 m con ArUco ID 0 y ID 1 (0.15 m, 0.80 m entre centros)."""
    out = wall.copy()
    marker_px = int(round(0.15 * PPM_SYNTH))  # 38 px (usaremos 0.15m exacto -> 37.5 -> usamos 200/400 ppm)
    center_dist_px = int(round(0.80 * PPM_SYNTH))

    cy = out.shape[0] - 160
    cx_left = 340
    cx_right = cx_left + center_dist_px

    # Listón blanco mate de 1.00 m detrás de los marcadores
    bar_x0 = cx_left - int(round(0.10 * PPM_SYNTH))
    bar_x1 = cx_right + int(round(0.10 * PPM_SYNTH))
    bar_y0 = cy - int(round(0.10 * PPM_SYNTH))
    bar_y1 = cy + int(round(0.10 * PPM_SYNTH))
    cv2.rectangle(out, (bar_x0, bar_y0), (bar_x1, bar_y1), (245, 245, 245), -1)

    for marker_id, cx in ((0, cx_left), (1, cx_right)):
        m = generate_aruco_marker_array(marker_id, marker_px)
        m_bgr = cv2.cvtColor(m, cv2.COLOR_GRAY2BGR)
        x0 = cx - marker_px // 2
        y0 = cy - marker_px // 2
        out[y0 : y0 + marker_px, x0 : x0 + marker_px] = m_bgr

    return out


def _apply_handheld_perspective(img: np.ndarray, shift: tuple[float, float, float, float]) -> np.ndarray:
    """Simula una toma a mano alzada con ligera perspectiva sobre un lienzo más amplio."""
    h, w = img.shape[:2]
    pad = 80
    out_w, out_h = w + 2 * pad, h + 2 * pad
    src = np.float32([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]])
    s0, s1, s2, s3 = shift
    dst = np.float32(
        [
            [pad + s0, pad + s1],
            [pad + w - 1 - s2, pad + s3],
            [pad + w - 1 - s0 * 0.5, pad + h - 1 - s1 * 0.5],
            [pad + s2 * 0.6, pad + h - 1 - s3 * 0.6],
        ]
    )
    h_mat = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, h_mat, (out_w, out_h), borderValue=(30, 30, 30))


def test_generate_ruler_assets(tmp_path: Path) -> None:
    left_png, right_png, pdf_path = generate_ruler_assets(tmp_path / "ruler", dpi=150)
    assert left_png.exists() and left_png.stat().st_size > 1000
    assert right_png.exists() and right_png.stat().st_size > 1000
    assert pdf_path.exists() and pdf_path.stat().st_size > 1000


def test_end_to_end_metric_validation_go_verdict(tmp_path: Path) -> None:
    # Usamos 200 px/m para que 0.15 m = 30 px exactos y 0.80 m = 160 px exactos
    global PPM_SYNTH
    PPM_SYNTH = 200

    base_wall = _build_base_wall()
    day1_raw = _place_aruco_ruler(base_wall)
    day1_photo = _apply_handheld_perspective(day1_raw, (18.0, 12.0, 10.0, 22.0))

    # Día 2: avance real de 1.50 m x 0.80 m = 1.20 m² (repello/pintura clara en zona superior-central)
    day2_wall = base_wall.copy()
    x0, y0 = 160, 105
    w2_px, h2_px = int(1.50 * PPM_SYNTH), int(0.80 * PPM_SYNTH)
    day2_wall[y0 : y0 + h2_px, x0 : x0 + w2_px] = (232, 232, 228)
    day2_photo = _apply_handheld_perspective(day2_wall, (8.0, 24.0, 22.0, 10.0))

    # Día 3: avance acumulado de 2.50 m x 0.90 m = 2.25 m²
    day3_wall = base_wall.copy()
    w3_px, h3_px = int(2.50 * PPM_SYNTH), int(0.90 * PPM_SYNTH)
    day3_wall[y0 : y0 + h3_px, x0 : x0 + w3_px] = (232, 232, 228)
    day3_photo = _apply_handheld_perspective(day3_wall, (25.0, 10.0, 14.0, 18.0))

    data_dir = tmp_path / "site_data"
    data_dir.mkdir()
    cv2.imwrite(str(data_dir / "day1.png"), day1_photo)
    cv2.imwrite(str(data_dir / "day2.png"), day2_photo)
    cv2.imwrite(str(data_dir / "day3.png"), day3_photo)

    config_path = data_dir / "wall_config.json"
    config_path.write_text(
        json.dumps(
            {
                "wall_name": "Muro Sintetico Test",
                "trade": "repello",
                "net_wall_area_m2": 10.0,
                "day1_photo": "day1.png",
                "exclude_ruler_in_segmentation": True,
                "aruco_ruler": {
                    "left_id": 0,
                    "right_id": 1,
                    "marker_size_m": 0.15,
                    "center_distance_m": 0.80,
                    "pixels_per_meter": 200.0,
                },
            }
        ),
        encoding="utf-8",
    )

    gt_csv = data_dir / "ground_truth.csv"
    with gt_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["photo_file", "day_label", "condition", "measured_area_m2", "notes"])
        writer.writerow(["day2.png", "Dia 2", "normal", "1.20", "Avance parcial"])
        writer.writerow(["day3.png", "Dia 3", "normal", "2.25", "Avance acumulado"])

    out_dir = tmp_path / "outputs"
    report = run_evaluation(
        config_path=config_path,
        ground_truth_csv=gt_csv,
        output_dir=out_dir,
        segmenter=DiffThresholdSegmenter(lab_threshold=22.0),
    )

    summary = report["summary"]
    assert report["calibration"]["reprojection_error_mm"] < 3.0
    assert summary["alignment_rate_pct"] == 100.0
    assert summary["mean_pct_error_normal"] < 5.0
    assert summary["verdict"] == "GO"
    assert (out_dir / "report.md").exists()
    assert (out_dir / "overlays" / "day2_overlay.jpg").exists()
    assert (out_dir / "overlays" / "day3_overlay.jpg").exists()
