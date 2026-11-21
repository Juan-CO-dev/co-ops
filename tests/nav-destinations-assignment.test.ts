/**
 * Nav PR 3 (plan r5, 4.11): assignment-dependent access, and parity with the real hasTaskAccess.
 *
 * The resolver's `assignedTasks` fact means exactly what hasTaskAccess counts (lib/assignments.ts): an active
 * assignment TODAY at the selected shop, the assignee still active and a member. The resolver mirrors its rule:
 * refused below TASK_MIN_LEVEL[task], always open from level 4, between the two only with an assignment.
 *
 * The parity test calls the REAL hasTaskAccess with a recording fake database client (no database is touched) and
 * asserts both its answer and the exact reads it makes, so a change in what it reads, or how, fails here loudly.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasTaskAccess } from "@/lib/assignments";
import { TASK_MIN_LEVEL, TASK_TYPES } from "@/lib/assignments-shared";
import { DESTINATIONS } from "@/lib/nav/destinations";
import { canSee } from "@/lib/nav/resolve";
import type { Destination, Facts, TaskType } from "@/lib/nav/types";
import { etCalendarDate } from "@/lib/operational-day";
import type { RoleCode } from "@/lib/roles";

const NOW = new Date("2026-11-18T15:00:00.000Z");
const USER = "11111111-1111-4111-8111-111111111111";
const SHOP = "22222222-2222-4222-8222-222222222222";
/** One role per level, 0..10. */
const ROLE_AT: Record<number, RoleCode> = { 0: "prospect", 1: "hired_not_yet_worked", 2: "trainee", 3: "employee", 4: "key_holder", 5: "shift_lead", 6: "agm", 7: "gm", 8: "moo", 9: "owner", 10: "cgs" };

const task = (t: TaskType): Destination => {
  const d = DESTINATIONS.find((x) => x.task === t);
  if (!d) throw new Error(`no destination for ${t}`);
  return d;
};
const FIRST3 = ["opening_report", "am_prep", "mid_day_prep"] as const satisfies readonly TaskType[];
const AT4 = ["cash_report", "pm_report", "ordering", "receiving", "counts"] as const satisfies readonly TaskType[];
const every = new Set<TaskType>(TASK_TYPES);
const see = (role: RoleCode, level: number, t: TaskType, facts?: Facts) => canSee(task(t), { role, level, switches: {} }, facts);

describe("4.11 resolver cases (at a member shop; switches are irrelevant)", () => {
  it.each([
    ["employee (3), no facts", "employee", 3, undefined, false, false],
    ["employee (3), assigned that task", "employee", 3, "that", true, false],
    ["employee (3), assigned a different task", "employee", 3, "other", false, false],
    ["trainee (2), assigned every task", "trainee", 2, "every", false, false],
    ["key holder (4), no facts", "key_holder", 4, undefined, true, true],
    ["key holder (4), every task", "key_holder", 4, "every", true, true],
  ] as const)("%s", (_name, role, level, which, first3, at4) => {
    for (const t of [...FIRST3, ...AT4]) {
      const facts: Facts | undefined = which === undefined ? undefined
        : which === "that" ? { assignedTasks: new Set([t]) }
        : which === "other" ? { assignedTasks: new Set(TASK_TYPES.filter((x) => x !== t)) }
        : { assignedTasks: every };
      expect(see(role, level, t, facts), `${t}`).toBe((FIRST3 as readonly TaskType[]).includes(t) ? first3 : at4);
    }
  });

  it("the eight task destinations: floor 4, assignment from TASK_MIN_LEVEL", () => {
    for (const t of TASK_TYPES) expect([task(t).access.minLevel, task(t).access.assignedFrom], t).toEqual([4, TASK_MIN_LEVEL[t]]);
  });
});

interface Call { table: string; select: string; filters: [string, unknown][]; terminal: string }

/** A recording fake of the three reads hasTaskAccess makes. */
function fakeClient(args: { assigneeRole: RoleCode; member: boolean; assigned: boolean }) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: "", filters: [], terminal: "" };
      calls.push(call);
      const answer = () => {
        if (table === "users") return { data: { role: args.assigneeRole }, error: null };
        if (table === "user_locations") return { data: args.member ? { user_id: USER } : null, error: null };
        if (table === "report_assignments") return { data: args.assigned ? { id: "a1" } : null, error: null };
        throw new Error(`unexpected table ${table}`);
      };
      const builder = {
        select(cols: string) { call.select = cols; return builder; },
        eq(col: string, value: unknown) { call.filters.push([col, value]); return builder; },
        limit(n: number) { call.filters.push(["limit", n]); return builder; },
        maybeSingle() { call.terminal = "maybeSingle"; return Promise.resolve(answer()); },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("4.11 parity with the real hasTaskAccess (a recording fake client)", () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterAll(() => { vi.useRealTimers(); });

  it.each(TASK_TYPES.map((t) => [t] as const))("%s: every level 0..10, assigned or not", async (t) => {
    const date = etCalendarDate(new Date().toISOString());
    for (let level = 0; level <= 10; level++) for (const assigned of [false, true]) {
      const role = ROLE_AT[level]!;
      const { client, calls } = fakeClient({ assigneeRole: role, member: true, assigned });
      const real = await hasTaskAccess(client, { userId: USER, level, locationId: SHOP, date, task: t });
      const facts: Facts = assigned ? { assignedTasks: new Set([t]) } : {};
      expect(see(role, level, t, facts), `${t} level ${level} assigned ${assigned}`).toBe(real);
      const expectedCalls: Call[] = level >= 4 || level < TASK_MIN_LEVEL[t] ? [] : [
        { table: "users", select: "role", filters: [["id", USER], ["active", true]], terminal: "maybeSingle" },
        ...(level < 9 ? [{ table: "user_locations", select: "user_id", filters: [["user_id", USER], ["location_id", SHOP], ["active", true]] as [string, unknown][], terminal: "maybeSingle" }] : []),
        { table: "report_assignments", select: "id", filters: [["assignee_id", USER], ["report_type", t], ["location_id", SHOP], ["operational_date", date], ["active", true], ["limit", 1]], terminal: "maybeSingle" },
      ];
      expect(calls, `${t} level ${level} assigned ${assigned}`).toEqual(expectedCalls);
    }
  });

  it("an assignment on another day confers nothing (the fact means TODAY, as hasTaskAccess counts it)", async () => {
    const { client, calls } = fakeClient({ assigneeRole: "employee", member: true, assigned: true });
    expect(await hasTaskAccess(client, { userId: USER, level: 3, locationId: SHOP, date: "2026-11-17", task: "opening_report" })).toBe(false);
    expect(calls).toEqual([]);
  });
});
