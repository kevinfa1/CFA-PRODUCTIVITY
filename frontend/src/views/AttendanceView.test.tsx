import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { offlineDb } from "../db";
import type { Crew, Project } from "../types";
import { AttendanceView } from "./AttendanceView";

const mockProject: Project = {
  id: 1,
  name: "Obra Piloto CFA — Apartamento 101",
  location: "Sector Norte",
  geofence_lat: 14.6349,
  geofence_lng: -90.5069,
  geofence_radius_m: 100,
  north_offset_deg: 0,
  floorplan_svg: "<svg></svg>",
};

const mockCrews: Crew[] = [
  {
    id: 10,
    project_id: 1,
    name: "Cuadrilla Mampostería A",
    trade: "mamposteria",
    workers: [
      { id: 101, crew_id: 10, name: "Carlos Méndez", role: "Albañil", active: true },
      { id: 102, crew_id: 10, name: "José López", role: "Albañil", active: true },
      { id: 103, crew_id: 10, name: "Luis Morales", role: "Ayudante", active: true },
    ],
  },
  {
    id: 20,
    project_id: 1,
    name: "Cuadrilla Repello B",
    trade: "repello",
    workers: [
      { id: 201, crew_id: 20, name: "Pedro Castillo", role: "Albañil", active: true },
      { id: 202, crew_id: 20, name: "Miguel Ramírez", role: "Ayudante", active: true },
    ],
  },
];

