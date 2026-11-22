import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { offlineDb } from "../db";
import type { Crew, Project } from "../types";
import { AttendanceView } from "./AttendanceView";

const mockProjects: Project[] = [
  {
    id: 1,
    name: "Casa Las Flores",
    location: "Casa Las Flores",
    geofence_lat: 14.6349,
    geofence_lng: -90.5069,
    geofence_radius_m: 100,
    north_offset_deg: 0,
    floorplan_svg: "<svg></svg>",
  },
  {
    id: 2,
    name: "Pia Pia",
    location: "Pia Pia",
    geofence_lat: 14.6349,
    geofence_lng: -90.5069,
    geofence_radius_m: 100,
    north_offset_deg: 0,
    floorplan_svg: "<svg></svg>",
  },
];

const mockCrewsByProject: Record<number, Crew[]> = {
  1: [
    {
      id: 10,
      project_id: 1,
      name: "Planilla Casa Las Flores",
      trade: "mamposteria",
      workers: [
        { id: 101, crew_id: 10, name: "Moises Mendoza", role: "Albañil", active: true },
        { id: 102, crew_id: 10, name: "Pablo Blass", role: "Ayudante", active: true },
        { id: 103, crew_id: 10, name: "Celestino", role: "Albañil", active: true },
      ],
    },
  ],
  2: [
    {
      id: 20,
      project_id: 2,
      name: "Planilla Pia Pia",
      trade: "mamposteria",
      workers: [
        { id: 201, crew_id: 20, name: "Manuel Reyes", role: "Albañil", active: true },
        { id: 202, crew_id: 20, name: "Jose Alcides Noguera", role: "Albañil", active: true },
        { id: 203, crew_id: 20, name: "Gabriel Mena", role: "Albañil", active: true },
      ],
    },
  ],
};

describe("AttendanceView — Asistencia Global Obligatoria (Casa Las Flores / Pia Pia)", () => {
  const onQueueChanged = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    onQueueChanged.mockReset();

    vi.spyOn(api, "getCrews").mockImplementation(async (pid) => mockCrewsByProject[pid] ?? []);
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

  it("inicia con todos sin marcar, obliga a marcar antes de avanzar y solo permite Albañil/Ayudante", async () => {
    const user = userEvent.setup();
    render(
      <AttendanceView
        project={mockProjects[0]}
        projects={mockProjects}
        onSelectProject={vi.fn()}
        onQueueChanged={onQueueChanged}
      />
    );

    await screen.findByText("Moises Mendoza");
    expect(screen.getByText("Pablo Blass")).toBeInTheDocument();
    expect(screen.getByText("Celestino")).toBeInTheDocument();

    // Todos inician sin marcar (0/2 Albañiles, 0/1 Ayudantes, 0.0 HH)
    const kpiStrip = screen.getByLabelText("Resumen global del proyecto");
    expect(kpiStrip).toHaveTextContent("0/2");
    expect(kpiStrip).toHaveTextContent("0/1");
    expect(kpiStrip).toHaveTextContent("0.0");
    expect(screen.getAllByText("Sin marcar")).toHaveLength(3);

    // Botón siguiente deshabilitado hasta marcar a todos
    const nextBtn = document.getElementById("btn-step1-next") as HTMLButtonElement;
    expect(nextBtn).toBeDisabled();
    expect(nextBtn).toHaveTextContent(/faltan 3/i);

    // Modo Sol Alto activado por defecto
    expect(document.getElementById("attendance-module")).toHaveClass("sun-boost");

    // Verificar cargos Albañil / Ayudante
    await user.click(screen.getByRole("button", { name: /\+ Nuevo trabajador/i }));
    const radioGroup = screen.getByRole("radiogroup", { name: /Cargo del trabajador/i });
    expect(within(radioGroup).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Albañil", "Ayudante"]);
  });

  it("obliga a marcar cada trabajador y completa el flujo (lista -> foto -> guardar)", async () => {
    const user = userEvent.setup();
    render(<AttendanceView project={mockProjects[0]} onQueueChanged={onQueueChanged} />);

    await screen.findByText("Moises Mendoza");

    const workerCards = screen.getAllByRole("article");
    // 1. Moises Mendoza -> Presente + 1h extra (9 HH)
    await user.click(within(workerCards[0]).getByRole("button", { name: /Presente/i }));
    await user.click(within(workerCards[0]).getByRole("button", { name: /\+ Agregar extra/i }));
    // 2. Pablo Blass (Ayudante) -> Parcial 4h (4 HH)
    await user.click(within(workerCards[1]).getByRole("button", { name: /Parcial/i }));
    // 3. Celestino -> Ausente (Permiso) (0 HH)
    await user.click(within(workerCards[2]).getByRole("button", { name: /Ausente/i }));
    await user.click(within(workerCards[2]).getByRole("button", { name: "Permiso" }));

    const kpiStrip = screen.getByLabelText("Resumen global del proyecto");
    expect(kpiStrip).toHaveTextContent("1/2");
    expect(kpiStrip).toHaveTextContent("1/1");
    expect(kpiStrip).toHaveTextContent("13.0");

    // Ahora sí habilita el botón para ir a Foto Grupal
    const nextBtn = screen.getByRole("button", { name: /Siguiente: Foto Grupal \(2 presentes\)/i });
    expect(nextBtn).toBeEnabled();
    await user.click(nextBtn);

    const photoInput = document.getElementById("input-crew-photo") as HTMLInputElement;
    await user.upload(photoInput, new File(["fake-image"], "obra.jpg", { type: "image/jpeg" }));
    await screen.findByText(/Foto lista con sello corporativo CFA/i);

    await user.click(screen.getByRole("button", { name: /Foto correcta: Confirmar/i }));
    await user.click(screen.getByRole("button", { name: /Confirmar y Guardar \(13\.0 HH\)/i }));

    await waitFor(() => {
      expect(api.saveAttendance).toHaveBeenCalledTimes(1);
    });
    await screen.findByText(/Asistencia global registrada correctamente/i);
  });

  it("guarda en cola offline si falla la red en obra", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "saveAttendance").mockRejectedValueOnce(new Error("Sin señal"));
    const addOfflineSpy = vi.spyOn(offlineDb.pendingAttendance, "add").mockResolvedValueOnce(1);

    render(<AttendanceView project={mockProjects[1]} onQueueChanged={onQueueChanged} />);
    await screen.findByText("Manuel Reyes");

    for (const card of screen.getAllByRole("article")) {
      await user.click(within(card).getByRole("button", { name: /Presente/i }));
    }

    await user.click(screen.getByRole("button", { name: /Siguiente: Foto Grupal/i }));
    await user.click(screen.getByRole("button", { name: /Continuar sin foto por ahora/i }));
    await user.click(screen.getByRole("button", { name: /Confirmar y Guardar/i }));

    await screen.findByText(/Asistencia global guardada en el teléfono \(Sin señal\)/i);
    expect(addOfflineSpy).toHaveBeenCalledTimes(1);
    expect(onQueueChanged).toHaveBeenCalledTimes(1);
  });
});
