"""Backends modulares de segmentación de avance físico sobre imágenes alineadas.

Incluye tres estrategias intercambiables:
1. DiffThresholdSegmenter (`diff`): baseline determinista en OpenCV (diferencia en
   espacio CIELAB respecto al Día 1 + morfología). Útil para pruebas locales sin GPU.
2. MaskFileSegmenter (`mask_dir`): carga máscaras binarias PNG pregeneradas (por
   ejemplo, desde SAM 2 en Google Colab o etiquetado manual) para evaluar la
   precisión geométrica pura de la regla ArUco y la homografía.
3. SAM2Segmenter (`sam2`): integración directa con SAM 2 (Meta) usando cambios
   visuales como semillas automáticas (o puntos/cajas) cuando hay PyTorch/GPU.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import cv2
import numpy as np


class BaseSegmenter(ABC):
    """Interfaz común para devolver una máscara binaria (0 o 255) del avance."""

    @abstractmethod
    def segment(
        self,
        day1_rectified_bgr: np.ndarray,
        day_n_aligned_bgr: np.ndarray,
        photo_id: str,
        roi_mask: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        """Devuelve una máscara uint8 (H, W) con valores 0 y 255."""


class DiffThresholdSegmenter(BaseSegmenter):
    """Segmentador determinista basado en diferencia perceptual CIELAB vs Día 1."""

    def __init__(self, lab_threshold: float = 22.0, min_region_area_px: int = 400) -> None:
        self.lab_threshold = lab_threshold
        self.min_region_area_px = min_region_area_px

    def segment(
        self,
        day1_rectified_bgr: np.ndarray,
        day_n_aligned_bgr: np.ndarray,
        photo_id: str,
        roi_mask: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        lab_ref = cv2.cvtColor(day1_rectified_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab_cur = cv2.cvtColor(day_n_aligned_bgr, cv2.COLOR_BGR2LAB).astype(np.float32)

        # Ponderar ligeramente menos L (luminancia) para tolerar cambios moderados de iluminación
        diff_l = (lab_cur[:, :, 0] - lab_ref[:, :, 0]) * 0.65
        diff_a = lab_cur[:, :, 1] - lab_ref[:, :, 1]
        diff_b = lab_cur[:, :, 2] - lab_ref[:, :, 2]
        delta_e = np.sqrt(diff_l**2 + diff_a**2 + diff_b**2)

        # Solo evaluar donde ambas imágenes tienen datos válidos (no bordes negros de warp)
        valid_ref = np.any(day1_rectified_bgr > 5, axis=2)
        valid_cur = np.any(day_n_aligned_bgr > 5, axis=2)
        valid = valid_ref & valid_cur

        mask = ((delta_e >= self.lab_threshold) & valid).astype(np.uint8) * 255

        if roi_mask is not None:
            mask = cv2.bitwise_and(mask, roi_mask)

        # Limpieza morfológica para eliminar ruido puntual y cerrar huecos pequeños
        kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        kernel_close = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel_open)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_close)

        # Filtrar componentes conectados menores a min_region_area_px
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
        cleaned = np.zeros_like(mask)
        for label_id in range(1, num_labels):
            if stats[label_id, cv2.CC_STAT_AREA] >= self.min_region_area_px:
                cleaned[labels == label_id] = 255
        return cleaned


class MaskFileSegmenter(BaseSegmenter):
    """Carga máscaras binarias PNG externas (<photo_stem>.png) ya alineadas."""

    def __init__(self, masks_dir: Path) -> None:
        self.masks_dir = Path(masks_dir)

    def segment(
        self,
        day1_rectified_bgr: np.ndarray,
        day_n_aligned_bgr: np.ndarray,
        photo_id: str,
        roi_mask: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        candidates = [
            self.masks_dir / f"{photo_id}.png",
            self.masks_dir / f"{photo_id}_mask.png",
        ]
        mask_path = next((p for p in candidates if p.exists()), None)
        if mask_path is None:
            raise FileNotFoundError(
                f"No se encontró máscara para '{photo_id}' en {self.masks_dir}. "
                f"Se esperaban: {[p.name for p in candidates]}"
            )

        raw = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
        if raw is None:
            raise RuntimeError(f"No se pudo leer la máscara: {mask_path}")

        target_h, target_w = day_n_aligned_bgr.shape[:2]
        if raw.shape[:2] != (target_h, target_w):
            raw = cv2.resize(raw, (target_w, target_h), interpolation=cv2.INTER_NEAREST)

        mask = (raw > 127).astype(np.uint8) * 255
        if roi_mask is not None:
            mask = cv2.bitwise_and(mask, roi_mask)
        return mask


class SAM2Segmenter(BaseSegmenter):
    """Segmentador basado en SAM 2 (Meta) guiado por semillas de cambio respecto al Día 1."""

    def __init__(
        self,
        checkpoint: Optional[str] = None,
        model_cfg: Optional[str] = None,
        device: str = "cuda",
    ) -> None:
        self.checkpoint = checkpoint or os.getenv("SAM2_CHECKPOINT", "checkpoints/sam2.1_hiera_small.pt")
        self.model_cfg = model_cfg or os.getenv("SAM2_CONFIG", "configs/sam2.1/sam2.1_hiera_s.yaml")
        self.device = device
        self._predictor = None
        self._seed_segmenter = DiffThresholdSegmenter(lab_threshold=24.0, min_region_area_px=600)

    def _lazy_load(self) -> None:
        if self._predictor is not None:
            return
        try:
            import torch
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
        except ImportError as exc:
            raise ImportError(
                "SAM 2 no está instalado en este entorno. Instala requirements-ai.txt "
                "o usa --segmenter diff / --segmenter mask_dir."
            ) from exc

        if not Path(self.checkpoint).exists():
            raise FileNotFoundError(
                f"No se encontró el checkpoint de SAM 2 en '{self.checkpoint}'. "
                "Descárgalo y configura SAM2_CHECKPOINT en .env."
            )

        resolved_device = self.device if (self.device == "cuda" and torch.cuda.is_available()) else "cpu"
        model = build_sam2(self.model_cfg, self.checkpoint, device=resolved_device)
        self._predictor = SAM2ImagePredictor(model)

    def segment(
        self,
        day1_rectified_bgr: np.ndarray,
        day_n_aligned_bgr: np.ndarray,
        photo_id: str,
        roi_mask: Optional[np.ndarray] = None,
    ) -> np.ndarray:
        self._lazy_load()
        assert self._predictor is not None

        # Usar la diferencia visual como propuesta de caja/semillas para guiar a SAM 2
        coarse_mask = self._seed_segmenter.segment(
            day1_rectified_bgr=day1_rectified_bgr,
            day_n_aligned_bgr=day_n_aligned_bgr,
            photo_id=photo_id,
            roi_mask=roi_mask,
        )
        ys, xs = np.where(coarse_mask > 0)
        if len(xs) == 0:
            return np.zeros(day_n_aligned_bgr.shape[:2], dtype=np.uint8)

        box = np.array([xs.min(), ys.min(), xs.max(), ys.max()], dtype=np.float32)
        rgb = cv2.cvtColor(day_n_aligned_bgr, cv2.COLOR_BGR2RGB)
        self._predictor.set_image(rgb)
        masks, scores, _ = self._predictor.predict(box=box[None, :], multimask_output=True)
        best_idx = int(np.argmax(scores))
        best_mask = (masks[best_idx] > 0).astype(np.uint8) * 255

        if roi_mask is not None:
            best_mask = cv2.bitwise_and(best_mask, roi_mask)
        return best_mask


def build_segmenter(
    name: str,
    masks_dir: Optional[Path] = None,
    lab_threshold: float = 22.0,
) -> BaseSegmenter:
    """Factory para instanciar el segmentador seleccionado por CLI."""
    if name == "diff":
        return DiffThresholdSegmenter(lab_threshold=lab_threshold)
    if name == "mask_dir":
        if masks_dir is None:
            raise ValueError("Debes indicar --masks-dir cuando usas --segmenter mask_dir.")
        return MaskFileSegmenter(masks_dir=masks_dir)
    if name == "sam2":
        return SAM2Segmenter()
    raise ValueError(f"Segmentador desconocido: '{name}'. Opciones: diff, mask_dir, sam2.")
