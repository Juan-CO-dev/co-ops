import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closingStations, stationChanges, type StoredStation } from "@/lib/closing-stations-shared";

describe("closing section stations", () => {
  it("orders by first display order, dedupes, and takes a later Spanish label", () => {
    expect(closingStations([
      { station: "Expo", display_order: 7, translations: null },
      { station: "Prep", display_order: 3, translations: { es: { station: "Preparación" } } },
      { station: "Expo", display_order: 9, translations: { es: { station: "Expedición" } } },
      { station: null, display_order: 1, translations: null },
    ])).toEqual([
      { name: "Prep", nameEs: "Preparación", sort: 3 },
      { name: "Expo", nameEs: "Expedición", sort: 7 },
    ]);
  });

  it("plans insert, update, deactivate and reactivate once", () => {
    const desired = [
      { name: "Prep", nameEs: "Preparación", sort: 3 },
      { name: "Expo", nameEs: null, sort: 7 },
      { name: "Walkout", nameEs: null, sort: 9 },
    ];
    const current: StoredStation[] = [
      { id: "1", name: "Prep", nameEs: null, sort: 8, active: false },
      { id: "2", name: "Expo", nameEs: "Expedición", sort: 7, active: true },
      { id: "3", name: "Old", nameEs: null, sort: 10, active: true },
    ];
    expect(stationChanges(desired, current)).toEqual([
      { operation: "update", section: desired[0], id: "1" },
      { operation: "insert", section: desired[2] },
      { operation: "deactivate", id: "3", name: "Old" },
    ]);
    const synced: StoredStation[] = [
      { id: "1", ...desired[0]!, active: true },
      current[1]!,
      { id: "4", ...desired[2]!, active: true },
      { ...current[2]!, active: false },
    ];
    expect(stationChanges(desired, synced)).toEqual([]);
  });

  it("hooks closing publish and rejects free-form station payloads", () => {
    const builder = readFileSync(new URL("../lib/admin/template-builder.ts", import.meta.url), "utf8");
    const route = readFileSync(new URL("../app/api/admin/stations/route.ts", import.meta.url), "utf8");
    const page = readFileSync(new URL("../app/admin/stations/page.tsx", import.meta.url), "utf8");
    expect(builder).toContain('if (src.type === "closing") await syncStationsFromClosing');
    expect(route).toContain('!["locationId", "id", "nameEs"].includes(key)');
    expect(page).toContain("await syncStationsFromClosing(selected.id, actor)");
  });
});
