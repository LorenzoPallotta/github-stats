import { describe, it, expect } from "vitest";
import { computeStreaks, recentDays } from "../src/stats.js";

// Costruisce una dayMap da { "YYYY-MM-DD": conteggio }
const map = (obj) => new Map(Object.entries(obj));

describe("computeStreaks", () => {
  it("conta la streak attuale e quella più lunga", () => {
    const m = map({
      "2026-10-01": 1, "2026-10-02": 2, "2026-10-03": 3, // 3 giorni
      "2026-10-04": 0,
      "2026-10-05": 1, "2026-10-06": 1,                   // 2 giorni, fino a oggi
    });
    expect(computeStreaks(m, "2026-10-06")).toEqual({ current: 2, longest: 3 });
  });

  it("non rompe la streak se oggi è ancora a 0", () => {
    const m = map({ "2026-10-04": 1, "2026-10-05": 1, "2026-10-06": 0 });
    expect(computeStreaks(m, "2026-10-06")).toEqual({ current: 2, longest: 2 });
  });

  it("la streak attuale è 0 se ieri non ci sono contributi", () => {
    const m = map({ "2026-10-04": 5, "2026-10-05": 0, "2026-10-06": 0 });
    expect(computeStreaks(m, "2026-10-06")).toEqual({ current: 0, longest: 1 });
  });

  it("ignora i giorni dopo oggi", () => {
    const m = map({ "2026-10-06": 1, "2026-10-07": 1 });
    expect(computeStreaks(m, "2026-10-06")).toEqual({ current: 1, longest: 1 });
  });

  it("funziona senza dati", () => {
    expect(computeStreaks(new Map(), "2026-10-06")).toEqual({ current: 0, longest: 0 });
  });
});

describe("recentDays", () => {
  it("restituisce n giorni che finiscono oggi, con 0 dove mancano i dati", () => {
    const m = map({ "2026-10-06": 4, "2026-10-04": 2 });
    expect(recentDays(m, "2026-10-06", 4)).toEqual([0, 2, 0, 4]);
  });

  it("di default copre 53 settimane", () => {
    expect(recentDays(new Map(), "2026-10-06")).toHaveLength(371);
  });

  it("attraversa correttamente il cambio di mese e anno", () => {
    const m = map({ "2025-12-31": 1, "2026-01-01": 2 });
    expect(recentDays(m, "2026-01-01", 2)).toEqual([1, 2]);
  });
});
