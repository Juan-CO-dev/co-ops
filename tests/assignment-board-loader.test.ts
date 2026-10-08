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

function client(inactive: boolean, removed: boolean) {
  const filters: Array<[string, string, unknown]> = [];
  const rpc = vi.fn(async () => ({ data: "2026-10-07", error: null }));
  const from = (table: string) => {
    const data = table === "users" ? [
      { id: kh, name: "KH", role: "key_holder", active: true },
      { id: employee, name: "Employee", role: "employee", active: !inactive },
    ] : table === "user_locations" ? [{ user_id: kh }, ...removed ? [] : [{ user_id: employee }]]
      : table === "report_assignments" ? [{ id: "assignment", report_type: "am_prep", assignee_id: employee, assigner_id: kh, note: null, created_at: "2026-10-08T12:00:00Z" }]
      : table === "station_events" ? [{ id: "event", sequence: "1", location_id: shop, business_date: "2026-10-07", user_id: kh,
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
  expect(f.filters).toContainEqual(["station_events", "business_date", "2026-10-07"]);
  expect(f.filters).toContainEqual(["report_assignments", "operational_date", "2026-10-08"]);
  expect(board.events[0]?.businessDate).toBe("2026-10-07");
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
