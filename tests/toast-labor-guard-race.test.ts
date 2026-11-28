/**
 * The two-pull race (CC ruling D-R2), through the app, on REAL SQL.
 *
 * The REAL `runToastLaborPull` runs twice, overlapping; Toast is mocked per pull; the service client double executes
 * on ONE PGlite database built from the REAL 0224, the REAL section A of 0233 and the REAL 0361 (the base
 * scripts/sql-harness-0361.mjs builds; replicated here because the harness runs on import):
 *   - rpc("toast_time_entries_apply_newer", { p_rows }) runs the REAL function (`select public.toast_time_entries_apply_newer($1::jsonb)`
 *     with JSON.stringify(p_rows), as service_role). The double only RELAYS its argument and returns { data, error }.
 *   - upsert(rows, { onConflict }) runs MAIN's statement in PostgREST's shape (json_populate_recordset + on conflict do
 *     update of every sent column). The OFF control only, never the proof of the guard.
 * PGlite is one connection, so the overlap is made at the APP level: each pull has its own Toast responses and a gate;
 * the held pull's write waits on a real promise until the other pull has completely finished. No fake timers.
 * Pulls are told apart by their AbortSignal (each run makes its own and hands it to every read and write).
 * Synthetic names only.
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runToastLaborPull, type LaborGuardCounts, type LaborPullResult } from "@/lib/toast/labor";
import { laborPullOutcome } from "@/lib/report-digests-v2";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet } from "@/lib/toast/client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/client", () => ({ toastGet: vi.fn() }));

const GUARDED = "toast_time_entries_apply_newer";
const PG_TIMEOUT = 180_000;

// ── the base database (the harness's base, replicated) ──────────────────────────────────────────────

const read = (n: string) => readFileSync(new URL(`../supabase/migrations/${n}`, import.meta.url), "utf8");
const M0224 = read("0224_toast_time_entries.sql");
const M0233 = read("0233_whos_here.sql");
const M0361 = read("0361_toast_time_entries_newer.sql");

function sectionA(): string {
  const A_START = "create table public.toast_employee_links (";
  const A_END = "-- ── B.";
  const iStart = M0233.indexOf(A_START);
  const iEnd = M0233.indexOf(A_END);
  if (iStart < 0 || iEnd < 0 || iEnd <= iStart) throw new Error(`race: 0233 section A anchors not found (start ${iStart}, end ${iEnd})`);
  const s = M0233.slice(iStart, iEnd);
  for (const needle of [
    "create function public.toast_time_entry_link_user()",
    "create trigger toast_time_entries_link_user before insert or update on public.toast_time_entries",
    "create trigger toast_time_entries_link_lock before insert or update on public.toast_time_entries",
    "create function public.link_toast_employee(",
    "create function public.unlink_toast_employee(",
  ]) if (!s.includes(needle)) throw new Error(`race: 0233 section A extraction lacks: ${needle}`);
  if (!s.trimEnd().endsWith("end $$;")) throw new Error("race: 0233 section A does not end with unlink_toast_employee's body");
  return s;
}

/** Stubs of the two level helpers section A calls (as in scripts/sql-harness-0361.mjs). */
const LEVEL_STUBS = `
create function public.assignment_author_level(p_user_id uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_role text;
begin
  select role into v_role from public.users where id = p_user_id;
  return case v_role when 'cgs' then 10 when 'owner' then 9 when 'moo' then 8 when 'gm' then 7 when 'agm' then 6
    when 'shift_lead' then 5 when 'key_holder' then 4 when 'employee' then 3 else null end;
end $$;
create function public.assignment_user_level(p_user_id uuid, p_location_id uuid) returns integer
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_level integer;
begin
  v_level := public.assignment_author_level(p_user_id);
  if v_level is null or not exists (select 1 from public.users where id = p_user_id and active) then raise exception 'assignee_unavailable'; end if;
  if v_level < 9 and not exists (select 1 from public.user_locations where user_id = p_user_id and location_id = p_location_id and active) then
    raise exception 'assignee_not_at_location';
  end if;
  return v_level;
end $$;`;

