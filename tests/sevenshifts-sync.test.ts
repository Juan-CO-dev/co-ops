/**
 * Scheduling Phase 1, Task 7 — the sync run and its ledger. A fake fetch (routed by path), the
 * in-memory PostgREST fake (tests/fixtures/counts-fake-db.ts) plus a JS model of
 * reconcile_sevenshifts_user_snapshot (its SQL is proven in scripts/sql-harness-0268.mjs), a fake
 * clock and no real sleeps.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeDb } from "./fixtures/counts-fake-db";
import { ASSIGNMENTS_DOC_EXAMPLE, PAYLOAD } from "./fixtures/sevenshifts/payloads";
import { runSevenShiftsSync, SYNC_ORDER, type SyncDeps } from "@/lib/sevenshifts/sync";
import type { AuditInput } from "@/lib/audit";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("tests inject the db"); } }));

const TOKEN = "PLANTED-TOKEN-xyz";
const ENV = { SEVENSHIFTS_ACCESS_TOKEN: TOKEN, SEVENSHIFTS_SYNC: "1" };
const NOW = new Date("2026-10-15T18:00:00Z"); // 2:00 PM ET

type Row = Record<string, unknown>;
type Handler = (url: URL) => { status?: number; body?: unknown; headers?: Record<string, string> };
const list = (rows: unknown[], next: string | null = null) => ({ body: { data: rows, meta: { cursor: { next, prev: null } } } });

/** A healthy 7shifts with one user (501), one location, the documented assignments and wages. */
function healthyRoutes(over: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "/v2/whoami": () => ({ body: { object: "whoami", data: { identity_id: 1, users: [{ company_id: 1234 }] } } }),
    "/v2/company/1234/locations": () => list([PAYLOAD.locations]),
    "/v2/company/1234/departments": () => list([PAYLOAD.departments]),
    "/v2/company/1234/roles": () => list([PAYLOAD.roles]),
    "/v2/company/1234/users": () => list([PAYLOAD.users]),
    "/v2/company/1234/users/501/assignments": () => ({ body: ASSIGNMENTS_DOC_EXAMPLE }),
    "/v2/company/1234/users/501/wages": () => ({ body: PAYLOAD.wages }),
    "/v2/company/1234/labor_settings": () => ({ body: { object: "labor_settings", data: PAYLOAD.labor_settings } }),
    "/v2/company/1234/availabilities": () => list([PAYLOAD.availabilities]),
    "/v2/time_off": () => list([PAYLOAD.time_off]),
    "/v2/company/1234/shifts": () => list([PAYLOAD.shifts]),
    "/v2/company/1234/time_punches": (u) => list(u.searchParams.get("deleted") === "true" ? [] : [PAYLOAD.time_punches]),
    ...over,
  };
}

/** The JS model of the 0268 reconciler (same rules as the SQL: validate all, refresh/insert, retire only when complete). */
function reconcilerModel(tables: Record<string, Row[]>, calls: Row[]) {
  return async (fn: string, args: Row) => {
    if (fn !== "reconcile_sevenshifts_user_snapshot") return { data: null, error: { message: `unknown rpc ${fn}` } };
    calls.push(args);
    const { p_run, p_user, p_kind, p_complete, p_rows } = args as { p_run: string; p_user: string; p_kind: string; p_complete: boolean; p_rows: Row[] };
    const table = p_kind === "assignments" ? "sevenshifts_user_assignments" : "sevenshifts_wages";
    const list = (tables[table] ??= []);
    const ident = (r: Row) => (p_kind === "assignments" ? String(r.edge_key) : `${r.user_id}:${r.wage_id}:${r.upcoming}`);
    for (const r of p_rows) if (String(r.user_id) !== String(p_user)) return { data: null, error: { message: "invalid_payload" } };
    let inserted = 0;
    for (const r of p_rows) {
      const live = list.find((x) => x.active && ident(x) === ident(r));
      if (live) Object.assign(live, r, { last_seen_run: p_run });
      else { list.push({ ...r, active: true, first_seen_run: p_run, last_seen_run: p_run, retired_run: null }); inserted++; }
    }
    if (!p_complete) return { data: { seen: p_rows.length, inserted, retired: 0, refused_retire: "snapshot_incomplete" }, error: null };
    let retired = 0;
    for (const x of list) if (String(x.user_id) === String(p_user) && x.active && x.last_seen_run !== p_run) { x.active = false; x.retired_run = p_run; retired++; }
    return { data: { seen: p_rows.length, inserted, retired }, error: null };
  };
}

