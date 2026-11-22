import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

describe("api — Modo PHP en hosting propio", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("construye URLs de query válidas para crews y attendance sin codificar & ni =", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("action=health")) {
        return new Response(JSON.stringify({ ok: true, mode: "php" }), { status: 200 });
      }
      if (url === "./api.php?action=crews&project_id=1") {
        return new Response(JSON.stringify([{ id: 1, project_id: 1, name: "Planilla", trade: "mamposteria", workers: [{ id: 1, crew_id: 1, name: "Moises Mendoza", role: "Albañil", active: true }] }]), { status: 200 });
      }
      if (url === "./api.php?action=attendance&project_id=1") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: false, error: `URL inesperada: ${url}` }), { status: 400 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const crews = await api.getCrews(1);
    expect(crews).toHaveLength(1);
    expect(crews[0].workers[0].name).toBe("Moises Mendoza");

    const att = await api.listAttendance(1);
    expect(att).toEqual([]);
  });
});