const L1 = "00000000-0000-4000-8000-000000000001";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.locations (id uuid primary key default gen_random_uuid(), code text, active boolean not null default true);
    create table public.users (id uuid primary key default gen_random_uuid(), role text not null, active boolean not null default true);
    create table public.user_locations (user_id uuid not null references public.users(id), location_id uuid not null references public.locations(id),
      active boolean not null default true, primary key (user_id, location_id));
    insert into public.locations (id, code) values ('${L1}', 'S1');`);
  await db.exec(M0224);
  await db.exec(`begin; ${LEVEL_STUBS}\n${sectionA()}\ncommit;`);
  await db.exec(M0361);
  await db.exec("set timezone to 'UTC'");
  const fn = await db.query<{ n: number }>("select count(*)::int as n from pg_proc where proname = 'toast_time_entries_apply_newer'");
  if (fn.rows[0]?.n !== 1) throw new Error("race: 0361 did not install its function");
  const trg = await db.query<{ n: number }>("select count(*)::int as n from pg_trigger where tgrelid = 'public.toast_time_entries'::regclass and not tgisinternal");
  if (trg.rows[0]?.n !== 2) throw new Error("race: 0233 section A triggers missing");
}, PG_TIMEOUT);
afterAll(async () => { await db?.close(); });

// ── the SQL behind the doubles (one connection: every statement is serialized) ──────────────────────

let sqlChain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = sqlChain.then(fn, fn);
  sqlChain = next.catch(() => {});
  return next;
}
async function asService<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec("begin; set local role service_role;");
  try {
    const v = await fn();
    await db.exec("commit");
    return v;
  } catch (e) {
    await db.exec("rollback");
    throw e;
  }
}
const pgError = (e: unknown) => ({ message: e instanceof Error ? e.message : String(e), code: (e as { code?: string }).code ?? "XX000" });

/** The REAL 0361 function; the double only relays its argument. */
const realRpc = (args: { p_rows: unknown }) => serial(async () => {
  try {
    const r = await asService(() => db.query<{ r: unknown }>("select public.toast_time_entries_apply_newer($1::jsonb) as r", [JSON.stringify(args.p_rows)]));
    return { data: r.rows[0]?.r ?? null, error: null };
  } catch (e) { return { data: null, error: pgError(e) }; }
});

/** MAIN's statement in PostgREST's upsert shape: every sent column inserted, and every sent column set on conflict. */
const realUpsert = (rows: Array<Record<string, unknown>>, opts: { onConflict?: string }) => serial(async () => {
  try {
    if (opts.onConflict !== "location_id,time_entry_guid") throw new Error(`race: unexpected onConflict ${String(opts.onConflict)}`);
    const first = rows[0];
    if (!first) throw new Error("race: empty upsert");
    const cols = Object.keys(first);
    if (!rows.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(cols))) throw new Error("race: rows with different keys");
    if (!cols.every((c) => /^[a-z_]+$/.test(c))) throw new Error("race: unexpected column name");
    const list = cols.join(", ");
    await asService(() => db.query(
      `insert into public.toast_time_entries (${list}) select ${list} from json_populate_recordset(null::public.toast_time_entries, $1::json)
       on conflict (location_id, time_entry_guid) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
      [JSON.stringify(rows)]));
    return { data: null, error: null };
  } catch (e) { return { data: null, error: pgError(e) }; }
});

// ── the pulls ───────────────────────────────────────────────────────────────────────────────────────

interface Pull {
  name: string;
  day: unknown[];
  modified: unknown[];
  /** The pull's FIRST write waits on this before it reaches the database. */
  hold: Promise<void> | null;
  writes: number;
}
const bySignal = new Map<AbortSignal, Pull>();
let registering: Pull | null = null;
const rpcLog: Array<{ pull: string; name: string }> = [];
const upsertLog: Array<{ pull: string; rows: number }> = [];
/** The order in which the pulls' writes reached the database. */
const landed: string[] = [];

function pullOf(signal: AbortSignal | undefined): Pull {
  const p = signal ? bySignal.get(signal) : undefined;
  if (!p) throw new Error("race: a read or write with an unregistered signal");
  return p;
}
function gated<T>(p: Pull, fn: () => Promise<T>): Promise<T> {
  p.writes += 1;
  const hold = p.writes === 1 ? p.hold : null;
  return (async () => {
    if (hold) await hold;
    landed.push(p.name);
    return fn();
  })();
}

interface LocationsQuery {
  select(): LocationsQuery; eq(): LocationsQuery; not(): LocationsQuery; in(): LocationsQuery; returns(): LocationsQuery;
  abortSignal(signal: AbortSignal): LocationsQuery;
  then(resolve: (v: unknown) => void): void;
}

