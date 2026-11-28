/**
 * TOAST_LABOR_GUARD OFF = main's writer, byte for byte (CC ruling R5; U4; U7).
 *
 * THE GOLDEN (`tests/fixtures/toast-labor-guard-off-golden.json`) WAS GENERATED FROM
 * `lib/toast/labor.ts` EXACTLY AS MAIN `ec585c12` HAS IT, and it is the branch's FIRST commit
 * (before any guarded write path exists). It is regenerated ONLY with a written reason (in the
 * commit message and the job's READY file) naming every transcript that changed. Regenerate with
 * `TOAST_LABOR_OFF_GOLDEN_WRITE=1 npx vitest run tests/toast-labor-guard-off.test.ts`; a write run
 * FAILS on purpose so it is never mistaken for a pass.
 *
 * What is recorded, in ONE ordered event list per scenario: every `getServiceRoleClient()` call,
 * every service-client `from(table)` / `rpc(name, args)` and every chained method on them with its
 * arguments (an AbortSignal is a marker), every await of a builder, every `toastGet` as the pair
 * (path, restaurant GUID), every `audit()` input whole; plus the returned `LaborPullResult` whole.
 * The Toast double serves data BY THE RESTAURANT GUID it is called with, so a pull that used the
 * wrong GUID writes the wrong shop's rows (U4).
 *
 * The switch matrix runs every scenario with TOAST_LABOR_GUARD unset, "", "0", "true", "on" and
 * " 1": all must equal the golden, and no transcript may hold the guarded RPC. The value "1" is
 * tested elsewhere. This file must not import anything the guarded change adds.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runToastLaborPull } from "@/lib/toast/labor";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet } from "@/lib/toast/client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/client", () => ({ toastGet: vi.fn() }));

const GOLDEN_PATH = fileURLToPath(new URL("./fixtures/toast-labor-guard-off-golden.json", import.meta.url));
const WRITE = process.env.TOAST_LABOR_OFF_GOLDEN_WRITE === "1";
const GUARDED_RPC = "toast_time_entries_apply_newer";

/** Frozen clock: `pulled_at` is `new Date().toISOString()`; `opts.now` is always passed too. */
const NOW_ISO = "2026-10-08T15:00:00.000Z";
const D6 = "2026-10-06";
const D7 = "2026-10-07";
const D8 = "2026-10-08"; // ET today for NOW_ISO

// ── the recording double ─────────────────────────────────────────────────────────────────────

type Loc = { id: string; toast_restaurant_guid: string };
type Served = unknown[] | { throws: "toast_api"; code: string } | { throws: "generic" };
interface ShopFixture { jobs: unknown[]; employees: unknown[]; days: Record<string, Served>; modified: Served }
interface World {
  events: unknown[];
  locations: { rows: Loc[]; error: boolean };
  toast: Record<string, ShopFixture>;
  failWriteGuids: ReadonlySet<string>;
}
interface Transcript { events: unknown[]; result: unknown }

function sanitize(x: unknown): unknown {
  if (x instanceof AbortSignal) return "<AbortSignal>";
  if (typeof x === "function") return "<function>";
  if (Array.isArray(x)) return x.map(sanitize);
  if (x !== null && typeof x === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) o[k] = sanitize(v);
    return o;
  }
  return x;
}

type Call = { method: string; args: unknown[] };

/** A PostgREST-style builder: every method is recorded and chains; awaiting it settles from its calls. */
function chain(world: World, target: string, settle: (calls: readonly Call[]) => unknown): unknown {
  const calls: Call[] = [];
  const proxy: object = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          world.events.push({ ev: "await", target });
          try { resolve(settle(calls)); } catch (e) { reject(e); }
        };
      }
      return (...args: unknown[]) => {
        calls.push({ method: prop, args });
        world.events.push({ ev: "call", target, method: prop, args: sanitize(args) });
        return proxy;
      };
    },
  });
  return proxy;
}

function settleFrom(world: World, table: string, calls: readonly Call[]): unknown {
  if (table === "locations") {
    if (world.locations.error) return { data: null, error: { message: "synthetic locations failure", code: "XX000" } };
    const inCall = calls.find((c) => c.method === "in" && c.args[0] === "id");
    const ids = inCall && Array.isArray(inCall.args[1]) ? (inCall.args[1] as unknown[]) : null;
    return { data: world.locations.rows.filter((r) => ids === null || ids.includes(r.id)).map((r) => ({ ...r })), error: null };
  }
  if (table === "toast_time_entries") {
    const up = calls.find((c) => c.method === "upsert");
    const rows = up && Array.isArray(up.args[0]) ? (up.args[0] as Array<{ time_entry_guid?: unknown }>) : [];
    if (rows.some((r) => typeof r.time_entry_guid === "string" && world.failWriteGuids.has(r.time_entry_guid))) {
      return { data: null, error: { message: "synthetic write failure", code: "XX000" } };
    }
    return { data: null, error: null };
  }
  return { data: null, error: null };
}

