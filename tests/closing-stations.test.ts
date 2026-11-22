import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { closingStations, stationChanges, type StoredStation } from "@/lib/closing-stations-shared";
import { syncStationsFromClosing } from "@/lib/closing-stations";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { fakeSupabase } from "./helpers/fake-supabase";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

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
    expect(builder).toContain('await syncStationsFromClosing(src.location_id');
    expect(route).toContain('!["locationId", "id", "nameEs"].includes(key)');
    expect(page).toContain("await syncStationsFromClosing(selected.id, actor)");
  });

  // Nav PR 6 (plan r3, 8.9): both station day flags (0353) survive a sync: its writes never name them.
  it("the sync's insert and update payloads never carry starts_mid_day or not_phase_station", async () => {
    const shop = "11111111-1111-4111-8111-111111111111";
    const { client, calls } = fakeSupabase((c) => {
      if (c.table === "checklist_templates") return { data: [{ id: "t", effective_from: null, created_at: "2026-01-01T00:00:00Z" }] };
      if (c.table === "checklist_template_items") return { data: [
        { station: "Expo", display_order: 2, translations: null }, { station: "New", display_order: 3, translations: null }] };
      if (c.table === "stations" && c.kind === "select") return { data: [
        { id: "s-expo", name: "Expo", name_es: null, sort: 9, active: false }, { id: "s-old", name: "Old", name_es: null, sort: 1, active: true }] };
      if (c.kind !== "select") return { data: { id: "s-x" } };
      return { data: [] };
    });
    vi.mocked(getServiceRoleClient).mockReturnValue(client as never);
    await syncStationsFromClosing(shop, { userId: "u", role: "cgs", locations: [] });
    const writes = calls.filter((c) => c.table === "stations" && c.kind !== "select");
    expect(writes.map((c) => c.kind).sort()).toEqual(["insert", "update", "update"]);
    for (const w of writes) {
      const payload = JSON.stringify(w.arg(w.kind));
      expect(payload).not.toContain("starts_mid_day");
      expect(payload).not.toContain("not_phase_station");
    }
  });
});