function makeClient(): ReturnType<typeof getServiceRoleClient> {
  const client = {
    from(table: string) {
      if (table === "locations") {
        const q: LocationsQuery = {
          select: () => q, eq: () => q, not: () => q, in: () => q, returns: () => q,
          abortSignal: (signal: AbortSignal) => {
            // Runs synchronously inside runToastLaborPull's first tick: this is where a pull's signal is learned.
            if (!bySignal.has(signal)) {
              if (!registering) throw new Error("race: a pull started with nobody registering");
              bySignal.set(signal, registering);
              registering = null;
            }
            return q;
          },
          then(resolve: (v: unknown) => void) { resolve({ data: [{ id: L1, toast_restaurant_guid: "rest-1" }], error: null }); },
        };
        return q;
      }
      if (table !== "toast_time_entries") throw new Error(`race: unexpected table ${table}`);
      return {
        upsert: (rows: Array<Record<string, unknown>>, opts: { onConflict?: string }) => ({
          abortSignal: (signal: AbortSignal) => {
            const p = pullOf(signal);
            upsertLog.push({ pull: p.name, rows: rows.length });
            return gated(p, () => realUpsert(rows, opts));
          },
        }),
      };
    },
    rpc(name: string, args: { p_rows: unknown }) {
      return {
        abortSignal: (signal: AbortSignal) => {
          const p = pullOf(signal);
          rpcLog.push({ pull: p.name, name });
          if (name !== GUARDED) throw new Error(`race: unexpected rpc ${name}`);
          return gated(p, () => realRpc(args));
        },
      };
    },
  };
  return client as unknown as ReturnType<typeof getServiceRoleClient>;
}

const D = "2026-10-07";
const NOW = new Date("2026-10-08T15:00:00.000Z"); // D is not ET today: no reconcile
const OPTS = { deadlineMs: 120_000, context: "digest" as const, now: NOW };

function start(p: Pull): Promise<LaborPullResult> {
  registering = p;
  const run = runToastLaborPull([D], OPTS);
  if (registering !== null) throw new Error(`race: pull ${p.name} did not register its signal synchronously`);
  return run;
}
const pull = (name: string, day: unknown[], modified: unknown[]): Pull => ({ name, day, modified, hold: null, writes: 0 });

/** `held`'s first write waits until `free` has completely finished; then it is released. */
async function race(held: Pull, free: Pull): Promise<{ held: LaborPullResult; free: LaborPullResult }> {
  let release!: () => void;
  held.hold = new Promise<void>((r) => { release = r; });
  const ph = start(held);
  const pf = start(free);
  const rf = await pf;
  // The held pull has NOT reached the database while the free pull ran to completion.
  expect(landed).toEqual(landed.map(() => free.name));
  expect(landed.length).toBeGreaterThan(0);
  release();
  const rh = await ph;
  expect(landed.at(-1)).toBe(held.name);
  return { held: rh, free: rf };
}

// ── the fixture: ONE entry, three versions ──────────────────────────────────────────────────────────

const GUID = "race-entry-1";
const M1 = "2026-10-07T16:00:00.000+0000";
const M2 = "2026-10-07T20:05:00.000+0000";
const M3 = "2026-10-08T09:00:00.000+0000";
const IN = "2026-10-07T12:00:00.000+0000";
const ident = { guid: GUID, businessDate: "20261007", employeeReference: { guid: "emp-testa" }, jobReference: { guid: "job-line" }, inDate: IN };
const OPEN = { ...ident, deleted: false, breaks: [], outDate: null, modifiedDate: M1 };
const CLOSED = { ...ident, deleted: false, breaks: [], outDate: "2026-10-07T20:00:00.000+0000", regularHours: 8, overtimeHours: 0, modifiedDate: M2 };
const ARCHIVED = { guid: GUID, deleted: true, employeeReference: { guid: "emp-testa" }, inDate: IN, businessDate: "20261007", modifiedDate: M2 };
const CORRECTED = { ...ident, deleted: false, breaks: [], outDate: "2026-10-07T20:30:00.000+0000", regularHours: 8.5, overtimeHours: 0, modifiedDate: M3 };

beforeEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  vi.stubEnv("STATION_LIFECYCLE", undefined);
  bySignal.clear();
  registering = null;
  rpcLog.length = 0;
  upsertLog.length = 0;
  landed.length = 0;
  await serial(() => db.exec("delete from public.toast_time_entries"));
  vi.mocked(getServiceRoleClient).mockImplementation(() => makeClient());
  vi.mocked(toastGet).mockImplementation((async (path: string, guid: string, signal?: AbortSignal) => {
    if (guid !== "rest-1") throw new Error(`race: unexpected restaurant ${guid}`);
    const p = pullOf(signal);
    if (path === "/labor/v1/jobs") return [{ guid: "job-line", title: "Line Cook" }];
    if (path === "/labor/v1/employees") return [{ guid: "emp-testa", firstName: "Testa" }];
    if (path === "/labor/v1/timeEntries?businessDate=20261007") return structuredClone(p.day);
    if (path.startsWith("/labor/v1/timeEntries?modifiedStartDate=") && path.endsWith("&includeArchived=true")) return structuredClone(p.modified);
    throw new Error(`race: unexpected path ${path}`);
  }) as typeof toastGet);
});

const counts = (partial: Partial<LaborGuardCounts>): LaborGuardCounts => ({
  received: 1, inserted: 0, updated: 0, unchanged: 0, skipped_same_stamp: 0, skipped_older: 0, skipped_no_stamp: 0, duplicates: 0, ...partial,
});

interface StoredRow { out_at: string | null; hours: number | null; deleted: boolean; source_modified_at: string | null }
async function storedRow(): Promise<StoredRow> {
  const r = await serial(() => db.query<{ out_at: unknown; hours: number | null; deleted: boolean; source_modified_at: unknown; n: number }>(
    `select out_at, hours::float8 as hours, deleted, source_modified_at, (select count(*)::int from public.toast_time_entries) as n
       from public.toast_time_entries where location_id = $1 and time_entry_guid = $2`, [L1, GUID]));
  const row = r.rows[0];
  if (!row) throw new Error("race: no stored row");
  expect(row.n).toBe(1);
  const iso = (x: unknown): string | null => (x === null ? null : x instanceof Date ? x.toISOString() : new Date(String(x)).toISOString());
  return { out_at: iso(row.out_at), hours: row.hours, deleted: row.deleted, source_modified_at: iso(row.source_modified_at) };
}
const STORED_OPEN: StoredRow = { out_at: null, hours: null, deleted: false, source_modified_at: "2026-10-07T16:00:00.000Z" };
const STORED_CLOSED: StoredRow = { out_at: "2026-10-07T20:00:00.000Z", hours: 8, deleted: false, source_modified_at: "2026-10-07T20:05:00.000Z" };
const STORED_ARCHIVED: StoredRow = { out_at: null, hours: null, deleted: true, source_modified_at: "2026-10-07T20:05:00.000Z" };
const STORED_CORRECTED: StoredRow = { out_at: "2026-10-07T20:30:00.000Z", hours: 8.5, deleted: false, source_modified_at: "2026-10-08T09:00:00.000Z" };

/** Every result row ok, the read counts as main has them, the digest outcome ok. */
function expectOk(r: LaborPullResult, dayRows: number, modified: number) {
  expect(r.ran).toBe(true);
  expect(r.results).toEqual([{ locationId: L1, businessDate: D, ok: true, rows: dayRows, skipped: 0 }]);
  expect(r.results.every((x) => x.ok)).toBe(true);
  expect(r.modified).toBe(modified);
  expect(laborPullOutcome(r)).toEqual({ ok: true, connected: true });
}

/** A third pull, alone, with a genuinely newer stamped correction (m3 > m2). */
async function thirdPullCorrects() {
  const c = pull("C", [CORRECTED], []);
  const rc = await start(c);
  expectOk(rc, 1, 0);
  expect(rc.guard).toEqual(counts({ updated: 1 }));
  expect(await storedRow()).toEqual(STORED_CORRECTED);
}
function expectGuardedOnly() {
  expect(upsertLog).toEqual([]);
  expect(rpcLog.length).toBeGreaterThan(0);
  expect(rpcLog.every((c) => c.name === GUARDED)).toBe(true);
}
function expectUpsertOnly() {
  expect(rpcLog.filter((c) => c.name === GUARDED)).toEqual([]);
  expect(upsertLog.length).toBeGreaterThan(0);
}

// ── guard ON ────────────────────────────────────────────────────────────────────────────────────────

