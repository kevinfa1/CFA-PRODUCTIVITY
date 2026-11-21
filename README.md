# CFA Productivity — Kit de Validación de Validez (PoC)

Este repositorio contiene el **Kit de Validación (Etapa 0 / PoC)** para comprobar en una obra real si el núcleo técnico de **CFA: Sistema Interno de Control de Avance y Productividad en Obra** cumple los umbrales de precisión y usabilidad **antes** de invertir en el desarrollo completo de la aplicación.

## Hipótesis Go / No-Go que valida este kit

| # | Hipótesis | Criterio de éxito |
|---|---|---|
| **H1** | Calibración Día 1 (regla ArUco) + Alineación Días 2+ (sin regla) con OpenCV | **≥ 90%** de fotos alineadas correctamente a mano alzada |
| **H2** | Precisión métrica ($m^2$ calculados vs cinta métrica) | Error promedio **< 5%** en condiciones normales |
| **H3** | Fricción de captura en campo con *Ghost Overlay* (lente `1x`) | Captura repetible en **≤ 15 segundos** por muro |

---

## Estructura del kit

- `vision_lab/generate_ruler.py` — Genera el PDF/PNG imprimible **1:1** de los 2 marcadores ArUco `DICT_4X4_50` (15 × 15 cm, IDs `0` y `1`).
- `vision_lab/calibrate_and_align.py` — Calibración métrica Día 1 (homografía con los 8 vértices ArUco) y alineación sin regla Días 2+ (SIFT/AKAZE + USAC_MAGSAC/RANSAC).
- `vision_lab/segmenters.py` — Backends de segmentación intercambiables: `diff` (baseline determinista local), `mask_dir` (máscaras PNG externas, ej. desde SAM 2 en Colab) y `sam2` (GPU local).
- `vision_lab/evaluate_progress.py` — Ejecuta el experimento completo contra tus mediciones reales con cinta métrica y genera `report.md`, `report.json` e imágenes con la máscara superpuesta.
- `vision_lab/audit_gemini.py` — Auditoría multimodal opcional con Gemini API para verificar si dos fotos corresponden al mismo muro y detectar obstrucciones (andamios, trabajadores, sombras).
- `field_capture_poc/index.html` — Mini-cámara móvil Poka-Yoke con *Ghost Overlay*, nivel, nitidez en vivo, semáforo y cronómetro para validar **H3** en obra.
- `data_template/` — Plantillas de `wall_config.json` y `ground_truth.csv` para registrar tu prueba real.

---

## Instalación rápida

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Opcional: si vas a probar auditoría con Gemini o SAM 2
pip install -r requirements-ai.txt
cp .env.example .env
```

---

## Paso a paso para ejecutar la prueba en obra real

### Paso 1 — Imprimir y armar la regla fotogramétrica (10 min)
```bash
python -m vision_lab.generate_ruler --page-size letter
```
1. Imprime `outputs/ruler/regla_aruco_15cm_letter_100pct.pdf` al **100% (escala real, sin ajustar a página)** en papel bond **mate** (no plastificar brillante).
2. Verifica con cinta métrica que la barra de control mida **10.0 cm** y cada cuadro negro mida **15.0 × 15.0 cm**.
3. Pega ambos marcadores en un listón rígido de 1.00 m con **80.0 cm exactos entre centros** (`ID 0` a la izquierda, `ID 1` a la derecha).

### Paso 2 — Capturar 30–50 fotos en 1 o 2 muros reales (mampostería o repello)
- Usa lente `1x` (sin zoom). Puedes usar la mini-cámara de [`field_capture_poc/index.html`](field_capture_poc/index.html) para probar el *Ghost Overlay* y medir el tiempo por toma (**H3**).
- **Día 1:** Toma 3–5 fotos con la regla apoyada plana contra el muro.
- **Días 2 al cierre:** Toma fotos **sin regla**, anotando en tu CSV el área real ejecutada en $m^2$ medida con cinta métrica. Incluye 5–10 tomas "difíciles" (`condition=dificil`) con cambios de luz, sombras o andamios.

### Paso 3 — Correr el evaluador de precisión (H1 y H2)
Copia las plantillas de `data_template/` a una carpeta con tus fotos (por ejemplo `mi_obra/`), edita `wall_config.json` y `ground_truth.csv`, y ejecuta:

```bash
python -m vision_lab.evaluate_progress \
  --config mi_obra/wall_config.json \
  --ground-truth mi_obra/ground_truth.csv \
  --output-dir outputs/piloto_muro1 \
  --segmenter diff
```
> Cuando tengas máscaras generadas con SAM 2 (por ejemplo en Colab), corre el mismo comando con `--segmenter mask_dir --masks-dir mi_obra/masks` o directamente `--segmenter sam2` si cuentas con GPU local.

Revisa el veredicto automático y las evidencias visuales en:
- `outputs/piloto_muro1/report.md`
- `outputs/piloto_muro1/overlays/`

### Paso 4 — Probar la auditoría multimodal con Gemini (opcional)
```bash
python -m vision_lab.audit_gemini \
  --prev mi_obra/day1_con_regla.jpg \
  --curr mi_obra/day2_toma1.jpg \
  --wall-name "Cocina - Muro Norte" \
  --trade "mamposteria" \
  --net-area-m2 10.5
```

---

## Verificar la instalación (pruebas automatizadas)

```bash
pytest -v
```
