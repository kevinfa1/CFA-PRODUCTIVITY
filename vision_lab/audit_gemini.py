"""Auditoría visual multimodal con Gemini API (coherencia de muro y bloqueos).

Importante: Gemini NO mide metros cuadrados (eso es aritmética pura de OpenCV +
segmentación). Su función exclusiva es auditar el par de fotos (anterior vs actual):
1. Verificar si realmente corresponden al mismo muro/elemento.
2. Detectar bloqueos visibles (andamios, herramientas, trabajadores, sombra extrema).
3. Señalar observaciones de calidad o recomendar repetir la captura.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from PIL import Image

AUDIT_PROMPT_TEMPLATE = """Eres un ingeniero inspector de obra auditando dos fotografías del mismo frente de trabajo.
- Imagen 1: Foto de referencia anterior del muro.
- Imagen 2: Foto actual del muro.

Contexto del frente:
- Nombre del muro: {wall_name}
- Partida: {trade}
- Área neta esperada del plano: {net_area_m2} m²

Responde EXCLUSIVAMENTE con un objeto JSON válido con esta estructura exacta (sin markdown extra):
{{
  "mismo_muro": true | false,
  "confianza_mismo_muro": 0.0 a 1.0,
  "calidad_foto_actual": "buena" | "aceptable" | "mala",
  "avance_visible": true | false,
  "obstrucciones_detectadas": ["lista de elementos que tapan el muro, ej: andamio, trabajador, cubetas, sombra_fuerte"],
  "observaciones_calidad": "breve resumen técnico de máximo 2 oraciones",
  "accion_recomendada": "aprobar_para_medicion" | "revisar_manualmente" | "repetir_foto"
}}
"""


def run_gemini_audit(
    prev_photo: Path,
    curr_photo: Path,
    wall_name: str = "Muro piloto",
    trade: str = "mamposteria",
    net_area_m2: float = 12.0,
    model_name: str | None = None,
) -> dict:
    """Ejecuta la auditoría multimodal enviando ambas imágenes a Gemini API."""
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "Falta GEMINI_API_KEY en el entorno o en el archivo .env. "
            "Copia .env.example a .env y coloca tu clave."
        )

    try:
        from google import genai
        from google.genai import types
    except ImportError as exc:
        raise ImportError(
            "No está instalado 'google-genai'. Instálalo con: pip install -r requirements-ai.txt"
        ) from exc

    resolved_model = model_name or os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    client = genai.Client(api_key=api_key)

    img_prev = Image.open(prev_photo)
    img_curr = Image.open(curr_photo)

    prompt = AUDIT_PROMPT_TEMPLATE.format(
        wall_name=wall_name,
        trade=trade,
        net_area_m2=net_area_m2,
    )

    response = client.models.generate_content(
        model=resolved_model,
        contents=[prompt, img_prev, img_curr],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=0.1,
        ),
    )

    raw_text = (response.text or "").strip()
    return json.loads(raw_text)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audita coherencia estructural y obstrucciones entre dos fotos de obra usando Gemini."
    )
    parser.add_argument("--prev", type=Path, required=True, help="Foto anterior (ej. Día 1 o Día N-1).")
    parser.add_argument("--curr", type=Path, required=True, help="Foto actual (Día N).")
    parser.add_argument("--wall-name", type=str, default="Muro piloto", help="Nombre del muro.")
    parser.add_argument("--trade", type=str, default="mamposteria", help="Partida (mamposteria, repello, pintura...).")
    parser.add_argument("--net-area-m2", type=float, default=12.0, help="Área neta del muro en m².")
    parser.add_argument("--model", type=str, default=None, help="Modelo Gemini (default: GEMINI_MODEL o gemini-2.5-flash).")
    parser.add_argument("--output", type=Path, default=None, help="Archivo JSON opcional para guardar el resultado.")
    args = parser.parse_args()

    result = run_gemini_audit(
        prev_photo=args.prev,
        curr_photo=args.curr,
        wall_name=args.wall_name,
        trade=args.trade,
        net_area_m2=args.net_area_m2,
        model_name=args.model,
    )
    formatted = json.dumps(result, indent=2, ensure_ascii=False)
    print(formatted)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(formatted + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
