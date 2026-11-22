import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { api } from "./api";
import { offlineDb } from "./db";
import type { Crew, Project } from "./types";

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
    id: 1,
    project_id: 1,
    name: "General",
    trade: "mamposteria",
    workers: [
      { id: 101, crew_id: 1, name: "Carlos Méndez", role: "Albañil", active: true },
      { id: 102, crew_id: 1, name: "Luis Morales", role: "Ayudante", active: true },
    ],
  },
];

describe("App — Inicio de sesión y vista exclusiva de Asistencias", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(api, "listProjects").mockResolvedValue([mockProject]);
    vi.spyOn(api, "getCrews").mockResolvedValue(mockCrews);
    vi.spyOn(api, "listAttendance").mockResolvedValue([]);
    vi.spyOn(offlineDb.pendingCaptures, "count").mockResolvedValue(0);
    vi.spyOn(offlineDb.pendingAttendance, "count").mockResolvedValue(0);
  });

  it("muestra login al inicio, rechaza clave inválida y al entrar muestra únicamente Asistencias", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "login")
      .mockRejectedValueOnce(new Error("Usuario o contraseña incorrectos"))
      .mockResolvedValueOnce({
        token: "tok-123",
        username: "maestro",
        display_name: "Maestro de Obra",
        role: "maestro",
        allowed_tabs: ["attendance"],
      });

    render(<App />);

    expect(screen.getByRole("heading", { name: /Iniciar Sesión/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Usuario/i), "maestro");
    await user.type(screen.getByLabelText(/Contraseña/i), "mal");
    await user.click(screen.getByRole("button", { name: /Entrar a Asistencia/i }));

    await screen.findByText(/Usuario o contraseña incorrectos/i);

    // Reintentar con contraseña correcta
    const passInput = screen.getByLabelText(/Contraseña/i);
    await user.clear(passInput);
    await user.type(passInput, "cfa2026");
    await user.click(screen.getByRole("button", { name: /Entrar a Asistencia/i }));

    await screen.findByText("Carlos Méndez");
    expect(screen.getByText(/Lista global —/i)).toBeInTheDocument();

    // No deben mostrarse los demás módulos por el momento
    expect(screen.queryByText(/Tablero y Aprobación/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Recorrido Guiado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Oficina \/ Ruta/i)).not.toBeInTheDocument();

    // Cerrar sesión regresa al login
    await user.click(screen.getByRole("button", { name: /Salir \(maestro\)/i }));
    await screen.findByRole("heading", { name: /Iniciar Sesión/i });
  });
});