function makeClient(world: World): ReturnType<typeof getServiceRoleClient> {
  const client: object = new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (prop === "from") {
        return (table: string) => {
          world.events.push({ ev: "from", table });
          return chain(world, `from:${table}`, (calls) => settleFrom(world, table, calls));
        };
      }
      if (prop === "rpc") {
        return (name: string, args?: unknown) => {
          world.events.push({ ev: "rpc", name, args: sanitize(args) });
          return chain(world, `rpc:${name}`, () => ({ data: null, error: null }));
        };
      }
      return (...args: unknown[]) => {
        world.events.push({ ev: "client", prop, args: sanitize(args) });
        return chain(world, `client:${prop}`, () => ({ data: null, error: null }));
      };
    },
  });
  return client as unknown as ReturnType<typeof getServiceRoleClient>;
}

function serve(s: Served): unknown[] {
  if (Array.isArray(s)) return structuredClone(s);
  if (s.throws === "toast_api") throw Object.assign(new Error("synthetic provider detail"), { name: "ToastApiError", code: s.code });
  throw new Error("synthetic generic failure");
}

function toastServe(world: World, path: string, guid: string): unknown {
  const shop = world.toast[guid];
  if (!shop) throw new Error(`no fixture for restaurant ${guid}`);
  if (path === "/labor/v1/jobs") return structuredClone(shop.jobs);
  if (path === "/labor/v1/employees") return structuredClone(shop.employees);
  const day = /^\/labor\/v1\/timeEntries\?businessDate=(\d{8})$/.exec(path);
  if (day) {
    const d = shop.days[day[1]!];
    if (!d) throw new Error(`no fixture for day ${day[1]!}`);
    return serve(d);
  }
  if (path.startsWith("/labor/v1/timeEntries?modifiedStartDate=") && path.endsWith("&includeArchived=true")) return serve(shop.modified);
  throw new Error(`unexpected path ${path}`);
}

// ── fixtures: two shops, DISTINCT data per restaurant GUID (U4) ───────────────────────────────

const SHOPS: Loc[] = [
  { id: "loc-a", toast_restaurant_guid: "rest-a" },
  { id: "loc-b", toast_restaurant_guid: "rest-b" },
];
const SWAPPED: Loc[] = [
  { id: "loc-a", toast_restaurant_guid: "rest-b" },
  { id: "loc-b", toast_restaurant_guid: "rest-a" },
];

const te = (over: Record<string, unknown>): Record<string, unknown> => ({ deleted: false, breaks: [], ...over });

