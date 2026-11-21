"""Evaluador end-to-end del experimento de precisión métrica (Go / No-Go).

Toma:
- `wall_config.json`: datos del muro de prueba (foto Día 1, área neta en m²,
  parámetros de la regla ArUco y polígono ROI opcional).
- `ground_truth.csv`: listado de fotos de Días 2+ con su área real medida con
  cinta métrica (`measured_area_m2`) y etiqueta de condición (`normal` / `dificil`).

Genera:
- `outputs/.../calibration.json` y `day1_rectified.jpg`
- `outputs/.../overlays/<foto>_overlay.jpg` (foto alineada + máscara verde + métricas)
- `outputs/.../report.json` y `report.md` con veredicto automático GO / NO-GO
  contra H1 (≥ 90% alineación) y H2 (< 5% error promedio en condiciones normales).
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np

from vision_lab.calibrate_and_align import align_daily_photo, calibrate_day1
from vision_lab.segmenters import BaseSegmenter, build_segmenter


@dataclass
class PhotoEvaluation:
    photo_file: str
    day_label: str
    condition: str
    aligned: bool
    num_inliers: int
    inlier_ratio: float
    reprojection_error_px: float
    raw_calculated_m2: float
    capped_calculated_m2: float
    measured_area_m2: float
    abs_error_m2: Optional[float]
    pct_error_vs_measured: Optional[float]
    pct_error_vs_wall: Optional[float]
    notes: str = ""


def _build_roi_mask(
    shape_hw: tuple[int, int],
    roi_polygon_norm: Optional[list[list[float]]],
    exclude_bbox: Optional[list[int]] = None,
) -> np.ndarray:
    """Construye la máscara ROI del muro (255 = evaluar, 0 = ignorar)."""
    h, w = shape_hw
    if roi_polygon_norm and len(roi_polygon_norm) >= 3:
        mask = np.zeros((h, w), dtype=np.uint8)
        pts = np.array([[int(round(px * w)), int(round(py * h))] for px, py in roi_polygon_norm], dtype=np.int32)
        cv2.fillPoly(mask, [pts], 255)
    else:
        mask = np.full((h, w), 255, dtype=np.uint8)

    if exclude_bbox is not None and len(exclude_bbox) == 4:
        rx0, ry0, rx1, ry1 = exclude_bbox
        mask[ry0:ry1, rx0:rx1] = 0
    return mask


def _draw_overlay(
    aligned_bgr: np.ndarray,
    mask: np.ndarray,
    ev: PhotoEvaluation,
) -> np.ndarray:
    """Superpone la máscara semitransparente verde y un banner con métricas."""
    vis = aligned_bgr.copy()
    green_layer = np.zeros_like(vis)
    green_layer[:, :, 1] = 220

    mask_bool = mask > 0
    vis[mask_bool] = cv2.addWeighted(vis[mask_bool], 0.62, green_layer[mask_bool], 0.38, 0)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(vis, contours, -1, (0, 255, 0), 2)

    banner_h = 68
    cv2.rectangle(vis, (0, 0), (vis.shape[1], banner_h), (20, 20, 20), -1)
    err_str = f"{ev.pct_error_vs_measured:.2f}%" if ev.pct_error_vs_measured is not None else "N/A"
    line1 = (
        f"{ev.day_label} ({ev.condition}) | Calc: {ev.capped_calculated_m2:.2f} m2 | "
        f"Real: {ev.measured_area_m2:.2f} m2 | Error: {err_str}"
    )
    line2 = f"Inliers: {ev.num_inliers} ({ev.inlier_ratio * 100:.1f}%) | Reproj: {ev.reprojection_error_px:.2f} px"
    cv2.putText(vis, line1, (14, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, cv2.LINE_AA)
    cv2.putText(vis, line2, (14, 54), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (180, 240, 180), 1, cv2.LINE_AA)
    return vis


def run_evaluation(
    config_path: Path,
    ground_truth_csv: Path,
    output_dir: Path,
    segmenter: BaseSegmenter,
    photos_dir: Optional[Path] = None,
) -> dict:
    """Ejecuta el experimento completo y escribe report.json, report.md y overlays."""
    config = json.loads(config_path.read_text(encoding="utf-8"))
    base_dir = photos_dir if photos_dir is not None else config_path.parent

    day1_path = (base_dir / config["day1_photo"]).resolve()
    day1_bgr = cv2.imread(str(day1_path))
    if day1_bgr is None:
        raise FileNotFoundError(f"No se pudo leer la foto del Día 1: {day1_path}")

    ruler_cfg = config.get("aruco_ruler", {})
    rectified_day1, cal = calibrate_day1(
        day1_bgr=day1_bgr,
        left_id=int(ruler_cfg.get("left_id", 0)),
        right_id=int(ruler_cfg.get("right_id", 1)),
        marker_size_m=float(ruler_cfg.get("marker_size_m", 0.15)),
        center_distance_m=float(ruler_cfg.get("center_distance_m", 0.80)),
        pixels_per_meter=float(ruler_cfg.get("pixels_per_meter", 300.0)),
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    overlays_dir = output_dir / "overlays"
    overlays_dir.mkdir(parents=True, exist_ok=True)

    cv2.imwrite(str(output_dir / "day1_rectified.jpg"), rectified_day1)
    (output_dir / "calibration.json").write_text(json.dumps(asdict(cal), indent=2), encoding="utf-8")

    net_wall_area_m2 = float(config["net_wall_area_m2"])
    exclude_ruler_in_seg = bool(config.get("exclude_ruler_in_segmentation", True))
    roi_mask = _build_roi_mask(
        shape_hw=rectified_day1.shape[:2],
        roi_polygon_norm=config.get("roi_polygon_norm"),
        exclude_bbox=cal.ruler_bbox_rectified if exclude_ruler_in_seg else None,
    )

    evaluations: List[PhotoEvaluation] = []
    with ground_truth_csv.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            photo_rel = row["photo_file"].strip()
            day_label = row.get("day_label", Path(photo_rel).stem).strip()
            condition = row.get("condition", "normal").strip().lower()
            measured_m2 = float(row["measured_area_m2"])
            notes = row.get("notes", "").strip()

            photo_path = (base_dir / photo_rel).resolve()
            day_bgr = cv2.imread(str(photo_path))
            if day_bgr is None:
                evaluations.append(
                    PhotoEvaluation(
                        photo_file=photo_rel,
                        day_label=day_label,
                        condition=condition,
                        aligned=False,
                        num_inliers=0,
                        inlier_ratio=0.0,
                        reprojection_error_px=float("inf"),
                        raw_calculated_m2=0.0,
                        capped_calculated_m2=0.0,
                        measured_area_m2=measured_m2,
                        abs_error_m2=None,
                        pct_error_vs_measured=None,
                        pct_error_vs_wall=None,
                        notes=f"Archivo no encontrado: {photo_rel}",
                    )
                )
                continue

            aligned_bgr, align_res = align_daily_photo(
                day_bgr=day_bgr,
                day1_rectified_bgr=rectified_day1,
                exclude_bbox_day1=cal.ruler_bbox_rectified,
            )

            if not align_res.success or aligned_bgr is None:
                evaluations.append(
                    PhotoEvaluation(
                        photo_file=photo_rel,
                        day_label=day_label,
                        condition=condition,
                        aligned=False,
                        num_inliers=align_res.num_inliers,
                        inlier_ratio=align_res.inlier_ratio,
                        reprojection_error_px=align_res.reprojection_error_px,
                        raw_calculated_m2=0.0,
                        capped_calculated_m2=0.0,
                        measured_area_m2=measured_m2,
                        abs_error_m2=None,
                        pct_error_vs_measured=None,
                        pct_error_vs_wall=None,
                        notes=align_res.reason,
                    )
                )
                continue

            mask = segmenter.segment(
                day1_rectified_bgr=rectified_day1,
                day_n_aligned_bgr=aligned_bgr,
                photo_id=Path(photo_rel).stem,
                roi_mask=roi_mask,
            )
            area_px = int(np.count_nonzero(mask))
            raw_m2 = area_px / cal.pixels_per_m2
            # Validación dura contra el área neta máxima del plano para bloquear alucinaciones
            capped_m2 = min(raw_m2, net_wall_area_m2)

            abs_err = abs(capped_m2 - measured_m2)
            pct_err_measured = (abs_err / measured_m2 * 100.0) if measured_m2 > 0 else (0.0 if capped_m2 == 0 else 100.0)
            pct_err_wall = (abs_err / net_wall_area_m2 * 100.0) if net_wall_area_m2 > 0 else None

            ev = PhotoEvaluation(
                photo_file=photo_rel,
                day_label=day_label,
                condition=condition,
                aligned=True,
                num_inliers=align_res.num_inliers,
                inlier_ratio=align_res.inlier_ratio,
                reprojection_error_px=align_res.reprojection_error_px,
                raw_calculated_m2=raw_m2,
                capped_calculated_m2=capped_m2,
                measured_area_m2=measured_m2,
                abs_error_m2=abs_err,
                pct_error_vs_measured=pct_err_measured,
                pct_error_vs_wall=pct_err_wall,
                notes=notes,
            )
            evaluations.append(ev)

            overlay = _draw_overlay(aligned_bgr, mask, ev)
            cv2.imwrite(str(overlays_dir / f"{Path(photo_rel).stem}_overlay.jpg"), overlay)

    total = len(evaluations)
    aligned_evals = [e for e in evaluations if e.aligned]
    alignment_rate_pct = (len(aligned_evals) / total * 100.0) if total > 0 else 0.0

    normal_errs = [
        e.pct_error_vs_measured
        for e in aligned_evals
        if e.condition == "normal" and e.pct_error_vs_measured is not None
    ]
    all_errs = [e.pct_error_vs_measured for e in aligned_evals if e.pct_error_vs_measured is not None]

    mean_err_normal = float(np.mean(normal_errs)) if normal_errs else None
    mean_err_all = float(np.mean(all_errs)) if all_errs else None

    h1_pass = alignment_rate_pct >= 90.0
    h2_ref_err = mean_err_normal if mean_err_normal is not None else mean_err_all
    h2_pass = (h2_ref_err is not None) and (h2_ref_err < 5.0)
    verdict = "GO" if (h1_pass and h2_pass) else "NO-GO"

    report = {
        "wall_name": config.get("wall_name", "Muro piloto"),
        "trade": config.get("trade", "mamposteria"),
        "net_wall_area_m2": net_wall_area_m2,
        "calibration": asdict(cal),
        "summary": {
            "total_photos": total,
            "aligned_photos": len(aligned_evals),
            "alignment_rate_pct": round(alignment_rate_pct, 2),
            "mean_pct_error_normal": round(mean_err_normal, 2) if mean_err_normal is not None else None,
            "mean_pct_error_all": round(mean_err_all, 2) if mean_err_all is not None else None,
            "h1_alignment_pass_ge_90pct": h1_pass,
            "h2_precision_pass_lt_5pct": h2_pass,
            "verdict": verdict,
        },
        "photos": [asdict(e) for e in evaluations],
    }

    (output_dir / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    _write_markdown_report(output_dir / "report.md", report)
    return report


def _write_markdown_report(md_path: Path, report: dict) -> None:
    s = report["summary"]
    cal = report["calibration"]
    lines = [
        f"# Reporte de Validación Métrica — {report['wall_name']}",
        "",
        f"- **Partida:** {report['trade']}",
        f"- **Área neta del muro:** {report['net_wall_area_m2']:.2f} m²",
        f"- **Escala Día 1:** {cal['pixels_per_meter']:.2f} px/m ({cal['pixels_per_m2']:.0f} px²/m²) | Error reproyección ArUco: {cal['reprojection_error_mm']:.2f} mm",
        "",
        f"## Veredicto: **{s['verdict']}**",
        "",
        "| Hipótesis | Meta | Resultado | Estado |",
        "|---|---|---|---|",
        f"| **H1** Alineación sin regla (Días 2+) | ≥ 90.0% | {s['alignment_rate_pct']:.2f}% ({s['aligned_photos']}/{s['total_photos']}) | {'PASS' if s['h1_alignment_pass_ge_90pct'] else 'FAIL'} |",
        f"| **H2** Error medio área (condición normal) | < 5.0% | {s['mean_pct_error_normal'] if s['mean_pct_error_normal'] is not None else 'N/A'}% | {'PASS' if s['h2_precision_pass_lt_5pct'] else 'FAIL'} |",
        "",
        "## Detalle por foto",
        "",
        "| Foto | Día | Condición | Alineada | Inliers | Calculado (m²) | Cinta (m²) | Error (%) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for p in report["photos"]:
        err = f"{p['pct_error_vs_measured']:.2f}%" if p["pct_error_vs_measured"] is not None else "N/A"
        lines.append(
            f"| {p['photo_file']} | {p['day_label']} | {p['condition']} | "
            f"{'Sí' if p['aligned'] else 'No'} | {p['num_inliers']} | "
            f"{p['capped_calculated_m2']:.2f} | {p['measured_area_m2']:.2f} | {err} |"
        )
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ejecuta el experimento de precisión (OpenCV + segmentación vs cinta métrica)."
    )
    parser.add_argument("--config", type=Path, required=True, help="Archivo wall_config.json del muro.")
    parser.add_argument("--ground-truth", type=Path, required=True, help="CSV con mediciones reales con cinta métrica.")
    parser.add_argument("--photos-dir", type=Path, default=None, help="Carpeta base de fotos (default: carpeta del config).")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/experiment"), help="Carpeta de resultados.")
    parser.add_argument(
        "--segmenter",
        choices=["diff", "mask_dir", "sam2"],
        default="diff",
        help="Backend de segmentación (default: diff).",
    )
    parser.add_argument("--masks-dir", type=Path, default=None, help="Carpeta de máscaras PNG si --segmenter mask_dir.")
    parser.add_argument("--lab-threshold", type=float, default=22.0, help="Umbral CIELAB para --segmenter diff.")
    args = parser.parse_args()

    segmenter = build_segmenter(
        name=args.segmenter,
        masks_dir=args.masks_dir,
        lab_threshold=args.lab_threshold,
    )
    report = run_evaluation(
        config_path=args.config,
        ground_truth_csv=args.ground_truth,
        output_dir=args.output_dir,
        segmenter=segmenter,
        photos_dir=args.photos_dir,
    )

    s = report["summary"]
    print(f"\n=== RESULTADO EXPERIMENTO: {s['verdict']} ===")
    print(f"Alineación (H1): {s['alignment_rate_pct']:.2f}% ({s['aligned_photos']}/{s['total_photos']})")
    print(f"Error medio normal (H2): {s['mean_pct_error_normal']}%")
    print(f"Reporte guardado en: {args.output_dir / 'report.md'}")


if __name__ == "__main__":
    main()
