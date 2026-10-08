import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { loadShiftBoard } from "@/lib/assignments";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/assignment-taken", () => ({ loadTakenTasks: vi.fn(async () => []) }));

const shop = "11111111-1111-4111-8111-111111111111";
const otherShop = "99999999-9999-4999-8999-999999999999";
const gm = "22222222-2222-4222-8222-222222222222"; // manager: never clocks in, holds a station
const cook = "33333333-3333-4333-8333-333333333333"; // clocked in through Toast
const closer = "44444444-4444-4444-8444-444444444444"; // signed in, then ended shift
const moo = "66666666-6666-4666-8666-666666666666";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

function client() {
  const filters: Array<[string, string, unknown]> = [];
  const rows: Record<string, unknown[]> = {
    users: [
      { id: gm, name: "Gina Manager", role: "gm", active: true },
      { id: cook, name: "Carl Cook", role: "employee", active: true },
      { id: closer, name: "Cleo Closer", role: "key_holder", active: true },
      { id: moo, name: "Mo Ops", role: "moo", active: true },
    ],
    user_locations: [
      { user_id: gm, location_id: shop }, { user_id: cook, location_id: shop }, { user_id: closer, location_id: shop },
      { user_id: moo, location_id: shop }, { user_id: moo, location_id: otherShop },
    ],
    stations: [{ id: "station", name: "Line", name_es: "Línea", sort: 1, active: true, staffed: true, usually_closes_at: null }],
    station_positions: [{ id: "position", station_id: "station", name: "Lead", name_es: null, duty: null, duty_es: null, sort: 1, active: true, usually_trims_at: null }],
    station_events: [
      { id: "e1", sequence: "1", location_id: shop, business_date: "2026-10-08", user_id: gm, station_id: "station", position_id: "position",
        kind: "claim", actor_id: gm, at: "2026-10-08T14:00:00Z", source: "claimed" },
      { id: "e2", sequence: "2", location_id: shop, business_date: "2026-10-08", user_id: closer, station_id: null, position_id: null,
        prior_position_id: "position2", kind: "release", actor_id: closer, at: "2026-10-08T17:00:00Z", effective_at: "2026-10-08T17:00:00Z", source: null, reason_code: "ended_shift" },
    ],
    assignment_changes: [
      { assignment_id: "a1", report_type: "counts", actor_id: closer, kind: "auto_release", created_at: "2026-10-08T17:00:00Z", reason_code: "ended_shift",
        reason_note: null, overridden_assigner_id: null, subject_user_id: closer, effective_at: "2026-10-08T17:00:00Z" },
      { assignment_id: "a2", report_type: "pm_report", actor_id: null, kind: "auto_release", created_at: "2026-10-08T17:30:00Z", reason_code: "shop_closed",
        reason_note: null, overridden_assigner_id: null, subject_user_id: cook, effective_at: "2026-10-08T17:30:00Z" },
    ],
    toast_time_entries: [{ user_id: cook, in_at: "2026-10-08T13:58:00Z", out_at: null }],
    shift_ends: [{ user_id: closer, kind: "ended_shift", at: "2026-10-08T17:00:00Z" }],
    sessions: [
      { user_id: closer, created_at: "2026-10-08T12:00:00Z" },
      { user_id: moo, created_at: "2026-10-08T12:30:00Z" },
    ],
  };
  const rpc = vi.fn(async (name: string) => ({ data: name === "station_business_date" ? "2026-10-08" : [], error: null }));
  const from = (table: string) => {
    let inFilter: unknown[] | null = null;
    const result = () => {
      let data = rows[table] ?? [];
      // sessions are only asked for the single-shop members; mirror the .in() filter.
      if (table === "sessions" && inFilter) data = data.filter((r) => inFilter!.includes((r as { user_id: string }).user_id));
      return { data, error: null };
    };
    const q = {
      select: () => q, order: () => q, not: () => q, gte: () => q,
      in: (key: string, values: unknown[]) => { if (key === "user_id") inFilter = values; return q; },
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      range: async () => result(),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return q;
  };
  return { service: { from, rpc } as unknown as SupabaseClient, filters };
}

it("without WHOS_HERE the board is byte-for-byte the 0230 board (no presence, no 0233 reads)", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T18:00:00Z"));
  const f = client();
  const board = await loadShiftBoard(f.service, { actor: { userId: gm, role: "gm", level: 7, locations: [shop] }, locationId: shop, date: "2026-10-08" });
  expect(board.whosHere).toBeUndefined();
  expect(board.people.every((p) => p.presence === undefined)).toBe(true);
  expect(f.filters.some(([table]) => table === "shift_ends" || table === "toast_time_entries")).toBe(false);
});

it("shows who is on shift and how we know: Toast clock, CO-OPS activity, ended shift; multi-shop sign-ins need a hold", async () => {
  vi.stubEnv("WHOS_HERE", "1");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T18:00:00Z"));
  const board = await loadShiftBoard(client().service, { actor: { userId: gm, role: "gm", level: 7, locations: [shop] }, locationId: shop, date: "2026-10-08" });
  expect(board.whosHere).toBe(true);
  const by = (id: string) => board.people.find((p) => p.id === id)!.presence;
  expect(by(cook)).toEqual({ onShift: true, source: "toast_clock", since: "2026-10-08T13:58:00Z" });
  expect(by(gm)).toEqual({ onShift: true, source: "coops_activity", since: "2026-10-08T14:00:00Z", activity: "station" });
  expect(by(closer)).toEqual({ onShift: false, source: "coops_activity", since: null, off: { reason: "ended_shift", at: "2026-10-08T17:00:00Z" } });
  // A two-shop manager's sign-in does not place them at this shop.
  expect(by(moo)).toEqual({ onShift: false, source: null, since: null });
});

it("End my shift leaves the 'ended shift' trail; the shop's close is not a vacancy", async () => {
  vi.stubEnv("WHOS_HERE", "1");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T18:00:00Z"));
  const board = await loadShiftBoard(client().service, { actor: { userId: gm, role: "gm", level: 7, locations: [shop] }, locationId: shop, date: "2026-10-08" });
  expect(board.taskVacancies).toEqual([{ task: "counts", userId: closer, name: "Cleo Closer", at: "2026-10-08T17:00:00Z", reason: "ended_shift" }]);
  expect(board.positionVacancies).toEqual([{ positionId: "position2", userId: closer, name: "Cleo Closer", reason: "ended_shift", at: "2026-10-08T17:00:00Z" }]);
  expect(board.events.find((e) => e.id === "e2")).toMatchObject({ releaseReason: "ended_shift", change: undefined });
});
