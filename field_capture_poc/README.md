# Mini-Cámara Poka-Yoke con Ghost Overlay (PoC de Campo — H3)

Esta página liviana (`index.html`) permite validar en obra real si el encargado logra repetir el encuadre del muro en **≤ 15 segundos** usando solo un teléfono común en lente `1x`, sin construir aún el resto de la PWA.

## Qué valida
- Cámara trasera en `1x` (sin zoom).
- Carga de la foto del Día 1 como **Ghost Overlay** (opacidad ajustable 0–60% o modo **Contornos**).
- Validación local en vivo (sin internet): nitidez, iluminación e inclinación con semáforo rojo/amarillo/verde e instrucciones de ≤ 3 palabras.
- **Auto-disparo** tras 1 segundo estable en verde + botón de captura manual.
- **Cronómetro integrado** que guarda el tiempo de captura en el nombre del archivo (`muro1_dia2_YYYYMMDD_HHMMSS_8.4s.jpg`) para medir H3.

## Cómo abrirla en el celular (requiere HTTPS)
Los navegadores móviles exigen HTTPS para acceder a la cámara y los sensores. Dos formas rápidas:
1. **GitHub Pages (recomendado):** En tu repositorio `kevinfa1/CFA-PRODUCTIVITY` → *Settings → Pages → Deploy from branch (`main`, `/`)* y abre `https://kevinfa1.github.io/CFA-PRODUCTIVITY/field_capture_poc/`.
2. **Prueba local en tu red:** Usa un túnel HTTPS temporal (ej. `npx localtunnel --port 8080` o `cloudflared tunnel --url http://localhost:8080`) apuntando a `python3 -m http.server 8080`.
