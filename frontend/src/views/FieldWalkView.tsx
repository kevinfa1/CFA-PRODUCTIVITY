import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { offlineDb } from "../db";
import type { FieldRouteResponse, FieldRouteStep } from "../types";

const STOP_REASONS = [
  { id: "lluvia", label: "🌧️ Lluvia" },
  { id: "falta_material", label: "🧱 Falta material" },
  { id: "espera_plano", label: "📐 Espera plano" },
  { id: "retrabajo", label: "🔁 Retrabajo" },
];

export function FieldWalkView({
  projectId,
  onQueueChanged,
}: {
  projectId: number;
  onQueueChanged: () => void;
}) {
  const [route, setRoute] = useState<FieldRouteResponse | null>(null);
  const [steps, setSteps] = useState<FieldRouteStep[]>([]);
  const [started, setStarted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [showNoProgressMenu, setShowNoProgressMenu] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [toast, setToast] = useState("");
  const [ghostOpacity, setGhostOpacity] = useState(28);
  const [autoShoot, setAutoShoot] = useState(true);
  const [trafficLight, setTrafficLight] = useState<"red" | "yellow" | "green">("yellow");
  const [promptText, setPromptText] = useState("Apunta al muro");
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceBlob, setVoiceBlob] = useState<Blob | undefined>(undefined);

  const videoRef = useRef<HTMLVideoElement>(null);
  const analysisCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const greenSinceRef = useRef<number | null>(null);
  const lastShotRef = useRef<number>(0);

  const todayStr = new Date().toISOString().slice(0, 10);

  const loadRoute = async () => {
    const data = await api.getFieldRoute(projectId, todayStr);
    setRoute(data);
    setSteps(data.steps);
  };

  useEffect(() => {
    void loadRoute();
  }, [projectId]);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  const currentStep = steps[currentIdx] ?? null;

  // Iniciar / detener cámara trasera 1x al entrar al Modo Recorrido Guiado
  useEffect(() => {
    if (!started || !currentStep) return;

    let cancelled = false;
    let rafId = 0;

    const startCam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;

        const tick = () => {
          const video = videoRef.current;
          const canvas = analysisCanvasRef.current;
          if (video && canvas && video.readyState >= 2) {
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx) {
              const w = canvas.width;
              const h = canvas.height;
              ctx.drawImage(video, 0, 0, w, h);
              const d = ctx.getImageData(0, 0, w, h).data;
              const gray = new Float32Array(w * h);
              let sumLuma = 0;
              for (let i = 0; i < w * h; i++) {
                const g = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
                gray[i] = g;
                sumLuma += g;
              }
              const luma = sumLuma / (w * h);
              let sumLap = 0;
              let sumLapSq = 0;
              let cnt = 0;
              for (let y = 1; y < h - 1; y++) {
                for (let x = 1; x < w - 1; x++) {
                  const idx = y * w + x;
                  const lap = -4 * gray[idx] + gray[idx - 1] + gray[idx + 1] + gray[idx - w] + gray[idx + w];
                  sumLap += lap;
                  sumLapSq += lap * lap;
                  cnt++;
                }
              }
              const meanLap = sumLap / cnt;
              const sharpness = sumLapSq / cnt - meanLap * meanLap;

              let light: "red" | "yellow" | "green" = "green";
              let text = "¡Perfecto, quieto!";
              if (luma < 45) {
                light = "red";
                text = "Falta luz";
              } else if (luma > 235) {
                light = "red";
                text = "Mucha luz";
              } else if (sharpness < 55) {
                light = "red";
                text = "Enfoca firme";
              } else if (sharpness < 105) {
                light = "yellow";
                text = "Mantén quieto";
              }
              setTrafficLight(light);
              setPromptText(text);

              const now = performance.now();
              if (light === "green" && autoShoot) {
                if (greenSinceRef.current === null) greenSinceRef.current = now;
                if (now - greenSinceRef.current >= 1000 && now - lastShotRef.current > 3500) {
                  lastShotRef.current = now;
                  greenSinceRef.current = null;
                  void captureAndAdvance(false);
                }
              } else {
                greenSinceRef.current = null;
              }
            }
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch {
        setTrafficLight("red");
        setPromptText("Sin cámara (usa subir)");
      }
    };

    void startCam();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [started, currentIdx, autoShoot]);

  const submitPhotoBlob = async (blob: Blob, forced: boolean) => {
    if (!currentStep) return;
    const captureType = forced
      ? "forced_voice_note"
      : currentStep.needs_day1_ruler
        ? "day1_calibration"
        : "daily_progress";

    try {
      await api.uploadCapture({
        projectId,
        elementId: currentStep.element_id,
        crewId: currentStep.crew_id,
        workDate: todayStr,
        captureType,
        notes: forced ? "Captura forzada en campo" : "",
        photoBlob: blob,
        voiceBlob: forced ? voiceBlob : undefined,
      });
      notify(`✅ ${currentStep.code} enviado al motor de visión`);
    } catch {
      await offlineDb.pendingCaptures.add({
        projectId,
        elementId: currentStep.element_id,
        crewId: currentStep.crew_id,
        workDate: todayStr,
        captureType,
        notes: forced ? "Captura forzada offline" : "Guardado offline",
        photoBlob: blob,
        voiceBlob: forced ? voiceBlob : undefined,
        createdAt: new Date().toISOString(),
      });
      onQueueChanged();
      notify(`📦 ${currentStep.code} guardado offline (se subirá al volver señal)`);
    }

    setVoiceBlob(undefined);
    setFailedAttempts(0);
    setShowNoProgressMenu(false);
    setCurrentIdx((idx) => idx + 1);
  };

  const captureAndAdvance = async (forced: boolean) => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setFailedAttempts((n) => n + 1);
      notify("Cámara no lista — intenta de nuevo o usa archivo.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (blob) void submitPhotoBlob(blob, forced);
      },
      "image/jpeg",
      0.92
    );
  };

  const handleSkipForNow = () => {
    if (!currentStep) return;
    const updated = [...steps];
    const [skipped] = updated.splice(currentIdx, 1);
    updated.push(skipped);
    setSteps(updated);
    setShowNoProgressMenu(false);
    notify(`⏭️ ${skipped.code} movido al final del recorrido`);
  };

  const handleNoProgress = async (reason: string) => {
    if (!currentStep) return;
    try {
      await api.reportNoProgress({
        project_id: projectId,
        element_id: currentStep.element_id,
        crew_id: currentStep.crew_id,
        work_date: todayStr,
        stop_reason: reason,
      });
      notify(`🛑 ${currentStep.code}: Sin avance (${reason})`);
    } catch {
      await offlineDb.pendingCaptures.add({
        projectId,
        elementId: currentStep.element_id,
        crewId: currentStep.crew_id,
        workDate: todayStr,
        captureType: "no_progress",
        stopReason: reason,
        createdAt: new Date().toISOString(),
      });
      onQueueChanged();
      notify(`📦 Sin avance (${reason}) guardado offline`);
    }
    setShowNoProgressMenu(false);
    setCurrentIdx((idx) => idx + 1);
  };

  const recordVoiceNote5s = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        setVoiceBlob(new Blob(chunks, { type: "audio/webm" }));
        stream.getTracks().forEach((t) => t.stop());
        setIsRecordingVoice(false);
        notify("🎙️ Nota de voz (5s) lista");
      };
      setIsRecordingVoice(true);
      recorder.start();
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 5000);
    } catch {
      notify("No se pudo activar micrófono");
    }
  };

  if (!route) {
    return <div className="card">Cargando ruta del día...</div>;
  }

  // Pantalla de inicio: cero menús, 1 botón grande
  if (!started) {
    return (
      <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "32px 18px" }}>
        <span className="badge blue">PWA OFFLINE-FIRST · MODO RECORRIDO GUIADO</span>
        <h2 style={{ fontSize: 22 }}>{route.project_name}</h2>
        <p className="kpi-sub" style={{ maxWidth: 420 }}>
          {steps.length} frentes programados en secuencia física ({steps.map((s) => s.room_name).filter((v, i, a) => a.indexOf(v) === i).join(" → ")}).
        </p>
        <button
          type="button"
          className="btn primary"
          style={{ fontSize: 17, padding: "14px 28px", marginTop: 8 }}
          onClick={() => {
            setCurrentIdx(0);
            setStarted(true);
          }}
        >
          ▶ Iniciar recorrido de hoy
        </button>
      </section>
    );
  }

  // Recorrido completado
  if (!currentStep) {
    return (
      <section className="card" style={{ alignItems: "center", textAlign: "center", padding: "32px 18px" }}>
        <h2 style={{ color: "var(--green)" }}>✅ Recorrido completado</h2>
        <p className="kpi-sub">Todas las capturas fueron enviadas o encoladas en IndexedDB.</p>
        <button type="button" className="btn accent" onClick={() => setStarted(false)}>
          Volver al inicio del recorrido
        </button>
      </section>
    );
  }

  const borderColor =
    trafficLight === "green" ? "#22c55e" : trafficLight === "yellow" ? "#f59e0b" : "#ef4444";

  return (
    <section className="card" style={{ maxWidth: 560, margin: "0 auto", width: "100%" }}>
      {toast && <div className="alert-box">{toast}</div>}

      {/* Guía secuencial paso a paso */}
      <div className="row between">
        <div>
          <span className="badge blue">
            {currentIdx + 1} / {steps.length} · {currentStep.crew_name}
          </span>
          <h3 style={{ marginTop: 4 }}>
            {currentStep.room_name} — {currentStep.wall_name} ({currentStep.code})
          </h3>
          <div className="kpi-sub">{currentStep.turn_hint}</div>
        </div>
        {currentStep.needs_day1_ruler ? (
          <span className="badge yellow">📏 Día 1: Usa regla ArUco</span>
        ) : (
          <span className="badge green">📱 Día 2+: Sin regla</span>
        )}
      </div>

      {/* Visor Cámara Poka-Yoke */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "4 / 3",
          background: "#000",
          borderRadius: 14,
          overflow: "hidden",
          border: `4px solid ${borderColor}`,
        }}
      >
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
        {currentStep.ghost_photo_url && (
          <img
            src={currentStep.ghost_photo_url}
            alt="Ghost Día 1"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              opacity: ghostOpacity / 100,
              pointerEvents: "none",
            }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15, 23, 42, 0.88)",
            border: `2px solid ${borderColor}`,
            padding: "6px 14px",
            borderRadius: 999,
            fontWeight: 800,
            fontSize: 13,
          }}
        >
          {promptText}
        </div>
      </div>

      {/* Controles rápidos de cámara */}
      <div className="row between">
        <label className="kpi-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          Ghost {ghostOpacity}%
          <input
            type="range"
            min={0}
            max={60}
            value={ghostOpacity}
            onChange={(e) => setGhostOpacity(Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className={`btn sm ${autoShoot ? "accent" : "ghost"}`}
          onClick={() => setAutoShoot((v) => !v)}
        >
          Auto-disparo: {autoShoot ? "ON" : "OFF"}
        </button>
      </div>

      <div className="row">
        <button type="button" className="btn primary" style={{ flex: 1 }} onClick={() => void captureAndAdvance(false)}>
          📸 Capturar ahora
        </button>
        <label className="btn ghost sm" style={{ cursor: "pointer" }}>
          Subir foto prueba
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void submitPhotoBlob(f, false);
            }}
          />
        </label>
      </div>

      {/* Válvulas de escape obligatorias (1 toque) */}
      <div className="row">
        <button type="button" className="btn ghost sm" onClick={handleSkipForNow}>
          ⏭️ Saltar por ahora
        </button>
        <button
          type="button"
          className="btn warn sm"
          onClick={() => setShowNoProgressMenu((v) => !v)}
        >
          🛑 Sin avance hoy
        </button>
        <button
          type="button"
          className="btn danger sm"
          onClick={() => {
            if (failedAttempts < 2) {
              setFailedAttempts((n) => n + 1);
              notify(`Intento ${failedAttempts + 1}/3 — vuelve a encuadrar o pulsa otra vez para forzar.`);
            } else {
              void captureAndAdvance(true);
            }
          }}
        >
          ⚡ Forzar ({failedAttempts}/3)
        </button>
        {failedAttempts >= 2 && (
          <button type="button" className="btn accent sm" disabled={isRecordingVoice} onClick={() => void recordVoiceNote5s()}>
            {isRecordingVoice ? "Grabando 5s..." : "🎙️ Nota voz 5s"}
          </button>
        )}
      </div>

      {showNoProgressMenu && (
        <div className="row" style={{ background: "#0f172a", padding: 10, borderRadius: 10 }}>
          {STOP_REASONS.map((r) => (
            <button key={r.id} type="button" className="btn sm danger" onClick={() => void handleNoProgress(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
      )}

      <canvas ref={analysisCanvasRef} width={160} height={120} style={{ display: "none" }} />
      <canvas ref={captureCanvasRef} style={{ display: "none" }} />
    </section>
  );
}
