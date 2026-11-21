# CFA Productivity — Sistema Interno de Control de Avance, Productividad y Asistencia en Obra

Aplicación web móvil (**PWA offline-first**) + backend **FastAPI / OpenCV / IA** diseñada para cuantificar automáticamente el avance físico diario ($m^2$), registrar la asistencia de cuadrillas en 1 toque y calcular el rendimiento real ($m^2/\text{HH}$) contra el presupuesto APU.

---

## Arquitectura del repositorio

```text
CFA-PRODUCTIVITY/
├── backend/              # API FastAPI + SQLAlchemy (SQLite/PostgreSQL) + importador DXF + motor de visión
├── frontend/             # PWA React + TypeScript + Vite + IndexedDB (Dexie) + Service Worker offline
├── vision_lab/           # Laboratorio de calibración ArUco (Día 1), homografía (Días 2+), SAM 2 y Gemini
├── field_capture_poc/    # PoC estático publicado en GitHub Pages (Cámara Poka-Yoke + Asistencia + PDF Regla)
├── data_template/        # Plantillas de configuración y ground truth para experimentos con cinta métrica
└── tests/                # Pruebas automatizadas end-to-end (visión + API completa)
```

---

## Módulos implementados (MVP v1)

1. **Oficina y Programación Semanal (5 min)**
   - Importación de planos `.dxf` (`ezdxf`) a mapa **SVG interactivo**, registro único del desvío del Norte y geofence de 100 m.
   - Obra piloto precargada automáticamente (*Entrada → Cocina → Baño → Cuarto 2*, 8 muros SVG).
   - Programación semanal: selección de frentes activos, asignación de cuadrillas y ordenamiento físico de la caminata (`↑` / `↓`).
2. **Campo — "Modo Recorrido Guiado" (PWA Offline-first)**
   - Botón único **"Iniciar recorrido de hoy"** (cero menús), guía secuencial muro por muro e indicador de regla ArUco el Día 1.
   - **Cámara Poka-Yoke (`1x`):** *ghost overlay* ajustable, validación en vivo de nitidez y luz, semáforo con instrucciones de ≤ 3 palabras y auto-disparo tras 1 s en verde.
   - **Válvulas de escape en 1 toque:** *Saltar por ahora*, *Sin avance hoy* (lluvia, falta de material, espera de plano, retrabajo) y *Forzar captura + nota de voz (5 s)* tras 3 intentos.
   - Cola offline en **IndexedDB (Dexie)** con sincronización automática al recuperar señal.
3. **Control de Asistencia en 1 Toque**
   - Botón **Igual que ayer**, validación de geofencing de 100 m, estados *Presente / Parcial / Ausente*, horas extra, foto grupal de cuadrilla, guardado offline y exportación CSV para planilla.
   - Alimenta directamente las **Horas-Hombre (HH)** reales del cálculo de productividad ($m^2/\text{HH}$).
4. **Motor Híbrido de Visión + Tablero de Control y Aprobación (5 seg)**
   - **OpenCV:** Calibración métrica Día 1 con regla ArUco (`DICT_4X4_50`) y alineación sin regla Días 2+ por homografía.
   - **Mapa de calor SVG:** Colorea cada muro automáticamente (rojo: sin iniciar, amarillo: en proceso, verde: terminado).
   - **Validación rápida de 5 segundos:** Muestra la foto con máscara verde semitransparente para aprobar, ajustar $m^2$ o rechazar antes de enviar a costos/destajo.
   - **Exportación CSV:** Respaldo de planilla por destajo y reporte de asistencia.

---

## Cómo ejecutar el MVP en local

### 1. Backend (FastAPI + OpenCV + SQLite)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

uvicorn backend.main:app --reload --port 8000
```
- Documentación interactiva Swagger: `http://127.0.0.1:8000/docs`

### 2. Frontend (PWA React + Vite)
En otra terminal:
```bash
cd frontend
npm install
npm run dev
```
- Abre `http://localhost:5173` (el proyecto piloto se inicializa automáticamente al primer arranque).

---

## Pruebas automatizadas

```bash
pytest -v
```

---

## Kit de Validación de Campo (PoC público)
- **Mini-cámara Poka-Yoke + Asistencia (GitHub Pages):** https://kevinfa1.github.io/CFA-PRODUCTIVITY/field_capture_poc/
- **Generar regla ArUco imprimible 1:1:** `python -m vision_lab.generate_ruler --page-size letter`
- **Evaluar precisión contra cinta métrica (< 5%):** `python -m vision_lab.evaluate_progress --config ... --ground-truth ...`
- **Auditoría multimodal con Gemini:** `python -m vision_lab.audit_gemini --prev ... --curr ...` (requiere `GEMINI_API_KEY` en `.env`)
