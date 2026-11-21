"""Importador de planos 2D (.dxf) a mapa SVG interactivo + catálogo de muros."""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import ezdxf


def import_dxf_to_svg_and_elements(
    dxf_path: Path,
    default_wall_height_m: float = 2.60,
    min_segment_length_m: float = 0.60,
) -> tuple[str, list[dict[str, Any]]]:
    """Lee entidades LINE/LWPOLYLINE de un .dxf y devuelve (svg_str, lista_muros)."""
    doc = ezdxf.readfile(str(dxf_path))
    msp = doc.modelspace()

    segments: list[tuple[float, float, float, float, str]] = []
    for entity in msp:
        etype = entity.dxftype()
        layer = getattr(entity.dxf, "layer", "0")
        if etype == "LINE":
            s = entity.dxf.start
            e = entity.dxf.end
            segments.append((float(s.x), float(s.y), float(e.x), float(e.y), layer))
        elif etype == "LWPOLYLINE":
            pts = list(entity.get_points("xy"))
            if entity.closed and len(pts) >= 2:
                pts.append(pts[0])
            for i in range(len(pts) - 1):
                segments.append((float(pts[i][0]), float(pts[i][1]), float(pts[i + 1][0]), float(pts[i + 1][1]), layer))

    if not segments:
        raise ValueError("El archivo DXF no contiene líneas o polilíneas legibles en modelspace.")

    xs = [p for seg in segments for p in (seg[0], seg[2])]
    ys = [p for seg in segments for p in (seg[1], seg[3])]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)

    span_x = max(max_x - min_x, 1.0)
    span_y = max(max_y - min_y, 1.0)

    # Normalizar coordenadas a un viewBox SVG limpio de 800 x 520 con margen
    vb_w, vb_h, pad = 800.0, 520.0, 40.0
    scale = min((vb_w - 2 * pad) / span_x, (vb_h - 2 * pad) / span_y)

    def to_svg(x: float, y: float) -> tuple[float, float]:
        sx = pad + (x - min_x) * scale
        sy = vb_h - pad - (y - min_y) * scale  # Invertir eje Y de CAD -> SVG
        return round(sx, 2), round(sy, 2)

    svg_lines: list[str] = [
        f'<svg viewBox="0 0 {int(vb_w)} {int(vb_h)}" xmlns="http://www.w3.org/2000/svg">',
        '  <rect width="100%" height="100%" fill="#0f172a" rx="12" />',
    ]

    extracted: list[dict[str, Any]] = []
    wall_idx = 0

    for x1, y1, x2, y2, layer in segments:
        length_m = math.hypot(x2 - x1, y2 - y1)
        sx1, sy1 = to_svg(x1, y1)
        sx2, sy2 = to_svg(x2, y2)

        if length_m < min_segment_length_m:
            svg_lines.append(
                f'  <line x1="{sx1}" y1="{sy1}" x2="{sx2}" y2="{sy2}" stroke="#334155" stroke-width="2" />'
            )
            continue

        wall_idx += 1
        svg_id = f"wall-dxf-{wall_idx:02d}"
        heading_deg = (math.degrees(math.atan2(y2 - y1, x2 - x1)) + 360.0) % 360.0
        area_m2 = round(length_m * default_wall_height_m, 2)

        svg_lines.append(
            f'  <line id="{svg_id}" data-wall-code="M-{wall_idx:02d}" '
            f'x1="{sx1}" y1="{sy1}" x2="{sx2}" y2="{sy2}" '
            f'stroke="#ef4444" stroke-width="8" stroke-linecap="round" />'
        )
        extracted.append(
            {
                "code": f"M-{wall_idx:02d}",
                "room_name": layer if layer != "0" else "Ambiente DXF",
                "wall_name": f"Muro {wall_idx:02d} ({length_m:.2f} m)",
                "svg_element_id": svg_id,
                "trade": "mamposteria",
                "gross_area_m2": area_m2,
                "openings_area_m2": 0.0,
                "net_area_m2": area_m2,
                "apu_target_m2_per_hh": 1.2,
                "expected_heading_deg": round(heading_deg, 1),
            }
        )

    svg_lines.append("</svg>")
    return "\n".join(svg_lines), extracted