describe("D-R2 guard ON (TOAST_LABOR_GUARD=1): the newer version stands, whatever lands last", () => {
  beforeEach(() => { vi.stubEnv("TOAST_LABOR_GUARD", "1"); });

  it("B (closed, m2) writes first, A (open, m1) lands last: B inserted, A skipped_older, the row is CLOSED m2", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [CLOSED], []);
    const { held: ra, free: rb } = await race(a, b);
    expectOk(ra, 1, 0);
    expectOk(rb, 1, 0);
    expect(rb.guard).toEqual(counts({ inserted: 1 }));
    expect(ra.guard).toEqual(counts({ skipped_older: 1 }));
    expect(await storedRow()).toEqual(STORED_CLOSED);
    expectGuardedOnly();
    await thirdPullCorrects();
    expectGuardedOnly();
  }, PG_TIMEOUT);

  it("A (open) first, then B (closed): A inserted, B updated, the row is CLOSED", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [CLOSED], []);
    const { held: rb, free: ra } = await race(b, a);
    expectOk(ra, 1, 0);
    expectOk(rb, 1, 0);
    expect(ra.guard).toEqual(counts({ inserted: 1 }));
    expect(rb.guard).toEqual(counts({ updated: 1 }));
    expect(await storedRow()).toEqual(STORED_CLOSED);
    expectGuardedOnly();
    await thirdPullCorrects();
    expectGuardedOnly();
  }, PG_TIMEOUT);

  it("archive: the tombstone (B, modification window) first, the stale live row (A, day read) last: A skipped_older, the row stays deleted m2", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [], [ARCHIVED]);
    const { held: ra, free: rb } = await race(a, b);
    expectOk(ra, 1, 0);
    expectOk(rb, 0, 1);
    expect(rb.guard).toEqual(counts({ inserted: 1 }));
    expect(ra.guard).toEqual(counts({ skipped_older: 1 }));
    expect(await storedRow()).toEqual(STORED_ARCHIVED);
    expectGuardedOnly();
    await thirdPullCorrects();
    expectGuardedOnly();
  }, PG_TIMEOUT);

  it("archive: the live row (A) first, the tombstone (B) last: A inserted, B updated, the row ends deleted m2", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [], [ARCHIVED]);
    const { held: rb, free: ra } = await race(b, a);
    expectOk(ra, 1, 0);
    expectOk(rb, 0, 1);
    expect(ra.guard).toEqual(counts({ inserted: 1 }));
    expect(rb.guard).toEqual(counts({ updated: 1 }));
    expect(await storedRow()).toEqual(STORED_ARCHIVED);
    expectGuardedOnly();
    await thirdPullCorrects();
    expectGuardedOnly();
  }, PG_TIMEOUT);
});

// ── guard OFF: the control ──────────────────────────────────────────────────────────────────────────

describe("the control, guard OFF (main's upsert): newer first, older last puts the OLDER version back", () => {
  beforeEach(() => { vi.stubEnv("TOAST_LABOR_GUARD", undefined); });

  it("MAIN'S BUG (D-R2): B (closed) first, A (open) last: the row is OPEN again", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [CLOSED], []);
    const { held: ra, free: rb } = await race(a, b);
    expectOk(ra, 1, 0);
    expectOk(rb, 1, 0);
    expect("guard" in ra).toBe(false);
    expect("guard" in rb).toBe(false);
    // This assertion PASSING is the bug: the clock-out written by B is undone by A's older read landing last.
    expect(await storedRow()).toEqual(STORED_OPEN);
    expectUpsertOnly();
  }, PG_TIMEOUT);

  it("A (open) first, then B (closed): the row is CLOSED (no bug in this order)", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [CLOSED], []);
    const { held: rb, free: ra } = await race(b, a);
    expectOk(ra, 1, 0);
    expectOk(rb, 1, 0);
    expect(await storedRow()).toEqual(STORED_CLOSED);
    expectUpsertOnly();
  }, PG_TIMEOUT);

  it("MAIN'S BUG (archive): the tombstone first, the stale live row last: the row is LIVE again", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [], [ARCHIVED]);
    const { held: ra, free: rb } = await race(a, b);
    expectOk(ra, 1, 0);
    expectOk(rb, 0, 1);
    // This assertion PASSING is the bug: the archive is undone by a stale live row landing last.
    expect(await storedRow()).toEqual(STORED_OPEN);
    expectUpsertOnly();
  }, PG_TIMEOUT);

  it("archive: the live row first, the tombstone last: the row ends deleted (no bug in this order)", async () => {
    const a = pull("A", [OPEN], []);
    const b = pull("B", [], [ARCHIVED]);
    const { held: rb, free: ra } = await race(b, a);
    expectOk(ra, 1, 0);
    expectOk(rb, 0, 1);
    expect(await storedRow()).toEqual(STORED_ARCHIVED);
    expectUpsertOnly();
  }, PG_TIMEOUT);
});
