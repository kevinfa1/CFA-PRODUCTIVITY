"""Generador de regla fotogramétrica ArUco imprimible a escala real 1:1.

Genera dos marcadores ArUco DICT_4X4_50 (IDs 0 y 1 por defecto) de 15.0 x 15.0 cm
a 300 DPI en formato PNG y un PDF multipágina (1 marcador por hoja Letter o A4)
listo para imprimir al 100% sin escalar y pegar en un listón rígido de 1.00 m
en papel mate.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Tuple

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

CM_PER_INCH = 2.54

PAGE_SIZES_CM = {
    "letter": (21.59, 27.94),
    "a4": (21.0, 29.7),
}


def cm_to_px(cm: float, dpi: int) -> int:
    return int(round((cm / CM_PER_INCH) * dpi))


def generate_aruco_marker_array(marker_id: int, size_px: int) -> np.ndarray:
    """Genera el arreglo grayscale de un marcador ArUco DICT_4X4_50."""
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    if hasattr(cv2.aruco, "generateImageMarker"):
        return cv2.aruco.generateImageMarker(aruco_dict, marker_id, size_px)
    return cv2.aruco.drawMarker(aruco_dict, marker_id, size_px)


def _load_font(size_px: int) -> ImageFont.ImageFont:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size_px)
    return ImageFont.load_default()


def render_marker_page(
    marker_id: int,
    label: str,
    marker_size_cm: float = 15.0,
    center_distance_cm: float = 80.0,
    page_size: str = "letter",
    dpi: int = 300,
) -> Image.Image:
    """Crea una hoja imprimible 1:1 con el marcador ArUco, guías de corte y barra de control."""
    if page_size not in PAGE_SIZES_CM:
        raise ValueError(f"Tamaño de hoja no soportado: {page_size}. Usa 'letter' o 'a4'.")

    page_w_cm, page_h_cm = PAGE_SIZES_CM[page_size]
    page_w_px = cm_to_px(page_w_cm, dpi)
    page_h_px = cm_to_px(page_h_cm, dpi)
    marker_px = cm_to_px(marker_size_cm, dpi)
    quiet_zone_px = cm_to_px(1.5, dpi)

    page = Image.new("RGB", (page_w_px, page_h_px), "white")
    draw = ImageDraw.Draw(page)

    font_title = _load_font(int(dpi * 0.22))
    font_body = _load_font(int(dpi * 0.14))
    font_small = _load_font(int(dpi * 0.11))

    # Centrar el marcador en la hoja
    x0 = (page_w_px - marker_px) // 2
    y0 = (page_h_px - marker_px) // 2
    x1 = x0 + marker_px
    y1 = y0 + marker_px

    # Dibujar marco de zona blanca (quiet zone) y guías de corte
    qx0, qy0 = x0 - quiet_zone_px, y0 - quiet_zone_px
    qx1, qy1 = x1 + quiet_zone_px, y1 + quiet_zone_px
    draw.rectangle([qx0, qy0, qx1, qy1], outline=(160, 160, 160), width=2)

    # Pegar el marcador ArUco exacto
    marker_arr = generate_aruco_marker_array(marker_id, marker_px)
    marker_img = Image.fromarray(marker_arr).convert("RGB")
    page.paste(marker_img, (x0, y0))

    # Cruz sutil en el borde exterior para alinear el centro exacto en la regla
    cx = (x0 + x1) // 2
    cy = (y0 + y1) // 2
    tick = cm_to_px(0.5, dpi)
    draw.line([(cx, qy0 - tick), (cx, qy0)], fill=(0, 0, 0), width=3)
    draw.line([(cx, qy1), (cx, qy1 + tick)], fill=(0, 0, 0), width=3)
    draw.line([(qx0 - tick, cy), (qx0, cy)], fill=(0, 0, 0), width=3)
    draw.line([(qx1, cy), (qx1 + tick, cy)], fill=(0, 0, 0), width=3)

    # Encabezado con instrucciones críticas
    margin_px = cm_to_px(1.5, dpi)
    draw.text(
        (margin_px, margin_px),
        f"CFA PRODUCTIVITY — REGLA FOTOGRAMÉTRICA ({label})",
        fill=(0, 0, 0),
        font=font_title,
    )
    draw.text(
        (margin_px, margin_px + int(dpi * 0.36)),
        f"DICT_4X4_50 | ID: {marker_id} | Lado negro exacto: {marker_size_cm:.1f} x {marker_size_cm:.1f} cm",
        fill=(30, 30, 30),
        font=font_body,
    )
    draw.text(
        (margin_px, margin_px + int(dpi * 0.62)),
        "IMPRIMIR AL 100% (ESCALA REAL, SIN AJUSTAR A PÁGINA) EN PAPEL MATE — NO PLASTIFICAR BRILLANTE",
        fill=(180, 0, 0),
        font=font_small,
    )

    # Pie de página con barra de verificación de 10.0 cm
    footer_y = qy1 + cm_to_px(1.0, dpi)
    bar_len_px = cm_to_px(10.0, dpi)
    bar_x0 = (page_w_px - bar_len_px) // 2
    draw.rectangle([bar_x0, footer_y, bar_x0 + bar_len_px, footer_y + cm_to_px(0.35, dpi)], fill=(0, 0, 0))
    draw.text(
        (bar_x0, footer_y + cm_to_px(0.48, dpi)),
        "Barra de verificación: debe medir exactamente 10.0 cm con cinta métrica",
        fill=(0, 0, 0),
        font=font_small,
    )
    draw.text(
        (margin_px, footer_y + cm_to_px(1.05, dpi)),
        f"Montaje en listón rígido de 1.00 m: pegar ID 0 a la izquierda e ID 1 a la derecha "
        f"con {center_distance_cm:.1f} cm exactos entre centros.",
        fill=(30, 30, 30),
        font=font_small,
    )

    return page


def generate_ruler_assets(
    output_dir: Path,
    left_id: int = 0,
    right_id: int = 1,
    marker_size_cm: float = 15.0,
    center_distance_cm: float = 80.0,
    page_size: str = "letter",
    dpi: int = 300,
) -> Tuple[Path, Path, Path]:
    """Genera los PNGs individuales y el PDF multipágina listo para imprimir."""
    output_dir.mkdir(parents=True, exist_ok=True)

    page_left = render_marker_page(
        marker_id=left_id,
        label="IZQUIERDA",
        marker_size_cm=marker_size_cm,
        center_distance_cm=center_distance_cm,
        page_size=page_size,
        dpi=dpi,
    )
    page_right = render_marker_page(
        marker_id=right_id,
        label="DERECHA",
        marker_size_cm=marker_size_cm,
        center_distance_cm=center_distance_cm,
        page_size=page_size,
        dpi=dpi,
    )

    left_png = output_dir / f"aruco_id{left_id}_left_{int(marker_size_cm)}cm.png"
    right_png = output_dir / f"aruco_id{right_id}_right_{int(marker_size_cm)}cm.png"
    pdf_path = output_dir / f"regla_aruco_{int(marker_size_cm)}cm_{page_size}_100pct.pdf"

    page_left.save(left_png, dpi=(dpi, dpi))
    page_right.save(right_png, dpi=(dpi, dpi))
    page_left.save(pdf_path, "PDF", resolution=float(dpi), save_all=True, append_images=[page_right])

    return left_png, right_png, pdf_path


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Genera marcadores ArUco DICT_4X4_50 imprimibles 1:1 para la regla de 1.00 m."
    )
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/ruler"), help="Carpeta de salida.")
    parser.add_argument("--left-id", type=int, default=0, help="ID del marcador izquierdo (default: 0).")
    parser.add_argument("--right-id", type=int, default=1, help="ID del marcador derecho (default: 1).")
    parser.add_argument("--marker-size-cm", type=float, default=15.0, help="Tamaño del lado negro en cm (default: 15.0).")
    parser.add_argument(
        "--center-distance-cm",
        type=float,
        default=80.0,
        help="Distancia centro-a-centro entre marcadores en cm (default: 80.0 para listón de 1.00 m).",
    )
    parser.add_argument("--page-size", choices=["letter", "a4"], default="letter", help="Tamaño de hoja (letter o a4).")
    parser.add_argument("--dpi", type=int, default=300, help="Resolución de impresión en DPI (default: 300).")
    args = parser.parse_args()

    left_png, right_png, pdf_path = generate_ruler_assets(
        output_dir=args.output_dir,
        left_id=args.left_id,
        right_id=args.right_id,
        marker_size_cm=args.marker_size_cm,
        center_distance_cm=args.center_distance_cm,
        page_size=args.page_size,
        dpi=args.dpi,
    )
    print("Regla ArUco generada correctamente:")
    print(f"  - PDF listo para imprimir (100% escala): {pdf_path}")
    print(f"  - PNG izquierdo (ID {args.left_id}): {left_png}")
    print(f"  - PNG derecho   (ID {args.right_id}): {right_png}")
    print(
        f"Recuerda verificar con cinta métrica que cada marcador mida {args.marker_size_cm:.1f} cm "
        f"y montarlos a {args.center_distance_cm:.1f} cm entre centros en papel mate."
    )


if __name__ == "__main__":
    main()