function baseToast(): Record<string, ShopFixture> {
  return {
    "rest-a": {
      jobs: [{ guid: "job-a-line", title: "Line Cook" }, { guid: "job-a-close", title: "Closer", deleted: true }],
      employees: [{ guid: "emp-a1", firstName: "Testa" }, { guid: "emp-a2", firstName: "Mocko Lane", chosenName: "Mox" }],
      days: {
        "20261006": [te({ guid: "a-0601", businessDate: "20261006", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
          inDate: "2026-10-06T12:00:00.000+0000", outDate: "2026-10-06T20:00:00.000+0000", regularHours: 8, overtimeHours: 0 })],
        "20261007": [
          te({ guid: "a-0701", businessDate: "20261007", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
            inDate: "2026-10-07T12:00:00.000+0000", outDate: "2026-10-07T19:30:00.000+0000", regularHours: 7.5, overtimeHours: 0,
            modifiedDate: "2026-10-07T19:31:00.000+0000" }),
          te({ guid: "a-0702", businessDate: "20261007", employeeReference: { guid: "emp-a2" }, jobReference: { guid: "job-a-close" },
            inDate: "2026-10-07T21:00:00.000+0000", outDate: "2026-10-08T04:00:00.000+0000",
            breaks: [{ paid: false, missed: false, inDate: "2026-10-08T00:00:00.000+0000", outDate: "2026-10-08T00:30:00.000+0000" }],
            hourlyWage: 99, tips: 12 }),
        ],
        "20261008": [te({ guid: "a-0801", businessDate: "20261008", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
          inDate: "2026-10-08T12:00:00.000+0000", outDate: null })],
      },
      modified: [te({ guid: "a-0701", businessDate: "20261007", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
        inDate: "2026-10-07T12:00:00.000+0000", outDate: "2026-10-07T20:00:00.000+0000", regularHours: 8, overtimeHours: 0,
        modifiedDate: "2026-10-08T09:00:00.000+0000" })],
    },
    "rest-b": {
      jobs: [{ guid: "job-b-prep", title: "Prep" }],
      employees: [{ guid: "emp-b1", firstName: "Fakey" }, { guid: "emp-b2", firstName: "Sample Person" }],
      days: {
        "20261006": [te({ guid: "b-0601", businessDate: "20261006", employeeReference: { guid: "emp-b1" }, jobReference: { guid: "job-b-prep" },
          inDate: "2026-10-06T13:00:00.000+0000", outDate: "2026-10-06T18:00:00.000+0000", regularHours: 5 })],
        "20261007": [te({ guid: "b-0701", businessDate: "20261007", employeeReference: { guid: "emp-b2" }, jobReference: { guid: "job-b-prep" },
          inDate: "2026-10-07T10:00:00.000+0000", outDate: "2026-10-07T21:00:00.000+0000", regularHours: 10, overtimeHours: 1 })],
        "20261008": [te({ guid: "b-0801", businessDate: "20261008", employeeReference: { guid: "emp-b1" },
          inDate: "2026-10-08T11:00:00.000+0000", outDate: "2026-10-08T14:00:00.000+0000", autoClockedOut: true, breaks: undefined })],
      },
      modified: [te({ guid: "b-0601", businessDate: "20261006", employeeReference: { guid: "emp-b1" }, jobReference: { guid: "job-b-prep" },
        inDate: "2026-10-06T13:00:00.000+0000", outDate: "2026-10-06T18:30:00.000+0000", regularHours: 5.5,
        modifiedDate: "2026-10-08T08:00:00.000+0000" })],
    },
  };
}

type PullOpts = Parameters<typeof runToastLaborPull>[1];
interface Scenario {
  name: string;
  dates: string[];
  opts: PullOpts;
  env?: Record<string, string>;
  toast: Record<string, ShopFixture>;
  locations?: { rows?: Loc[]; error?: boolean };
  failWriteGuids?: string[];
}

const now = () => new Date(NOW_ISO);
function shop(t: Record<string, ShopFixture>, guid: string): ShopFixture {
  const s = t[guid];
  if (!s) throw new Error(`fixture ${guid}`);
  return s;
}