describe("AttendanceView — Flujo guiado para Maestro de Obra (Samsung / Sol Directo)", () => {
  const onQueueChanged = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    onQueueChanged.mockReset();

    vi.spyOn(api, "getCrews").mockResolvedValue(mockCrews);
    vi.spyOn(api, "listAttendance").mockResolvedValue([]);
    vi.spyOn(api, "saveAttendance").mockResolvedValue({
      id: 99,
      project_id: 1,
      crew_id: 10,
      work_date: "2026-11-22",
      present_count: 2,
      total_workers: 3,
      total_hh: 13,
      inside_geofence: true,
      distance_m: 10,
      group_photo_path: "/uploads/group.jpg",
      entries: [],
    });
    vi.spyOn(api, "addWorker").mockResolvedValue({
      id: 999,
      crew_id: 10,
      name: "Juan Gómez",
      role: "Ayudante",
      active: true,
    });

    if (!URL.createObjectURL) {
      Object.defineProperty(URL, "createObjectURL", {
        writable: true,
        value: vi.fn(() => "blob:mock-crew-photo"),
      });
    } else {
      vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock-crew-photo");
    }
    if (!URL.revokeObjectURL) {
      Object.defineProperty(URL, "revokeObjectURL", {
        writable: true,
        value: vi.fn(),
      });
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inicia en Modo Sol Alto ON y permite solo cargos Albañil y Ayudante", async () => {
    const user = userEvent.setup();
    render(<AttendanceView project={mockProject} onQueueChanged={onQueueChanged} />);

    await screen.findByText("Carlos Méndez");

    // Modo Sol Alto activado por defecto para lectura bajo sol directo
    const moduleEl = document.getElementById("attendance-module");
    expect(moduleEl).toHaveClass("sun-boost");

    const sunBtn = screen.getByRole("button", { name: /Sol Alto: ON/i });
    await user.click(sunBtn);
    expect(moduleEl).not.toHaveClass("sun-boost");

    // Abrir formulario "+ Nuevo trabajador" y verificar solo 2 radios: Albañil y Ayudante
    await user.click(screen.getByRole("button", { name: /\+ Nuevo trabajador/i }));
    const radioGroup = screen.getByRole("radiogroup", { name: /Cargo del trabajador/i });
    const radios = within(radioGroup).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Albañil", "Ayudante"]);

    await user.type(screen.getByPlaceholderText(/Nombre y apellido/i), "Juan Gómez");
    await user.click(within(radioGroup).getByRole("radio", { name: "Ayudante" }));
    await user.click(screen.getByRole("button", { name: /Agregar Ayudante/i }));

    expect(api.addWorker).toHaveBeenCalledWith(10, "Juan Gómez", "Ayudante");
    await screen.findByText("Juan Gómez");
  });

  it("completa el flujo guiado de 3 pasos (1-toque lista -> foto cámara -> confirmar y guardar)", async () => {
    const user = userEvent.setup();
    render(<AttendanceView project={mockProject} onQueueChanged={onQueueChanged} />);

    await screen.findByText("Carlos Méndez");

    // Todos inician Presentes: 2/2 Albañiles, 1/1 Ayudantes, 24.0 HH
    const kpiStrip = screen.getByLabelText("Resumen de cuadrilla");
    expect(kpiStrip).toHaveTextContent("2/2");
    expect(kpiStrip).toHaveTextContent("1/1");
    expect(kpiStrip).toHaveTextContent("24.0");

    // Marcar a José López como Parcial (4h) y a Luis Morales como Ausente (Permiso) con 1 toque
    const workerCards = screen.getAllByRole("article");
    await user.click(within(workerCards[1]).getByRole("button", { name: /Parcial/i }));
    await user.click(within(workerCards[2]).getByRole("button", { name: /Ausente/i }));
    await user.click(within(workerCards[2]).getByRole("button", { name: "Permiso" }));

    // Agregar +1h extra a Carlos Méndez (8 + 1 = 9 HH; José 4 HH; Luis 0 HH => Total 13.0 HH)
    await user.click(within(workerCards[0]).getByRole("button", { name: /\+ Agregar extra/i }));
    expect(kpiStrip).toHaveTextContent("13.0");

    // Paso 1 -> Paso 2 (Foto grupal guiada)
    await user.click(screen.getByRole("button", { name: /Siguiente: Tomar Foto \(2 presentes\)/i }));
    expect(screen.getByText(/Reúna a los 2 trabajadores presentes/i)).toBeInTheDocument();

    // Verificar input de cámara trasera para Samsung (capture="environment")
    const photoInput = document.getElementById("input-crew-photo") as HTMLInputElement;
    expect(photoInput).toHaveAttribute("accept", "image/*");
    expect(photoInput).toHaveAttribute("capture", "environment");

    const fakePhoto = new File(["fake-image-bytes"], "cuadrilla.jpg", { type: "image/jpeg" });
    await user.upload(photoInput, fakePhoto);

    await screen.findByText(/Foto lista con sello corporativo CFA/i);

    // Paso 2 -> Paso 3 (Resumen corporativo)
    await user.click(screen.getByRole("button", { name: /Foto correcta: Confirmar/i }));
    expect(screen.getByText(/Resumen antes de guardar/i)).toBeInTheDocument();
    expect(screen.getByText("13.0 HH")).toBeInTheDocument();

    // Guardar asistencia
    await user.click(screen.getByRole("button", { name: /Confirmar y Guardar \(13\.0 HH\)/i }));

    await waitFor(() => {
      expect(api.saveAttendance).toHaveBeenCalledTimes(1);
    });
    const [, savedPayload, savedPhoto] = vi.mocked(api.saveAttendance).mock.calls[0];
    expect(savedPayload.crew_id).toBe(10);
    expect(savedPayload.entries[0].extra_hours).toBe(1);
    expect(savedPayload.entries[1].status).toBe("parcial");
    expect(savedPayload.entries[2].reason).toBe("Permiso");
    expect(savedPhoto).toBeInstanceOf(Blob);

    // Pantalla de éxito ofrece saltar directo a la siguiente cuadrilla pendiente
    await screen.findByText(/Asistencia registrada correctamente/i);
    expect(screen.getByRole("button", { name: /Pasar asistencia a: Cuadrilla Repello B/i })).toBeInTheDocument();
  });

  it("guarda en cola offline si falla la red en obra", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "saveAttendance").mockRejectedValueOnce(new Error("Sin señal"));
    const addOfflineSpy = vi.spyOn(offlineDb.pendingAttendance, "add").mockResolvedValueOnce(1);

    render(<AttendanceView project={mockProject} onQueueChanged={onQueueChanged} />);
    await screen.findByText("Carlos Méndez");

    await user.click(screen.getByRole("button", { name: /Siguiente: Tomar Foto/i }));
    await user.click(screen.getByRole("button", { name: /Continuar sin foto por ahora/i }));
    await user.click(screen.getByRole("button", { name: /Confirmar y Guardar/i }));

    await screen.findByText(/Asistencia guardada en el teléfono \(Sin señal\)/i);
    expect(addOfflineSpy).toHaveBeenCalledTimes(1);
    expect(onQueueChanged).toHaveBeenCalledTimes(1);
  });
});
