import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { hasTaskAccess, loadShiftBoard } from "@/lib/assignments";
import { loadTakenTasks } from "@/lib/assignment-taken";
import { taskVisible } from "@/lib/assignments-shared";

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/assignment-taken", () => ({ loadTakenTasks: vi.fn(async () => []) }));
const shop = "11111111-1111-4111-8111-111111111111";
const kh = "22222222-2222-4222-8222-222222222222";
const employee = "33333333-3333-4333-8333-333333333333";
afterEach(() => { vi.useRealTimers(); vi.mocked(loadTakenTasks).mockResolvedValue([]); });

function client(inactive: boolean, removed: boolean, lifecycle = false) {
  const filters: Array<[string, string, unknown]> = [];
  const rpc = vi.fn(async (name: string) => ({ data: name === "station_business_date" ? "2026-10-07"
    : lifecycle ? [{ station_id: "station", closed_at: "2026-10-08T18:07:00Z" }] : [], error: null }));
  const from = (table: string) => {
    const data = table === "users" ? [
      { id: kh, name: "KH", role: "key_holder", active: true },
      { id: employee, name: "Employee", role: "employee", active: !inactive },
    ] : table === "user_locations" ? [{ user_id: kh }, ...removed ? [] : [{ user_id: employee }]]
      : lifecycle && table === "stations" ? [{ id: "station", name: "Line", name_es: "Línea", sort: 1, active: true, staffed: true, usually_closes_at: "14:00" }]
      : lifecycle && table === "station_positions" ? [{ id: "position", station_id: "station", name: "Lead", name_es: null, duty: null, duty_es: null, sort: 1, active: true, usually_trims_at: null }]
      : lifecycle && table === "station_break_events" ? [{ user_id: employee, on_break: true }]
      : lifecycle && table === "station_departures" ? [{ user_id: employee, out_at: "2026-10-08T19:12:00Z" }]
      : table === "report_assignments" ? [{ id: "assignment", report_type: "am_prep", assignee_id: employee, assigner_id: kh, note: null, created_at: "2026-10-08T12:00:00Z" }]
      : table === "station_events" ? lifecycle ? [
        { id: "assigned", sequence: "1", location_id: shop, business_date: "2026-10-07", user_id: employee,
          station_id: "station", position_id: "position", kind: "assign", actor_id: kh, at: "2026-10-08T16:00:00Z", source: "assigned" },
        { id: "released", sequence: "2", location_id: shop, business_date: "2026-10-07", user_id: employee,
          station_id: null, position_id: null, prior_position_id: "position", kind: "release", actor_id: null,
          at: "2026-10-08T19:13:00Z", effective_at: "2026-10-08T19:12:00Z", source: null, reason_code: "clocked_out" },
      ] : [{ id: "event", sequence: "1", location_id: shop, business_date: "2026-10-07", user_id: kh,
        station_id: "station", kind: "claim", actor_id: kh, at: "2026-10-08T04:15:00Z", source: "claimed" }]
      : [];
    const result = { data, error: null };
    const q = {
      select: () => q, order: () => q, in: () => q,
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); return q; },
      range: async () => result,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return q;
  };
  return { service: { from, rpc } as unknown as SupabaseClient, filters, rpc };
}

it("reads stations from the shop's resolved closing day after midnight, while task assignments retain their own day", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T04:15:00Z"));
  const f = client(false, false);
  const board = await loadShiftBoard(f.service, { actor: { userId: kh, role: "key_holder", level: 4, locations: [shop] }, locationId: shop, date: "2026-10-08" });
  expect(f.rpc).toHaveBeenCalledWith("station_business_date", { p_location_id: shop });
  expect(f.rpc).toHaveBeenCalledWith("station_closures", { p_location_id: shop, p_day: "2026-10-07" });
  expect(f.filters).toContainEqual(["station_events", "business_date", "2026-10-07"]);
  expect(f.filters).toContainEqual(["report_assignments", "operational_date", "2026-10-08"]);
  expect(board.events[0]?.businessDate).toBe("2026-10-07");
});

it("projects closures, hints, breaks and departures while suppressing pre-clock-out taken tasks", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T20:00:00Z"));
  vi.mocked(loadTakenTasks).mockResolvedValue([
    { id: "taken-before", task: "cash_report", userId: employee, at: "2026-10-08T19:00:00Z" },
  ]);
  const board = await loadShiftBoard(client(false, false, true).service, {
    actor: { userId: kh, role: "key_holder", level: 4, locations: [shop] }, locationId: shop, date: "2026-10-08",
  });
  expect(board.stations[0]).toMatchObject({ id: "station", closedAt: "2026-10-08T18:07:00Z", usuallyClosesAt: "14:00",
    positions: [{ id: "position", usuallyTrimsAt: null }] });
  expect(board.people.find((person) => person.id === employee)).toMatchObject({ onBreak: true, hasWork: true });
  expect(board.positionVacancies).toEqual([{ positionId: "position", userId: employee, name: "Employee",
    reason: "clocked_out", at: "2026-10-08T19:12:00Z" }]);
  expect(board.tasks.some((task) => task.id === "taken-before")).toBe(false);
});

it.each([2, 3])("level %s sees the whole team and attribution without owner filters", async (level) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
  const f = client(false, false);
  const board = await loadShiftBoard(f.service, { actor: { userId: employee, role: level === 2 ? "trainee" : "employee", level, locations: [shop] }, locationId: shop, date: "2026-10-08" });
  expect(board.people.map((person) => person.id)).toEqual(expect.arrayContaining([kh, employee]));
  expect(board.events[0]).toMatchObject({ userId: kh, actorName: "KH" });
  expect(board.tasks[0]).toMatchObject({ assigneeName: "Employee", assignerName: "KH", at: "2026-10-08T12:00:00Z", source: "assigned" });
  expect(f.filters.some(([table, key]) => (table === "station_events" && key === "user_id") || (table === "report_assignments" && key === "assignee_id"))).toBe(false);
});

it("includes persisted taken metadata without granting access below the task floor", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
  vi.mocked(loadTakenTasks).mockResolvedValue([{ id: "cash", task: "cash_report", userId: employee, at: "2026-10-08T14:00:00Z" }]);
  const f = client(false, false);
  const board = await loadShiftBoard(f.service, { actor: { userId: employee, role: "employee", level: 3, locations: [shop] }, locationId: shop, date: "2026-10-08" });
  expect(board.tasks).toContainEqual(expect.objectContaining({ id: "cash", source: "taken", assigneeName: "Employee" }));
  expect(await hasTaskAccess(f.service, { userId: employee, level: 3, locationId: shop, date: "2026-10-08", task: "cash_report" })).toBe(false);
});

it.each([[true, false], [false, true]])("keeps unavailable assignments retractable but excludes them from today's work (%s/%s)", async (inactive, removed) => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T16:00:00Z"));
  const f = client(inactive!, removed!);
  const board = await loadShiftBoard(f.service, { actor: { userId: kh, role: "key_holder", level: 4, locations: [shop] }, locationId: shop, date: "2026-10-08" });
  expect(board.tasks).toEqual([expect.objectContaining({ id: "assignment", available: false })]);
  expect(board.people.find((p) => p.id === employee)?.available).toBe(false);
  expect(taskVisible(3, "am_prep", board.tasks)).toBe(false);
});