function scenarios(): Scenario[] {
  const tomb = baseToast();
  shop(tomb, "rest-a").modified = [
    { guid: "a-0601", deleted: true, employeeReference: { guid: "emp-a1" }, inDate: "2026-10-06T12:00:00.000+0000",
      businessDate: "20261006", modifiedDate: "2026-10-08T10:00:00.000+0000" },
    te({ guid: "a-0702", businessDate: "20261007", employeeReference: { guid: "emp-a2" }, jobReference: { guid: "job-a-close" },
      inDate: "2026-10-07T21:00:00.000+0000", outDate: "2026-10-08T03:15:00.000+0000", regularHours: 6, overtimeHours: 0.25,
      modifiedDate: "2026-10-08T11:00:00.000+0000" }),
  ];
  shop(tomb, "rest-b").modified = [
    { guid: "b-0701", deleted: true, employeeReference: { guid: "emp-b2" }, inDate: "2026-10-07T10:00:00.000+0000",
      businessDate: "20261007", modifiedDate: "2026-10-08T12:00:00.000+0000" },
  ];

  const sparse = baseToast();
  shop(sparse, "rest-a").days["20261007"] = [
    te({ guid: "a-0701", businessDate: "20261007", employeeReference: { guid: "emp-a1" }, inDate: "2026-10-07T12:00:00.000+0000",
      outDate: "2026-10-07T16:00:00.000+0000", regularHours: 4 }),
    te({ guid: "a-sparse-noemp", businessDate: "20261007", inDate: "2026-10-07T12:00:00.000+0000" }),
    te({ guid: "a-sparse-noin", businessDate: "20261007", employeeReference: { guid: "emp-a2" } }),
    te({ businessDate: "20261007", employeeReference: { guid: "emp-a2" }, inDate: "2026-10-07T13:00:00.000+0000" }),
  ];
  shop(sparse, "rest-a").modified = [
    ...(shop(baseToast(), "rest-a").modified as unknown[]),
    te({ guid: "a-sparse-nodate", employeeReference: { guid: "emp-a1" }, inDate: "2026-10-05T12:00:00.000+0000" }),
  ];

  const twice = baseToast();
  shop(twice, "rest-a").days["20261007"] = [
    te({ guid: "a-0701", businessDate: "20261007", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
      inDate: "2026-10-07T12:00:00.000+0000", outDate: "2026-10-07T18:00:00.000+0000", regularHours: 6,
      modifiedDate: "2026-10-07T18:01:00.000+0000" }),
    te({ guid: "a-0701", businessDate: "20261007", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
      inDate: "2026-10-07T12:00:00.000+0000", outDate: "2026-10-07T20:00:00.000+0000", regularHours: 8,
      modifiedDate: "2026-10-07T20:05:00.000+0000" }),
  ];

  const failingRead = baseToast();
  shop(failingRead, "rest-b").days["20261007"] = { throws: "toast_api", code: "http_503" };
  shop(failingRead, "rest-a").days["20261006"] = { throws: "generic" };

  const empty = baseToast();
  shop(empty, "rest-a").days["20261007"] = [];
  shop(empty, "rest-a").modified = [];
  shop(empty, "rest-b").days["20261007"] = [];
  shop(empty, "rest-b").modified = [];

  return [
    { name: "two-shops-several-days", dates: [D6, D7, D8], opts: { deadlineMs: 10_000, context: "cron", now: now() }, toast: baseToast() },
    { name: "modified-window-tombstone-and-edit", dates: [D7], opts: { deadlineMs: 10_000, context: "backfill", now: now() }, toast: tomb },
    { name: "sparse-entry-skipped", dates: [D7], opts: { deadlineMs: 10_000, context: "digest", now: now() }, toast: sparse },
    { name: "same-guid-twice", dates: [D7], opts: { deadlineMs: 10_000, context: "cron", now: now() }, toast: twice },
    { name: "failing-write", dates: [D6, D7], opts: { deadlineMs: 10_000, context: "cron", now: now() }, toast: baseToast(), failWriteGuids: ["a-0702"] },
    { name: "failing-toast-read", dates: [D6, D7], opts: { deadlineMs: 10_000, context: "cron", now: now() }, toast: failingRead },
    { name: "empty-day", dates: [D7], opts: { deadlineMs: 10_000, context: "cron", now: now() }, toast: empty },
    { name: "station-lifecycle-reconcile", dates: [D7, D8], opts: { deadlineMs: 10_000, context: "cron", now: now(), reconcileDate: D8 },
      env: { STATION_LIFECYCLE: "1" }, toast: baseToast() },
    { name: "location-ids-restricted", dates: [D7], opts: { deadlineMs: 10_000, context: "digest", now: now(), locationIds: ["loc-b"] }, toast: baseToast() },
    { name: "locations-read-fails", dates: [D7], opts: { deadlineMs: 10_000, context: "cron", now: now() }, toast: baseToast(), locations: { error: true } },
    { name: "pull-disabled", dates: [D7], opts: { deadlineMs: 10_000, context: "cron", now: now() }, env: { TOAST_LABOR_PULL: "0" }, toast: baseToast() },
  ];
}

/** `undefined` = the variable is deleted. */
const GUARD_VALUES: ReadonlyArray<string | undefined> = [undefined, "", "0", "true", "on", " 1"];

async function run(s: Scenario, guard: string | undefined, rows?: Loc[]): Promise<Transcript> {
  vi.unstubAllEnvs();
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  vi.stubEnv("STATION_LIFECYCLE", undefined);
  for (const [k, v] of Object.entries(s.env ?? {})) vi.stubEnv(k, v);
  vi.stubEnv("TOAST_LABOR_GUARD", guard);
  const world: World = {
    events: [],
    locations: { rows: rows ?? s.locations?.rows ?? SHOPS, error: s.locations?.error ?? false },
    toast: s.toast,
    failWriteGuids: new Set(s.failWriteGuids ?? []),
  };
  vi.mocked(getServiceRoleClient).mockImplementation(() => {
    world.events.push({ ev: "getServiceRoleClient" });
    return makeClient(world);
  });
  vi.mocked(toastGet).mockImplementation((async (path: string, guid: string) => {
    world.events.push({ ev: "toastGet", path, guid });
    return toastServe(world, path, guid);
  }) as typeof toastGet);
  vi.mocked(audit).mockImplementation(async (input) => {
    world.events.push({ ev: "audit", input: sanitize(input) });
  });
  const result = await runToastLaborPull(s.dates, s.opts);
  return { events: world.events, result };
}