function world(opts: { routes?: Record<string, Handler>; tables?: Record<string, Row[]>; env?: Record<string, string>; abortAfterRequests?: number } = {}) {
  const tables: Record<string, Row[]> = {
    sevenshifts_sync_run_ids: [], sevenshifts_sync_runs: [], sevenshifts_sync_state: [], sevenshifts_users: [],
    sevenshifts_user_assignments: [], sevenshifts_wages: [], ...opts.tables,
  };
  const fake = createFakeDb(tables);
  const rpcCalls: Row[] = [];
  const db = { from: fake.client.from, rpc: reconcilerModel(tables, rpcCalls) } as unknown as SupabaseClient;
  const routes = opts.routes ?? healthyRoutes();
  const requests: URL[] = [];
  const sentAt: number[] = [];
  let clock = NOW.getTime();
  const ac = new AbortController();
  const audits: AuditInput[] = [];
  const deps: SyncDeps = {
    env: opts.env ?? ENV,
    db,
    fetch: async (url) => {
      const u = new URL(url);
      requests.push(u);
      sentAt.push(clock);
      if (opts.abortAfterRequests !== undefined && requests.length >= opts.abortAfterRequests) ac.abort();
      const h = routes[u.pathname];
      if (!h) return new Response("{}", { status: 404 });
      const r = h(u);
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
    },
    clock: () => clock,
    sleep: async (ms) => { clock += ms; },
    signal: ac.signal,
    audit: async (a) => { audits.push(a); },
    randomUUID: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`; })(),
  };
  return { tables, fake, deps, requests, sentAt, audits, rpcCalls, paths: () => requests.map((u) => u.pathname) };
}

const run = (w: ReturnType<typeof world>, trigger: "cron" | "manual" = "cron", requestedBy: string | null = null) =>
  runSevenShiftsSync({ trigger, requestedBy, deadlineMs: 110_000, now: NOW }, w.deps);
const ledger = (w: ReturnType<typeof world>) => w.tables.sevenshifts_sync_runs!;
const state = (w: ReturnType<typeof world>, resource: string) => w.tables.sevenshifts_sync_state!.find((r) => r.resource === resource);

describe("dormant without a token", () => {
  it("no token → ran:false token_missing, ZERO fetches, no ledger row, no heartbeat, no write", async () => {
    const w = world({ env: { SEVENSHIFTS_SYNC: "1" } });
    expect(await run(w)).toEqual({ ran: false, reason: "token_missing" });
    expect(w.requests).toHaveLength(0);
    expect(w.fake.writes).toEqual([]);
    expect(w.audits).toEqual([]);
  });
  it("a token with the switch off → ran:false sync_off, nothing read", async () => {
    const w = world({ env: { SEVENSHIFTS_ACCESS_TOKEN: TOKEN } });
    expect(await run(w)).toEqual({ ran: false, reason: "sync_off" });
    expect(w.requests).toHaveLength(0);
  });
});

describe("a healthy run", () => {
  it("reads in the fixed order: whoami → … → time_punches (per-user calls in the middle)", async () => {
    const w = world();
    const out = await run(w);
    expect(out).toMatchObject({ ran: true, status: "ok" });
    expect(w.paths()).toEqual([
      "/v2/whoami", "/v2/company/1234/locations", "/v2/company/1234/departments", "/v2/company/1234/roles",
      "/v2/company/1234/users", "/v2/company/1234/users/501/assignments", "/v2/company/1234/users/501/wages",
      "/v2/company/1234/labor_settings", "/v2/company/1234/availabilities", "/v2/time_off", "/v2/company/1234/shifts",
      "/v2/company/1234/time_punches", "/v2/company/1234/time_punches",
    ]);
    expect(SYNC_ORDER).toEqual(["locations", "departments", "roles", "users", "assignments", "wages", "labor_settings",
      "availabilities", "time_off", "shifts", "time_punches"]);
  });

  it("writes every mirror through MIRROR_WRITE_SPEC only (its conflict key), never deletes, drops PII", async () => {
    const w = world();
    await run(w);
    expect(w.tables.sevenshifts_users).toEqual([expect.objectContaining({ id: "501", employee_id: "EMP-12", first_name: "Ana" })]);
    expect(w.tables.sevenshifts_labor_settings).toEqual([expect.objectContaining({ company_id: "1234", daily_ot_threshold: 8, weekly_ot_threshold: 40 })]);
    expect(w.tables.sevenshifts_time_off).toEqual([expect.objectContaining({ id: "4001", hours: 4 })]);
    const written = JSON.stringify(w.fake.writes);
    for (const pii of ["planted@example.test", "+12025550199", "1990-01-31", "4471", "planted", "1999", "777"]) expect(written).not.toContain(pii);
    const tablesWritten = new Set(w.fake.writes.map((x) => x.table));
    expect([...tablesWritten].every((t) => t.startsWith("sevenshifts_"))).toBe(true);
    expect(tablesWritten.has("sevenshifts_user_assignments")).toBe(false); // only the reconciler writes those
  });

  it("the documented assignments payload goes client → normalizeAssignments → the reconciler: one live edge, status ok (never bad_pagination)", async () => {
    const w = world();
    const out = await run(w);
    const live = w.tables.sevenshifts_user_assignments!.filter((r) => r.active);
    expect(live.map((r) => [r.location_id, r.department_id, r.role_id])).toEqual([["4569", "7890", "2583"]]);
    expect(out).toMatchObject({ status: "ok" });
    expect(w.rpcCalls.find((c) => c.p_kind === "assignments")).toMatchObject({ p_user: "501", p_complete: true });
    expect(ledger(w)[0]!.results).toMatchObject({ assignments: { error_code: null } });
  });

  it("one ledger row (counts and fixed codes only) and one heartbeat", async () => {
    const w = world();
    await run(w);
    expect(ledger(w)).toHaveLength(1);
    const row = ledger(w)[0]!;
    expect(row).toMatchObject({ trigger: "cron", requested_by: null, status: "ok", company_id: "1234", requests: 13 });
    expect(row.id).toBe(w.tables.sevenshifts_sync_run_ids![0]!.id);
    expect(JSON.stringify(row.results)).not.toMatch(/Ana|Ruiz|http|PLANTED/);
    expect(w.audits).toHaveLength(1);
    expect(w.audits[0]).toMatchObject({ action: "cron.success", metadata: expect.objectContaining({ job: "sevenshifts-sync" }) });
  });

  it("a manual run names its requester and heartbeats as sevenshifts-sync-manual", async () => {
    const w = world();
    await run(w, "manual", "10000000-0000-4000-8000-000000000008");
    expect(ledger(w)[0]).toMatchObject({ trigger: "manual", requested_by: "10000000-0000-4000-8000-000000000008" });
    expect(w.audits[0]!.metadata.job).toBe("sevenshifts-sync-manual");
  });
});

describe("windows and watermarks", () => {
  it("a first run backfills shifts and punches from today − 90 days (ET instants), no modified_since", async () => {
    const w = world();
    await run(w);
    const shifts = w.requests.find((u) => u.pathname.endsWith("/shifts"))!;
    expect(shifts.searchParams.get("start[gte]")).toBe("2026-07-17T04:00:00Z");
    expect(shifts.searchParams.has("modified_since")).toBe(false);
    const punches = w.requests.find((u) => u.pathname.endsWith("/time_punches"))!;
    expect(punches.searchParams.get("clocked_in[lte]")).toBe("2026-10-16T03:59:59Z");
    expect(state(w, "shifts")).toMatchObject({ modified_watermark: NOW.toISOString(), last_error_code: null });
  });

  it("a later run uses modified_since = watermark − 48 h", async () => {
    const w = world({ tables: { sevenshifts_sync_state: [{ resource: "shifts", modified_watermark: "2026-10-14T18:00:00.000Z", last_success_at: "2026-10-14T18:00:00.000Z", last_error_code: null }] } });
    await run(w);
    const shifts = w.requests.find((u) => u.pathname.endsWith("/shifts"))!;
    expect(shifts.searchParams.get("modified_since")).toBe("2026-10-12T18:00:00Z");
    expect(w.requests.find((u) => u.pathname.endsWith("/time_punches"))!.searchParams.has("modified_since")).toBe(false); // punches had no watermark
  });
});

describe("fail-soft", () => {
  it("a 403 on availabilities is plan_forbidden for that resource only; the rest land; the run is partial", async () => {
    const w = world({ routes: healthyRoutes({ "/v2/company/1234/availabilities": () => ({ status: 403 }) }) });
    const out = await run(w);
    expect(out).toMatchObject({ status: "partial" });
    expect(ledger(w)[0]!.results).toMatchObject({ availabilities: { error_code: "plan_forbidden" }, shifts: { error_code: null } });
    expect(w.tables.sevenshifts_shifts).toHaveLength(1);
    expect(state(w, "availabilities")).toMatchObject({ last_error_code: "plan_forbidden" });
    expect(state(w, "availabilities")!.modified_watermark).toBeUndefined();
    expect(w.audits[0]!.action).toBe("cron.failure");
  });

  it("a 401 at whoami stops the run: failed, nothing else read, ledger + heartbeat still written", async () => {
    const w = world({ routes: healthyRoutes({ "/v2/whoami": () => ({ status: 401 }) }) });
    const out = await run(w);
    expect(out).toMatchObject({ status: "failed" });
    expect(w.paths()).toEqual(["/v2/whoami"]);
    expect(ledger(w)[0]).toMatchObject({ status: "failed", company_id: null });
    expect((ledger(w)[0]!.results as Row).whoami).toMatchObject({ error_code: "auth_failed" });
  });

  it("whoami listing several companies → failed, multi_company, nothing else is read", async () => {
    const w = world({ routes: healthyRoutes({ "/v2/whoami": () => ({ body: { object: "whoami", data: { users: [{ company_id: 1 }, { company_id: 2 }] } } }) }) });
    const out = await run(w);
    expect(out).toMatchObject({ status: "failed" });
    expect(w.paths()).toEqual(["/v2/whoami"]);
    expect((ledger(w)[0]!.results as Row).whoami).toMatchObject({ error_code: "multi_company" });
  });

  it("the deadline mid-resource: that resource is deadline, its watermark holds, and the ledger row is still written", async () => {
    // whoami, locations, departments, roles, users, assignments… → abort while users is being read
    const w = world({ abortAfterRequests: 5 });
    const out = await run(w);
    expect(out).toMatchObject({ ran: true, status: "partial" });
    const results = ledger(w)[0]!.results as Record<string, Row>;
    expect(results.roles).toMatchObject({ error_code: null });
    expect(results.time_punches).toMatchObject({ error_code: "deadline" });
    expect(state(w, "roles")).toMatchObject({ last_error_code: null });
    expect(state(w, "time_punches")).toMatchObject({ last_error_code: "deadline" });
    expect(state(w, "time_punches")!.modified_watermark).toBeUndefined();
    expect(w.audits).toHaveLength(1);
  });
});

describe("list resources: rejections and pagination never move the watermark", () => {
  it("a shifts page with one malformed row → skipped, the valid rows upserted, rejected_rows, watermark held", async () => {
    const bad = { ...PAYLOAD.shifts, id: 9002, start: "soon" };
    const w = world({
      routes: healthyRoutes({ "/v2/company/1234/shifts": () => list([PAYLOAD.shifts, bad]) }),
      tables: { sevenshifts_sync_state: [{ resource: "shifts", modified_watermark: "2026-10-14T18:00:00.000Z", last_error_code: null }] },
    });
    const out = await run(w);
    expect(out).toMatchObject({ status: "partial" });
    expect(ledger(w)[0]!.results).toMatchObject({ shifts: { rows: 1, skipped: 1, error_code: "rejected_rows" } });
    expect(w.tables.sevenshifts_shifts!.map((r) => r.id)).toEqual(["9001"]);
    expect(state(w, "shifts")).toMatchObject({ modified_watermark: "2026-10-14T18:00:00.000Z", last_error_code: "rejected_rows" });
  });

  it("(r1 P2-5) shifts page 1 fine, page 2 malformed meta → bad_pagination, page 1 upserted, watermark kept, partial", async () => {
    const w = world({
      routes: healthyRoutes({
        "/v2/company/1234/shifts": (u) => (u.searchParams.get("cursor") === "p2" ? { body: { data: [{ ...PAYLOAD.shifts, id: 9003 }], meta: { cursor: {} } } } : list([PAYLOAD.shifts], "p2")),
      }),
      tables: { sevenshifts_sync_state: [{ resource: "shifts", modified_watermark: "2026-10-14T18:00:00.000Z", last_error_code: null }] },
    });
    const out = await run(w);
    expect(out).toMatchObject({ status: "partial" });
    expect(ledger(w)[0]!.results).toMatchObject({ shifts: { rows: 1, pages: 1, error_code: "bad_pagination" } });
    expect(w.tables.sevenshifts_shifts!.map((r) => r.id)).toEqual(["9001"]);
    expect(state(w, "shifts")!.modified_watermark).toBe("2026-10-14T18:00:00.000Z");
  });

  it("chunk A review #2: a punch imported, then absent from the live pass and present in the deleted pass, ends deleted in the mirror", async () => {
    const w = world();
    await run(w);
    expect(w.tables.sevenshifts_time_punches).toEqual([expect.objectContaining({ id: "7001", deleted: false })]);
    const w2 = world({
      tables: { sevenshifts_time_punches: w.tables.sevenshifts_time_punches!.map((r) => ({ ...r })) },
      routes: healthyRoutes({ "/v2/company/1234/time_punches": (u) => list(u.searchParams.get("deleted") === "true" ? [{ ...PAYLOAD.time_punches, deleted: true }] : []) }),
    });
    await run(w2);
    expect(w2.tables.sevenshifts_time_punches).toEqual([expect.objectContaining({ id: "7001", deleted: true })]);
  });

  it("a 7shifts deleted:true shift updates the flag; nothing is ever deleted", async () => {
    const w = world({ routes: healthyRoutes({ "/v2/company/1234/shifts": () => list([{ ...PAYLOAD.shifts, deleted: true }]) }),
      tables: { sevenshifts_shifts: [{ id: "9001", deleted: false }] } });
    await run(w);
    expect(w.tables.sevenshifts_shifts).toEqual([expect.objectContaining({ id: "9001", deleted: true })]);
  });
});

describe("assignments and wages: reconciled per user, and rejections never retire (r2 #2)", () => {
  const twoRoles = (second: Row) => ({ object: "assignments", data: { locations: [{ id: 4569 }], departments: [{ id: 7890, location_id: 4569 }],
    roles: [{ id: 2583, location_id: 4569, department_id: 7890, is_primary: true }, second] } });
  const liveEdges = (w: ReturnType<typeof world>, user = "501") =>
    w.tables.sevenshifts_user_assignments!.filter((r) => r.active && r.user_id === user).map((r) => r.role_id).sort();

  it("(i) live {A,B}; the next snapshot has A valid and B malformed → p_complete=false, B stays live, incomplete_snapshot, watermark held", async () => {
    const w = world({ routes: healthyRoutes({ "/v2/company/1234/users/501/assignments": () => ({ body: twoRoles({ id: 2584, location_id: 4569, department_id: 7890 }) }) }) });
    await run(w);
    expect(liveEdges(w)).toEqual(["2583", "2584"]);
    const w2 = world({
      tables: { sevenshifts_user_assignments: w.tables.sevenshifts_user_assignments!.map((r) => ({ ...r })),
        sevenshifts_sync_state: [{ resource: "assignments", modified_watermark: "2026-10-14T18:00:00.000Z", last_error_code: null }] },
      routes: healthyRoutes({ "/v2/company/1234/users/501/assignments": () => ({ body: twoRoles({ id: "x2584", location_id: 4569, department_id: 7890 }) }) }),
    });
    const out = await run(w2);
    expect(w2.rpcCalls.find((c) => c.p_kind === "assignments")).toMatchObject({ p_complete: false });
    expect(liveEdges(w2)).toEqual(["2583", "2584"]);
    expect(out).toMatchObject({ status: "partial" });
    expect(ledger(w2)[0]!.results).toMatchObject({ assignments: { error_code: "incomplete_snapshot", failed_users: 1, skipped: 1 } });
    expect(state(w2, "assignments")!.modified_watermark).toBe("2026-10-14T18:00:00.000Z");
  });

  it("(ii) two users: only the one with a rejection is incomplete; the other reconciles completely (its removal IS retired)", async () => {
    const users = list([PAYLOAD.users, { ...PAYLOAD.users, id: 502, employee_id: "EMP-2" }]);
    const seed = [
      { edge_key: "501:4569:7890:2583", user_id: "501", role_id: "2583", active: true, last_seen_run: "old" },
      { edge_key: "502:4569:7890:2583", user_id: "502", role_id: "2583", active: true, last_seen_run: "old" },
      { edge_key: "502:4569:7890:2599", user_id: "502", role_id: "2599", active: true, last_seen_run: "old" },
    ];
    const w = world({ tables: { sevenshifts_user_assignments: seed },
      routes: healthyRoutes({
        "/v2/company/1234/users": () => users,
        "/v2/company/1234/users/501/assignments": () => ({ body: twoRoles({ id: "bad", location_id: 4569 }) }),
        "/v2/company/1234/users/502/assignments": () => ({ body: ASSIGNMENTS_DOC_EXAMPLE }),
        "/v2/company/1234/users/502/wages": () => ({ body: PAYLOAD.wages }),
      }) });
    await run(w);
    expect(w.rpcCalls.filter((c) => c.p_kind === "assignments").map((c) => [c.p_user, c.p_complete])).toEqual([["501", false], ["502", true]]);
    expect(liveEdges(w, "502")).toEqual(["2583"]); // 2599 retired
    expect(liveEdges(w, "501")).toEqual(["2583"]);
  });

  it("(iii) an ENTIRELY invalid snapshot → zero rows passed, p_complete=false, nothing retired", async () => {
    const w = world({ tables: { sevenshifts_user_assignments: [{ edge_key: "501:4569:7890:2583", user_id: "501", role_id: "2583", active: true, last_seen_run: "old" }] },
      routes: healthyRoutes({ "/v2/company/1234/users/501/assignments": () => ({ body: { object: "assignments", data: { locations: [{ id: "x" }], departments: [], roles: [{ id: -1 }] } } }) }) });
    await run(w);
    expect(w.rpcCalls.find((c) => c.p_kind === "assignments")).toMatchObject({ p_complete: false, p_rows: [] });
    expect(liveEdges(w)).toEqual(["2583"]);
  });

  it("(iv) a GENUINELY empty snapshot → p_complete=true, the live edges ARE retired", async () => {
    const w = world({ tables: { sevenshifts_user_assignments: [{ edge_key: "501:4569:7890:2583", user_id: "501", role_id: "2583", active: true, last_seen_run: "old" }] },
      routes: healthyRoutes({ "/v2/company/1234/users/501/assignments": () => ({ body: { object: "assignments", data: { locations: [], departments: [], roles: [] } } }) }) });
    const out = await run(w);
    expect(w.rpcCalls.find((c) => c.p_kind === "assignments")).toMatchObject({ p_complete: true, p_rows: [] });
    expect(liveEdges(w)).toEqual([]);
    expect(out).toMatchObject({ status: "ok" });
  });

  it("(v) wages: a malformed wage keeps the snapshot incomplete (nothing retired); an empty valid one retires", async () => {
    const seed = [{ user_id: "501", wage_id: "61", upcoming: false, active: true, last_seen_run: "old" }];
    const w = world({ tables: { sevenshifts_wages: seed.map((r) => ({ ...r })) },
      routes: healthyRoutes({ "/v2/company/1234/users/501/wages": () => ({ body: { data: { current_wages: [{ id: 62, wage_type: "daily", wage_cents: 1 }], upcoming_wages: [] } } }) }) });
    await run(w);
    expect(w.rpcCalls.find((c) => c.p_kind === "wages")).toMatchObject({ p_complete: false });
    expect(w.tables.sevenshifts_wages!.filter((r) => r.active)).toHaveLength(1);
    expect(ledger(w)[0]!.results).toMatchObject({ wages: { error_code: "incomplete_snapshot" } });
    const w2 = world({ tables: { sevenshifts_wages: seed.map((r) => ({ ...r })) },
      routes: healthyRoutes({ "/v2/company/1234/users/501/wages": () => ({ body: { data: { current_wages: [], upcoming_wages: [] } } }) }) });
    await run(w2);
    expect(w2.tables.sevenshifts_wages!.filter((r) => r.active)).toHaveLength(0);
  });

  it("a 5xx (or bad_snapshot) on one user's assignments → that user is never reconciled, nothing retired, partial, watermark held", async () => {
    for (const handler of [() => ({ status: 502 }), () => ({ body: { object: "assignments", data: { roles: {} } } })] as Handler[]) {
      const w = world({ tables: { sevenshifts_user_assignments: [{ edge_key: "501:4569:7890:2583", user_id: "501", role_id: "2583", active: true, last_seen_run: "old" }],
        sevenshifts_sync_state: [{ resource: "assignments", modified_watermark: "2026-10-14T18:00:00.000Z", last_error_code: null }] },
        routes: healthyRoutes({ "/v2/company/1234/users/501/assignments": handler }) });
      const out = await run(w);
      expect(w.rpcCalls.filter((c) => c.p_kind === "assignments")).toEqual([]);
      expect(liveEdges(w)).toEqual(["2583"]);
      expect(out).toMatchObject({ status: "partial" });
      expect(state(w, "assignments")!.modified_watermark).toBe("2026-10-14T18:00:00.000Z");
    }
  });

  it("per-user calls: this run's users plus the mirror's active users; an inactive, unmodified user is never passed to the reconciler", async () => {
    const w = world({
      tables: { sevenshifts_users: [{ id: "600", active: true }, { id: "700", active: false }] },
      routes: healthyRoutes({
        "/v2/company/1234/users/600/assignments": () => ({ body: { object: "assignments", data: { locations: [], departments: [], roles: [] } } }),
        "/v2/company/1234/users/600/wages": () => ({ body: { data: { current_wages: [], upcoming_wages: [] } } }),
      }),
    });
    await run(w);
    const users = new Set(w.rpcCalls.map((c) => c.p_user));
    expect(users).toEqual(new Set(["501", "600"]));
  });
});

describe("the rate budget", () => {
  it("over 60 users the sends never exceed 8 in any second or 500 in any minute (fake clock)", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ ...PAYLOAD.users, id: 1000 + i, employee_id: `E${i}` }));
    const routes = healthyRoutes({ "/v2/company/1234/users": () => list(many) });
    for (const u of many) {
      routes[`/v2/company/1234/users/${u.id}/assignments`] = () => ({ body: { object: "assignments", data: { locations: [], departments: [], roles: [] } } });
      routes[`/v2/company/1234/users/${u.id}/wages`] = () => ({ body: { data: { current_wages: [], upcoming_wages: [] } } });
    }
    const w = world({ routes });
    const out = await run(w);
    expect(out).toMatchObject({ status: "ok" });
    expect(w.sentAt.length).toBe(1 + 4 + 120 + 1 + 1 + 1 + 1 + 2);
    for (let i = 0; i < w.sentAt.length; i++) {
      const inSecond = w.sentAt.filter((t) => t >= w.sentAt[i]! && t < w.sentAt[i]! + 1000).length;
      const inMinute = w.sentAt.filter((t) => t >= w.sentAt[i]! && t < w.sentAt[i]! + 60_000).length;
      expect(inSecond).toBeLessThanOrEqual(8);
      expect(inMinute).toBeLessThanOrEqual(500);
    }
  });
});
