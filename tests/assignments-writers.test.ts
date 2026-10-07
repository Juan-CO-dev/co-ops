import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditTaskOverride, assignTask, hasTaskAccess, retractTask, saveStation, writeStationEvent, type AssignmentActor } from "@/lib/assignments";
import { audit } from "@/lib/audit";
import { ROLES } from "@/lib/roles";
import { TASK_TYPES, TASK_MIN_LEVEL } from "@/lib/assignments-shared";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER_SHOP = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const TARGET = "44444444-4444-4444-8444-444444444444";
const STATION = "55555555-5555-4555-8555-555555555555";
const ASSIGNMENT = "66666666-6666-4666-8666-666666666666";
const actor: AssignmentActor = { userId: ACTOR, role: "key_holder", level: 4, locations: [SHOP] };

function fake(options: { role?: string; inactive?: boolean; rpcCode?: string; member?: boolean; assignment?: boolean; otherAssignment?: boolean; queryError?: boolean; rpcError?: string; stationMissing?: boolean } = {}) {
  const filters: Array<[string, string, unknown]> = [];
  const writes: Array<{ table: string; kind: string; row: unknown }> = [];
  const from = vi.fn((table: string) => {
    let assigneeFiltered = false;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([table, key, value]); if (key === "assignee_id") assigneeFiltered = true; return query; },
      limit: () => query,
      neq: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: options.otherAssignment ? [{ id: ASSIGNMENT, assignee_id: TARGET }] : [], error: null }).then(resolve),
      update: (row: unknown) => { writes.push({ table, kind: "update", row }); return query; },
      insert: (row: unknown) => { writes.push({ table, kind: "insert", row }); return query; },
      maybeSingle: async () => ({ data: table === "users" ? (options.inactive ? null : { role: options.role ?? "employee" })
        : table === "user_locations" ? (options.member === false ? null : { user_id: TARGET })
        : table === "report_assignments" ? (options.assignment || (!assigneeFiltered && options.otherAssignment) ? { id: ASSIGNMENT } : null)
        : table === "stations" ? (options.stationMissing ? null : { id: STATION }) : null, error: options.queryError ? { message: "query failed" } : null }),
    };
    return query;
  });
  const rpc = vi.fn(async () => ({ data: { id: ASSIGNMENT, changed: true }, error: options.rpcError ? { message: options.rpcError, code: options.rpcCode } : null }));
  return { service: { from, rpc } as unknown as SupabaseClient, from, rpc, filters, writes };
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("assignment writer front doors", () => {
  it.each(TASK_TYPES)("refuses assigning %s below its floor before RPC", async (task) => {
    const f = fake({ role: TASK_MIN_LEVEL[task] === 4 ? "employee" : "trainee" });
    await expect(assignTask(f.service, { actor, locationId: SHOP, userId: TARGET, task })).rejects.toMatchObject({ code: "role_insufficient" });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("binds all four writers to the actor's shop before database access", async () => {
    const f = fake();
    const common = { actor, locationId: OTHER_SHOP };
    const calls = [
      () => writeStationEvent(f.service, { ...common, userId: TARGET, stationId: STATION }),
      () => assignTask(f.service, { ...common, userId: TARGET, task: "am_prep" }),
      () => retractTask(f.service, { ...common, assignmentId: ASSIGNMENT }),
      () => saveStation(f.service, { ...common, name: "Station", nameEs: "Estación", sort: 0, active: true }),
    ];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "location_access_denied" });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("refuses employee assignment of others and self task assignment before I/O", async () => {
    const f = fake();
    const employee: AssignmentActor = { ...actor, level: 3, role: "employee" };
    await expect(writeStationEvent(f.service, { actor: employee, locationId: SHOP, userId: TARGET, stationId: STATION })).rejects.toMatchObject({ code: "role_insufficient" });
    await expect(assignTask(f.service, { actor: employee, locationId: SHOP, userId: TARGET, task: "am_prep" })).rejects.toMatchObject({ code: "role_insufficient" });
    await expect(retractTask(f.service, { actor: employee, locationId: SHOP, assignmentId: ASSIGNMENT })).rejects.toMatchObject({ code: "role_insufficient" });
    await expect(assignTask(f.service, { actor, locationId: SHOP, userId: ACTOR, task: "am_prep" })).rejects.toMatchObject({ code: "self_assignment" });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it("allows peer assignment, refuses upward assignment, and checks active location membership", async () => {
    const peer = fake({ role: "trainer" });
    await expect(assignTask(peer.service, { actor, locationId: SHOP, userId: TARGET, task: "cash_report" })).resolves.toEqual({ id: ASSIGNMENT });
    expect(peer.rpc).toHaveBeenCalledWith("write_task_assignment", expect.objectContaining({ p_user_id: TARGET, p_location_id: SHOP, p_task: "cash_report" }));
    expect(peer.filters).toContainEqual(["users", "active", true]);
    expect(peer.filters).toContainEqual(["user_locations", "location_id", SHOP]);
    expect(peer.filters).toContainEqual(["user_locations", "active", true]);
    for (const f of [fake({ role: "shift_lead" }), fake({ member: false })]) {
      await expect(assignTask(f.service, { actor, locationId: SHOP, userId: TARGET, task: "am_prep" })).rejects.toThrow();
      expect(f.rpc).not.toHaveBeenCalled();
    }
  });
  it("allows a self claim but honors the serialized RPC assignment lock on a stale claim", async () => {
    const employee: AssignmentActor = { ...actor, level: 3, role: "employee" };
    const f = fake({ rpcError: "station_locked" });
    await expect(writeStationEvent(f.service, { actor: employee, locationId: SHOP, userId: ACTOR, stationId: STATION })).rejects.toMatchObject({ code: "station_locked", status: 403 });
    expect(f.rpc).toHaveBeenCalledWith("write_station_event", { p_actor_id: ACTOR, p_user_id: ACTOR, p_location_id: SHOP, p_station_id: STATION, p_manage: false });
  });
  it("permits a KH self claim but refuses an employee's manage flag before I/O", async () => {
    const f = fake();
    await expect(writeStationEvent(f.service, { actor: { ...actor, level: 3, role: "employee" }, locationId: SHOP, userId: ACTOR, stationId: STATION, manage: true })).rejects.toMatchObject({ code: "role_insufficient" });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    const kh = fake({ role: "key_holder" });
    await writeStationEvent(kh.service, { actor, locationId: SHOP, userId: ACTOR, stationId: STATION, manage: true });
    expect(kh.rpc).toHaveBeenCalledWith("write_station_event", expect.objectContaining({ p_actor_id: ACTOR, p_user_id: ACTOR, p_manage: true }));
  });
  it.each([false, true])("refuses a KH's own assigned station even with manage=%s", async (manage) => {
    const f = fake({ role: "key_holder", rpcError: "station_locked" });
    await expect(writeStationEvent(f.service, { actor, locationId: SHOP, userId: ACTOR, stationId: null, manage }))
      .rejects.toMatchObject({ code: "station_locked", status: 403 });
    expect(audit).not.toHaveBeenCalled();
  });
  it("retracts by RPC without deleting history, and propagates missing assignment", async () => {
    const f = fake();
    await retractTask(f.service, { actor, locationId: SHOP, assignmentId: ASSIGNMENT });
    expect(f.rpc).toHaveBeenCalledWith("write_task_assignment", expect.objectContaining({ p_assignment_id: ASSIGNMENT, p_location_id: SHOP, p_user_id: null }));
    expect(f.writes).toEqual([]);
    const missing = fake({ rpcError: "assignment_not_found" });
    await expect(retractTask(missing.service, { actor, locationId: SHOP, assignmentId: ASSIGNMENT })).rejects.toMatchObject({ status: 404 });
  });
  it("requires GM for registry writes and refuses a zero-row station update", async () => {
    const args = { actor, locationId: SHOP, id: STATION, name: "Station", nameEs: "Estación", sort: 0, active: false };
    const f = fake();
    await expect(saveStation(f.service, args)).rejects.toMatchObject({ code: "role_insufficient" });
    expect(f.from).not.toHaveBeenCalled();
    const missing = fake({ role: "gm", stationMissing: true });
    await expect(saveStation(missing.service, { ...args, actor: { ...actor, role: "gm", level: 7 } })).rejects.toMatchObject({ code: "station_unavailable", status: 404 });
    expect(missing.filters).toContainEqual(["stations", "location_id", SHOP]);
    expect(missing.writes).toEqual([{ table: "stations", kind: "update", row: { name: "Station", name_es: "Estación", sort: 0, active: false } }]);
  });
});

describe("task enforcement decision", () => {
  it("requires today's active assignment for the exact person, shop and task", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    const args = { userId: TARGET, level: 3, locationId: SHOP, date: "2026-10-07", task: "mid_day_prep" as const };
    const f = fake({ assignment: true });
    expect(await hasTaskAccess(f.service, args)).toBe(true);
    expect(f.filters.filter(([table]) => table === "report_assignments")).toEqual([
      ["report_assignments", "assignee_id", TARGET], ["report_assignments", "report_type", "mid_day_prep"],
      ["report_assignments", "location_id", SHOP], ["report_assignments", "operational_date", "2026-10-07"],
      ["report_assignments", "active", true],
    ]);
    expect(await hasTaskAccess(fake().service, args)).toBe(false);
    const stale = fake({ assignment: true });
    expect(await hasTaskAccess(stale.service, { ...args, date: "2026-10-06" })).toBe(false);
    expect(stale.from).not.toHaveBeenCalled();
    expect(await hasTaskAccess(stale.service, { ...args, level: 4 })).toBe(true);
    expect(stale.from).not.toHaveBeenCalled();
  });
  it.each(TASK_TYPES)("checks floor at use even with a stored %s assignment", async (task) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    const f = fake({ assignment: true });
    expect(await hasTaskAccess(f.service, { userId: TARGET, level: TASK_MIN_LEVEL[task] - 1, locationId: SHOP, date: "2026-10-07", task })).toBe(false);
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([4, 5, 6, 7, 9, 10])("level %s can act on any assignment and historical task", async (level) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    const args = { userId: TARGET, level, locationId: SHOP, date: "2026-10-07", task: "cash_report" as const };
    expect(await hasTaskAccess(fake().service, args)).toBe(true);
    expect(await hasTaskAccess(fake({ otherAssignment: true }).service, args)).toBe(true);
    expect(await hasTaskAccess(fake({ assignment: true, otherAssignment: true }).service, args)).toBe(true);
    expect(await hasTaskAccess(fake().service, { ...args, date: "2026-10-06" })).toBe(true);
  });
  it("fails closed on a failed assignment read", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    await expect(hasTaskAccess(fake({ queryError: true }).service, { userId: TARGET, level: 3, locationId: SHOP, date: "2026-10-07", task: "am_prep" })).rejects.toThrow();
  });
});

describe("authored migration security contracts (not live SQL integration)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0217_assignments_stations.sql", import.meta.url), "utf8").toLowerCase();
  it("refuses past-shop-day retractions under the row lock before touching history", () => {
    const retract = sql.split("if p_assignment_id is not null then")[1]!.split("if v_task is null")[0]!;
    expect(retract).toMatch(/for update;[\s\S]*if v_row\.operational_date < public\.station_business_date\(p_location_id\) then\s+raise exception 'assignment_not_found';\s+end if;[\s\S]*update public\.report_assignments/);
    // Strict less-than preserves the current operational day and future rows,
    // including a still-open prior calendar day after midnight.
    expect(retract).not.toContain("operational_date <=");
    expect(retract).not.toContain("clock_timestamp()");
  });
  it("locks assigned stations for every holder without a management escape", () => {
    expect(sql).toMatch(/if p_actor_id=p_user_id and v_previous\.station_id is not null and v_previous\.source='assigned' then\s+raise exception 'station_locked'/);
    expect(sql).not.toContain("if not p_manage and p_actor_id=p_user_id");
    expect(sql).toContain("when p_actor_id=p_user_id then 'claimed' else 'assigned'");
  });
  it("denies staff access to the ledgers and service-role mutation of station history", () => {
    expect(sql).toContain("alter table public.station_events enable row level security");
    expect(sql).toContain("revoke all on public.stations, public.station_events from public, anon, authenticated");
    expect(sql).toContain("revoke update, delete, truncate on public.station_events from service_role");
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.(station_events|report_assignments)/);
    expect(sql).toContain("update public.report_assignments set active=false");
  });
  it("hardens every new definer RPC and verifies effective grants", () => {
    for (const fn of ["assignment_user_level", "station_business_date", "write_station_event", "write_task_assignment"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^;]+from public,anon,authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^;]+to service_role`));
    }
    expect(sql.match(/security definer set search_path=pg_catalog,public/g)).toHaveLength(4);
    expect(sql).toContain("information_schema.routine_privileges");
  });
  it("serializes an empty station head and duplicate task creates, preserving one live task", () => {
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('station/'");
    expect(sql).toContain("pg_advisory_xact_lock(hashtextextended('task/'");
    expect(sql).toContain("order by sequence desc limit 1");
    expect(sql).toContain("v_previous.source='assigned'");
    expect(sql).toContain("report_assignments(location_id,operational_date,assignee_id,report_type) where active");
  });
  it("enforces the assignment floor in SQL as well as the API", () => {
    expect(sql).toContain("v_target < (case when v_task in ('am_prep','mid_day_prep','opening_report') then 3 else 4 end) then");
    for (const task of TASK_TYPES) expect(sql).toContain(`'${task}'`);
  });
});


describe("pass 3 assignment behavior", () => {
  it.each(["opening_report", "am_prep", "mid_day_prep"] as const)("KH always retains %s, employees need a live assignment", async (task) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-07T16:00:00Z"));
    const args = { userId: TARGET, level: 3, locationId: SHOP, date: "2026-10-07", task };
    expect(await hasTaskAccess(fake().service, args)).toBe(false);
    expect(await hasTaskAccess(fake({ assignment: true }).service, args)).toBe(true);
    for (const options of [{ inactive: true }, { member: false }]) {
      expect(await hasTaskAccess(fake({ ...options, assignment: true }).service, args)).toBe(false);
    }
    expect(await hasTaskAccess(fake({ otherAssignment: true }).service, { ...args, level: 4 })).toBe(true);
  });
  it("allows KH override and records the other assignee, operation and shop", async () => {
    const f = fake({ otherAssignment: true });
    const args = { ...actor, locationId: SHOP, date: "2026-10-06", task: "am_prep" as const, operation: "prep.correct" };
    expect(await hasTaskAccess(f.service, args)).toBe(true);
    await auditTaskOverride(f.service, args);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "task.override", actorId: ACTOR,
      metadata: expect.objectContaining({ operation: "prep.correct", location_id: SHOP, operational_date: "2026-10-06", assignments: [{ id: ASSIGNMENT, assignee_id: TARGET }] }) }));
  });
  it.each([{ inactive: true }, { member: false }, { role: "shift_lead" }])("retract never revalidates an unavailable/senior assignee: %o", async (options) => {
    const f = fake(options);
    await expect(retractTask(f.service, { actor, locationId: SHOP, assignmentId: ASSIGNMENT })).resolves.toEqual({ id: ASSIGNMENT });
    expect(f.from).not.toHaveBeenCalled();
  });
  it("maps an active-assignment race to a clear 409", async () => {
    const f = fake({ rpcError: "duplicate key", rpcCode: "23505" });
    await expect(assignTask(f.service, { actor, locationId: SHOP, userId: TARGET, task: "am_prep" })).rejects.toMatchObject({ code: "assignment_already_active", status: 409 });
  });
  it("pins every SQL role mapping to the full canonical roles registry", () => {
    const sql = readFileSync(new URL("../supabase/migrations/0217_assignments_stations.sql", import.meta.url), "utf8");
    const body = sql.split("v_level := case v_role")[1]!.split("end;")[0]!;
    const mapped = Object.fromEntries([...body.matchAll(/when '([^']+)' then (\d+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(mapped).toEqual(Object.fromEntries(Object.values(ROLES).map((r) => [r.code, r.level])));
  });
});
