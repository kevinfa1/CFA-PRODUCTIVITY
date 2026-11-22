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

describe("AttendanceView — Asistencia Global por Proyecto (Samsung / Sol Directo)", () => {
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
      present_count: 4,
      total_workers: 5,
      total_hh: 29,
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

  it("muestra todo el personal del proyecto sin selector de cuadrillas, inicia en Sol Alto ON y solo permite Albañil/Ayudante", async () => {
    const user = userEvent.setup();
    render(<AttendanceView project={mockProject} onQueueChanged={onQueueChanged} />);

    // Todos los trabajadores de ambas cuadrillas aparecen directamente en la lista global
    await screen.findByText("Carlos Méndez");
    expect(screen.getByText("Pedro Castillo")).toBeInTheDocument();
    expect(screen.getByText("Miguel Ramírez")).toBeInTheDocument();
    expect(screen.queryByText(/Seleccione la cuadrilla/i)).not.toBeInTheDocument();

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

  it("completa la asistencia global del proyecto (lista directa -> foto grupal -> guardar)", async () => {
    const user = userEvent.setup();
    render(<AttendanceView project={mockProject} onQueueChanged={onQueueChanged} />);

    await screen.findByText("Carlos Méndez");

    // 3 Albañiles + 2 Ayudantes = 5 presentes = 40.0 HH iniciales
    const kpiStrip = screen.getByLabelText("Resumen global del proyecto");
    expect(kpiStrip).toHaveTextContent("3/3");
    expect(kpiStrip).toHaveTextContent("2/2");
    expect(kpiStrip).toHaveTextContent("40.0");

    // Marcar José López Parcial (4h), Luis Morales Ausente (Permiso) y +1h extra a Carlos Méndez
    // Total esperado: (8+1) + 4 + 0 + 8 + 8 = 29.0 HH
    const workerCards = screen.getAllByRole("article");
    await user.click(within(workerCards[1]).getByRole("button", { name: /Parcial/i }));
    await user.click(within(workerCards[2]).getByRole("button", { name: /Ausente/i }));
    await user.click(within(workerCards[2]).getByRole("button", { name: "Permiso" }));
    await user.click(within(workerCards[0]).getByRole("button", { name: /\+ Agregar extra/i }));

    expect(kpiStrip).toHaveTextContent("29.0");

    // Paso 1 -> Paso 2 (Foto grupal del proyecto)
    await user.click(screen.getByRole("button", { name: /Siguiente: Foto Grupal \(4 presentes\)/i }));
    expect(screen.getByText(/Reúna a los 4 trabajadores presentes/i)).toBeInTheDocument();

    const photoInput = document.getElementById("input-crew-photo") as HTMLInputElement;
    expect(photoInput).toHaveAttribute("accept", "image/*");
    expect(photoInput).toHaveAttribute("capture", "environment");

    const fakePhoto = new File(["fake-image-bytes"], "obra.jpg", { type: "image/jpeg" });
    await user.upload(photoInput, fakePhoto);

    await screen.findByText(/Foto lista con sello corporativo CFA/i);

    // Paso 2 -> Paso 3 (Resumen global)
    await user.click(screen.getByRole("button", { name: /Foto correcta: Confirmar/i }));
    expect(screen.getByText(/Resumen global del proyecto/i)).toBeInTheDocument();
    expect(screen.getByText("29.0 HH")).toBeInTheDocument();

    // Guardar asistencia global
    await user.click(screen.getByRole("button", { name: /Confirmar y Guardar \(29\.0 HH\)/i }));

    await waitFor(() => {
      expect(api.saveAttendance).toHaveBeenCalledTimes(1);
    });
    const [, savedPayload, savedPhoto] = vi.mocked(api.saveAttendance).mock.calls[0];
    expect(savedPayload.entries).toHaveLength(5);
    expect(savedPayload.entries[0].extra_hours).toBe(1);
    expect(savedPayload.entries[1].status).toBe("parcial");
    expect(savedPayload.entries[2].reason).toBe("Permiso");
    expect(savedPhoto).toBeInstanceOf(Blob);

    await screen.findByText(/Asistencia global registrada correctamente/i);
  });

  it("guarda en cola offline si falla la red en obra", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "saveAttendance").mockRejectedValueOnce(new Error("Sin señal"));
    const addOfflineSpy = vi.spyOn(offlineDb.pendingAttendance, "add").mockResolvedValueOnce(1);

    render(<AttendanceView project={mockProject} onQueueChanged={onQueueChanged} />);
    await screen.findByText("Carlos Méndez");

    await user.click(screen.getByRole("button", { name: /Siguiente: Foto Grupal/i }));
    await user.click(screen.getByRole("button", { name: /Continuar sin foto por ahora/i }));
    await user.click(screen.getByRole("button", { name: /Confirmar y Guardar/i }));

    await screen.findByText(/Asistencia global guardada en el teléfono \(Sin señal\)/i);
    expect(addOfflineSpy).toHaveBeenCalledTimes(1);
    expect(onQueueChanged).toHaveBeenCalledTimes(1);
  });
});
