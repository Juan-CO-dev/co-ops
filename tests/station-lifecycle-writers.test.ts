import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveStationTiming, writeStationBreak, type AssignmentActor } from "@/lib/assignments";
import { audit } from "@/lib/audit";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const PERSON = "44444444-4444-4444-8444-444444444444";
const STATION = "55555555-5555-4555-8555-555555555555";
const POSITION = "66666666-6666-4666-8666-666666666666";
const actor: AssignmentActor = { userId: ACTOR, role: "key_holder", level: 4, locations: [SHOP] };

function fake(opts: { role?: string; member?: boolean; rpcError?: string; updateMissing?: boolean; queryError?: boolean; changed?: boolean } = {}) {
  const filters: Array<[string, string, unknown]> = [];
  const updates: Array<{ table: string; row: unknown }> = [];
  const from = vi.fn((table: string) => {
    const q = {
      select: () => q,
      update: (row: unknown) => { updates.push({ table, row }); return q; },
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      gt: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      maybeSingle: async () => ({
        data: table === "users" ? { role: opts.role ?? "employee" }
          : table === "user_locations" ? (opts.member === false ? null : { user_id: PERSON })
            : opts.updateMissing ? null : { id: table === "station_positions" ? POSITION : STATION },
        error: opts.queryError ? { message: "provider detail", code: "XX000" } : null,
      }),
    };
    return q;
  });
  const rpc = vi.fn(async () => ({
    data: { id: "77777777-7777-4777-8777-777777777777", changed: opts.changed ?? true },
    error: opts.rpcError ? { message: opts.rpcError } : null,
  }));
  return { service: { from, rpc } as unknown as SupabaseClient, from, rpc, filters, updates };
}

afterEach(() => vi.clearAllMocks());

describe("writeStationBreak", () => {
  it("allows self-service without an override reason and sends only the break RPC shape", async () => {
    const f = fake({ role: "key_holder" });
    await expect(writeStationBreak(f.service, { actor, locationId: SHOP, userId: ACTOR, onBreak: true }))
      .resolves.toEqual({ id: "77777777-7777-4777-8777-777777777777" });
    expect(f.rpc).toHaveBeenCalledWith("write_station_break", {
      p_actor_id: ACTOR, p_user_id: ACTOR, p_location_id: SHOP, p_on_break: true,
    });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "station.break",
      metadata: { location_id: SHOP, user_id: ACTOR, on_break: true } }));
  });

  it("binds the shop, validates shape, and permits KH management only at or below their role", async () => {
    for (const args of [
      { actor, locationId: OTHER, userId: PERSON, onBreak: true },
      { actor, locationId: SHOP, userId: "bad", onBreak: true },
      { actor, locationId: SHOP, userId: PERSON, onBreak: "yes" as unknown as boolean },
    ]) await expect(writeStationBreak(fake().service, args)).rejects.toThrow();
    const employee = { ...actor, role: "employee" as const, level: 3 };
    await expect(writeStationBreak(fake().service, { actor: employee, locationId: SHOP, userId: PERSON, onBreak: true }))
      .rejects.toMatchObject({ code: "role_insufficient" });
    await expect(writeStationBreak(fake({ role: "gm" }).service, { actor, locationId: SHOP, userId: PERSON, onBreak: true }))
      .rejects.toMatchObject({ code: "role_insufficient" });
  });

  it("maps known RPC refusals, hides unknown database details, and skips audit on no-op", async () => {
    await expect(writeStationBreak(fake({ role: "employee", rpcError: "on_break" }).service,
      { actor, locationId: SHOP, userId: PERSON, onBreak: true })).rejects.toMatchObject({ code: "on_break" });
    await expect(writeStationBreak(fake({ role: "employee", rpcError: "sensitive db text" }).service,
      { actor, locationId: SHOP, userId: PERSON, onBreak: true })).rejects.toThrow("assignments database failure");
    vi.mocked(audit).mockClear();
    await writeStationBreak(fake({ role: "employee", changed: false }).service,
      { actor, locationId: SHOP, userId: PERSON, onBreak: false });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("saveStationTiming", () => {
  it("writes station close and later-position trim hints with location and parent binds", async () => {
    const station = fake({ role: "key_holder" });
    await saveStationTiming(station.service, { actor, locationId: SHOP, stationId: STATION, usuallyClosesAt: "14:00" });
    expect(station.updates).toEqual([{ table: "stations", row: { usually_closes_at: "14:00" } }]);
    expect(station.filters).toContainEqual(["stations", "location_id", SHOP]);

    const position = fake({ role: "key_holder" });
    await saveStationTiming(position.service, { actor, locationId: SHOP, stationId: STATION, positionId: POSITION, usuallyTrimsAt: "16:00:00" });
    expect(position.updates).toEqual([{ table: "station_positions", row: { usually_trims_at: "16:00:00" } }]);
    expect(position.filters).toEqual(expect.arrayContaining([
      ["station_positions", "id", POSITION], ["station_positions", "station_id", STATION],
      ["station_positions", "sort", 1], ["station_positions", "location_id", SHOP],
    ]));
  });

  it("requires a live KH+, rejects crossed/invalid fields, and maps zero rows and DB errors", async () => {
    await expect(saveStationTiming(fake().service, { actor: { ...actor, level: 3, role: "employee" }, locationId: SHOP, stationId: STATION, usuallyClosesAt: "14:00" }))
      .rejects.toMatchObject({ code: "role_insufficient" });
    for (const args of [
      { actor, locationId: SHOP, stationId: STATION, usuallyClosesAt: "2 PM" },
      { actor, locationId: SHOP, stationId: STATION, usuallyTrimsAt: "14:00" },
      { actor, locationId: SHOP, stationId: STATION, positionId: POSITION, usuallyClosesAt: "14:00" },
    ]) await expect(saveStationTiming(fake({ role: "key_holder" }).service, args)).rejects.toMatchObject({ code: "invalid_payload" });
    await expect(saveStationTiming(fake({ role: "key_holder", updateMissing: true }).service,
      { actor, locationId: SHOP, stationId: STATION, usuallyClosesAt: null })).rejects.toMatchObject({ code: "station_unavailable", status: 404 });
    await expect(saveStationTiming(fake({ role: "key_holder", queryError: true }).service,
      { actor, locationId: SHOP, stationId: STATION, usuallyClosesAt: null })).rejects.toThrow("assignments database failure");
  });
});