/** What the golden holds and what is compared: `undefined` keys vanish the same way on both sides. */
const asJson = (t: unknown): unknown => JSON.parse(JSON.stringify(t)) as unknown;

function readGolden(): Record<string, unknown> {
  if (!existsSync(GOLDEN_PATH)) throw new Error(`golden missing: ${GOLDEN_PATH}`);
  return JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as Record<string, unknown>;
}
function goldenOf(name: string): unknown {
  const g = readGolden();
  if (!(name in g)) throw new Error(`golden has no scenario ${name}`);
  return g[name];
}

type Ev = Record<string, unknown>;
const evs = (t: unknown): Ev[] => ((t as { events: Ev[] }).events);
const toastGets = (t: unknown) => evs(t).filter((e) => e.ev === "toastGet").map((e) => [e.path, e.guid]);
const hasGuardedRpc = (t: unknown) => evs(t).some((e) => e.ev === "rpc" && e.name === GUARDED_RPC)
  || evs(t).some((e) => typeof e.target === "string" && e.target === `rpc:${GUARDED_RPC}`);
function upsertedRows(t: unknown): Array<Record<string, unknown>> {
  return evs(t).filter((e) => e.ev === "call" && e.target === "from:toast_time_entries" && e.method === "upsert")
    .flatMap((e) => {
      const args = e.args as unknown[];
      return Array.isArray(args[0]) ? (args[0] as Array<Record<string, unknown>>) : [];
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW_ISO));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ── regeneration (OFF by default) ────────────────────────────────────────────────────────────

describe.runIf(WRITE)("golden regeneration (TOAST_LABOR_OFF_GOLDEN_WRITE=1)", () => {
  it("writes the golden and FAILS on purpose", async () => {
    const out: Record<string, unknown> = {};
    for (const s of scenarios()) out[s.name] = asJson(await run(s, undefined));
    writeFileSync(GOLDEN_PATH, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    throw new Error(`golden WRITTEN to ${GOLDEN_PATH}: this run is not a pass; rerun without TOAST_LABOR_OFF_GOLDEN_WRITE`);
  });
});

// ── R5: the switch matrix ────────────────────────────────────────────────────────────────────

describe.skipIf(WRITE)("R5: TOAST_LABOR_GUARD not exactly \"1\" = main's writer, byte for byte", () => {
  it("the golden holds exactly the scenario list", () => {
    expect(Object.keys(readGolden())).toEqual(scenarios().map((s) => s.name));
  });

  for (const guard of GUARD_VALUES) {
    const label = guard === undefined ? "unset" : JSON.stringify(guard);
    for (const name of scenarios().map((s) => s.name)) {
      it(`${name} with TOAST_LABOR_GUARD ${label}`, async () => {
        const s = scenarios().find((x) => x.name === name)!;
        const t = asJson(await run(s, guard));
        expect(t).toEqual(goldenOf(name));
        expect(hasGuardedRpc(t)).toBe(false);
      });
    }
  }

  it("the scenarios exercise what they are named for", async () => {
    const byName = new Map<string, unknown>();
    for (const s of scenarios()) byName.set(s.name, asJson(await run(s, undefined)));
    const get = (n: string) => byName.get(n)!;
    expect(evs(get("pull-disabled"))).toEqual([]);
    expect((get("pull-disabled") as { result: unknown }).result).toEqual({ ran: false, results: [], modified: 0 });
    expect(upsertedRows(get("empty-day"))).toEqual([]);
    expect(evs(get("empty-day")).some((e) => e.ev === "from" && e.table === "toast_time_entries")).toBe(false);
    expect(evs(get("station-lifecycle-reconcile")).filter((e) => e.ev === "rpc").map((e) => [e.name, e.args])).toEqual([
      ["reconcile_station_lifecycle", { p_location_id: "loc-a", p_day: D8 }],
      ["reconcile_station_lifecycle", { p_location_id: "loc-b", p_day: D8 }],
    ]);
    expect(new Set(toastGets(get("location-ids-restricted")).map((p) => p[1]))).toEqual(new Set(["rest-b"]));
    expect(evs(get("location-ids-restricted")).some((e) => e.ev === "call" && e.method === "in"
      && JSON.stringify(e.args) === JSON.stringify(["id", ["loc-b"]]))).toBe(true);
    expect(new Set(toastGets(get("two-shops-several-days")).map((p) => p[1]))).toEqual(new Set(["rest-a", "rest-b"]));
    const tomb = upsertedRows(get("modified-window-tombstone-and-edit")).filter((r) => r.deleted === true).map((r) => r.time_entry_guid);
    expect(tomb).toEqual(["a-0601", "b-0701"]);
    const sparse = (get("sparse-entry-skipped") as { result: { results: Array<{ locationId: string; skipped: number }> } }).result.results;
    expect(sparse.find((r) => r.locationId === "loc-a")?.skipped).toBe(3);
    expect(upsertedRows(get("same-guid-twice")).filter((r) => r.time_entry_guid === "a-0701" && r.business_date === D7)).toHaveLength(3);
    const errs = (n: string) => (get(n) as { result: { results: Array<{ ok: boolean; error?: string }> } }).result.results
      .filter((r) => !r.ok).map((r) => r.error);
    expect(errs("failing-write")).toEqual(["toast_labor_write_failed"]);
    expect(errs("failing-toast-read")).toEqual(["toast_labor_failed", "toast_labor_http_503"]);
    expect(errs("locations-read-fails")).toEqual(["toast_labor_locations_failed"]);
    const jobs = ["digest", "backfill"].map((c) => `toast-labor-pull-${c}`);
    const audited = [...byName.values()].flatMap((t) => evs(t).filter((e) => e.ev === "audit")
      .map((e) => ((e.input as { metadata: { job: string } }).metadata.job)));
    expect(audited).toEqual(expect.arrayContaining(["toast-labor-pull", ...jobs]));
  });
});

// ── U4: swapping GUIDs must fail ─────────────────────────────────────────────────────────────

describe.skipIf(WRITE)("U4: the restaurant GUID selects the shop, and the golden would notice a swap", () => {
  it("a run with the two shops' GUIDs SWAPPED is not the golden, and writes shop B's entries under loc-a", async () => {
    const s = scenarios().find((x) => x.name === "two-shops-several-days")!;
    const golden = goldenOf(s.name);
    const t = asJson(await run(s, undefined, SWAPPED));
    expect(t).not.toEqual(golden);
    expect(toastGets(t)).not.toEqual(toastGets(golden));
    const locA = upsertedRows(t).filter((r) => r.location_id === "loc-a").map((r) => String(r.time_entry_guid));
    expect(locA.length).toBeGreaterThan(0);
    expect(locA.every((g) => g.startsWith("b-"))).toBe(true);
    const goldenLocA = upsertedRows(golden).filter((r) => r.location_id === "loc-a").map((r) => String(r.time_entry_guid));
    expect(goldenLocA.length).toBeGreaterThan(0);
    expect(goldenLocA.every((g) => g.startsWith("a-"))).toBe(true);
  });

  it("comparator sensitivity: one changed restaurant GUID in a toastGet event is a difference", () => {
    const golden = goldenOf("two-shops-several-days");
    const mutated = structuredClone(golden);
    const ev = evs(mutated).find((e) => e.ev === "toastGet" && e.guid === "rest-a");
    expect(ev).toBeDefined();
    ev!.guid = "rest-b";
    expect(() => expect(mutated).toEqual(golden)).toThrow();
  });
});

// ── U7: whitespace-normalised text pins only ─────────────────────────────────────────────────

describe.skipIf(WRITE)("U7: text pins (whitespace-normalised, never character-pinned)", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ");
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("lib/toast/labor.ts still holds main's write statement (lines 105-107 of ec585c12, normalised)", () => {
    const MAIN_WRITE = "sb.from(\"toast_time_entries\") .upsert(rows.map((r) => ({ ...r, pulled_at: new Date().toISOString() })), { onConflict: \"location_id,time_entry_guid\" }) .abortSignal(signal)";
    expect(norm(read("../lib/toast/labor.ts"))).toContain(MAIN_WRITE);
  });

  it("lib/toast/labor-shared.ts is main's file (sha256, CRLF normalised to LF)", () => {
    const sha = createHash("sha256").update(read("../lib/toast/labor-shared.ts").replace(/\r\n/g, "\n"), "utf8").digest("hex");
    expect(sha).toBe("bade6ea847d5a10f79b8096acade250e7f021b4d735593b018970a1ac37ad922");
  });
});
