/**
 * TOAST_LABOR_GUARD = "1": the guarded write path of the labor pull (CC ruling D-R2; migration 0361).
 *
 * Unit level: the service client, Toast and audit() are doubles; the expected `p_rows` are computed with the REAL
 * normalizer. What is pinned: ONE `rpc("toast_time_entries_apply_newer", { p_rows })` per non-empty read and never the
 * upsert; fail CLOSED on an rpc error, a missing function, the deadline and every malformed answer; skips are success
 * (the row stays ok, the digest outcome stays ok, the reconcile still runs); the run's sums in `result.guard` and in
 * the heartbeat; the switch; `modified` keeps main's meaning. The OFF path is tests/toast-labor-guard-off.test.ts.
 * Synthetic names only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LABOR_GUARD_KEYS, laborGuardEnabled, parseLaborGuardCounts, runToastLaborPull, type LaborGuardCounts, type LaborPullResult,
} from "@/lib/toast/labor";
import { employeeFirstNames, jobTitles, normalizeTimeEntries, type LaborEntryRow } from "@/lib/toast/labor-shared";
import { laborPullOutcome } from "@/lib/report-digests-v2";
import { audit } from "@/lib/audit";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet } from "@/lib/toast/client";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/client", () => ({ toastGet: vi.fn() }));

const GUARDED = "toast_time_entries_apply_newer";
const NOW_ISO = "2026-10-08T15:00:00.000Z";
const D6 = "2026-10-06";
const D7 = "2026-10-07";
const D8 = "2026-10-08"; // ET today for NOW_ISO
const now = () => new Date(NOW_ISO);

// ── fixtures: two shops, distinct data per restaurant GUID ──────────────────────────────────────────

type Loc = { id: string; toast_restaurant_guid: string };
interface ShopFixture { jobs: unknown[]; employees: unknown[]; days: Record<string, unknown[]>; modified: unknown[] }
const SHOPS: Loc[] = [
  { id: "loc-a", toast_restaurant_guid: "rest-a" },
  { id: "loc-b", toast_restaurant_guid: "rest-b" },
];
const te = (over: Record<string, unknown>): Record<string, unknown> => ({ deleted: false, breaks: [], ...over });

function baseToast(): Record<string, ShopFixture> {
  return {
    "rest-a": {
      jobs: [{ guid: "job-a-line", title: "Line Cook" }],
      employees: [{ guid: "emp-a1", firstName: "Testa" }, { guid: "emp-a2", firstName: "Mocko" }],
      days: {
        "20261006": [te({ guid: "a-0601", businessDate: "20261006", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
          inDate: "2026-10-06T12:00:00.000+0000", outDate: "2026-10-06T20:00:00.000+0000", regularHours: 8, overtimeHours: 0,
          modifiedDate: "2026-10-06T20:01:00.000+0000" })],
        "20261007": [
          te({ guid: "a-0701", businessDate: "20261007", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
            inDate: "2026-10-07T12:00:00.000+0000", outDate: "2026-10-07T19:30:00.000+0000", regularHours: 7.5, overtimeHours: 0,
            modifiedDate: "2026-10-07T19:31:00.000+0000" }),
          te({ guid: "a-0702", businessDate: "20261007", employeeReference: { guid: "emp-a2" },
            inDate: "2026-10-07T21:00:00.000+0000", outDate: "2026-10-08T04:00:00.000+0000",
            breaks: [{ paid: false, missed: false, inDate: "2026-10-08T00:00:00.000+0000", outDate: "2026-10-08T00:30:00.000+0000" }] }),
        ],
        "20261008": [te({ guid: "a-0801", businessDate: "20261008", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
          inDate: "2026-10-08T12:00:00.000+0000", outDate: null, modifiedDate: "2026-10-08T12:00:30.000+0000" })],
      },
      modified: [te({ guid: "a-0701", businessDate: "20261007", employeeReference: { guid: "emp-a1" }, jobReference: { guid: "job-a-line" },
        inDate: "2026-10-07T12:00:00.000+0000", outDate: "2026-10-07T20:00:00.000+0000", regularHours: 8, overtimeHours: 0,
        modifiedDate: "2026-10-08T09:00:00.000+0000" })],
    },
    "rest-b": {
      jobs: [{ guid: "job-b-prep", title: "Prep" }],
      employees: [{ guid: "emp-b1", firstName: "Testa" }, { guid: "emp-b2", firstName: "Mocko" }],
      days: {
        "20261006": [te({ guid: "b-0601", businessDate: "20261006", employeeReference: { guid: "emp-b1" }, jobReference: { guid: "job-b-prep" },
          inDate: "2026-10-06T13:00:00.000+0000", outDate: "2026-10-06T18:00:00.000+0000", regularHours: 5,
          modifiedDate: "2026-10-06T18:00:10.000+0000" })],
        "20261007": [te({ guid: "b-0701", businessDate: "20261007", employeeReference: { guid: "emp-b2" }, jobReference: { guid: "job-b-prep" },
          inDate: "2026-10-07T10:00:00.000+0000", outDate: "2026-10-07T21:00:00.000+0000", regularHours: 10, overtimeHours: 1,
          modifiedDate: "2026-10-07T21:00:10.000+0000" })],
        "20261008": [te({ guid: "b-0801", businessDate: "20261008", employeeReference: { guid: "emp-b1" },
          inDate: "2026-10-08T11:00:00.000+0000", outDate: "2026-10-08T14:00:00.000+0000", regularHours: 3,
          modifiedDate: "2026-10-08T14:00:10.000+0000" })],
      },
      // An ARCHIVE tombstone arrives through the modification window.
      modified: [{ guid: "b-0601", deleted: true, employeeReference: { guid: "emp-b1" }, inDate: "2026-10-06T13:00:00.000+0000",
        businessDate: "20261006", modifiedDate: "2026-10-08T08:00:00.000+0000" }],
    },
  };
}

function shopOf(t: Record<string, ShopFixture>, guid: string): ShopFixture {
  const s = t[guid];
  if (!s) throw new Error(`fixture ${guid}`);
  return s;
}

/** What the REAL normalizer makes of one read (the exact `p_rows` the pull must send). */
function expectedRows(t: Record<string, ShopFixture>, loc: Loc, read: string | "modified"): LaborEntryRow[] {
  const s = shopOf(t, loc.toast_restaurant_guid);
  const raw = read === "modified" ? s.modified : s.days[read.replaceAll("-", "")];
  if (!raw) throw new Error(`fixture read ${read}`);
  return normalizeTimeEntries(structuredClone(raw), {
    locationId: loc.id, businessDate: read === "modified" ? null : read, jobs: jobTitles(s.jobs), employees: employeeFirstNames(s.employees),
  }).rows;
}

// ── the service-client double ───────────────────────────────────────────────────────────────────────

type Answer = { data: unknown; error: unknown } | "hang";
interface World {
  toast: Record<string, ShopFixture>;
  rpcCalls: Array<{ name: string; args: unknown }>;
  fromTables: string[];
  upserts: unknown[];
  guardedIdx: number;
  answer: (i: number, sent: number) => Answer;
}

const counts = (sent: number, partial: Partial<LaborGuardCounts>): LaborGuardCounts => ({
  received: sent, inserted: 0, updated: 0, unchanged: 0, skipped_same_stamp: 0, skipped_older: 0, skipped_no_stamp: 0, duplicates: 0, ...partial,
});
const okAnswer = (c: LaborGuardCounts): Answer => ({ data: { ...c }, error: null });
const allInserted = (_i: number, sent: number): Answer => okAnswer(counts(sent, { inserted: sent }));

let world: World;

interface LocationsQuery {
  select(): LocationsQuery; eq(): LocationsQuery; not(): LocationsQuery; returns(): LocationsQuery; abortSignal(): LocationsQuery;
  in(column: string, ids: string[]): LocationsQuery;
  then(resolve: (v: unknown) => void): void;
}

function makeClient(w: World): ReturnType<typeof getServiceRoleClient> {
  const client = {
    from(table: string) {
      w.fromTables.push(table);
      if (table === "locations") {
        let ids: string[] | null = null;
        const q: LocationsQuery = {
          select: () => q, eq: () => q, not: () => q, returns: () => q, abortSignal: () => q,
          in: (_c: string, x: string[]) => { ids = x; return q; },
          then(resolve: (v: unknown) => void) {
            resolve({ data: SHOPS.filter((s) => ids === null || ids.includes(s.id)).map((s) => ({ ...s })), error: null });
          },
        };
        return q;
      }
      return {
        upsert: (rows: unknown) => {
          w.upserts.push(rows);
          return { abortSignal: async () => ({ data: null, error: null }) };
        },
      };
    },
    rpc(name: string, args: unknown) {
      w.rpcCalls.push({ name, args: structuredClone(args) });
      return {
        abortSignal: (_s: AbortSignal): Promise<unknown> => {
          if (name !== GUARDED) return Promise.resolve({ data: null, error: null });
          const sent = (args as { p_rows: unknown[] }).p_rows.length;
          const a = w.answer(w.guardedIdx++, sent);
          if (a === "hang") return new Promise(() => {});
          return Promise.resolve(a);
        },
      };
    },
  };
  return client as unknown as ReturnType<typeof getServiceRoleClient>;
}

function setup(answer: World["answer"] = allInserted, toast: Record<string, ShopFixture> = baseToast()): World {
  world = { toast, rpcCalls: [], fromTables: [], upserts: [], guardedIdx: 0, answer };
  const w = world;
  vi.mocked(getServiceRoleClient).mockImplementation(() => makeClient(w));
  vi.mocked(toastGet).mockImplementation((async (path: string, guid: string) => {
    const s = shopOf(w.toast, guid);
    if (path === "/labor/v1/jobs") return structuredClone(s.jobs);
    if (path === "/labor/v1/employees") return structuredClone(s.employees);
    const day = /^\/labor\/v1\/timeEntries\?businessDate=(\d{8})$/.exec(path);
    if (day) {
      const d = s.days[day[1]!];
      if (!d) throw new Error(`no fixture for day ${day[1]!}`);
      return structuredClone(d);
    }
    if (path.startsWith("/labor/v1/timeEntries?modifiedStartDate=") && path.endsWith("&includeArchived=true")) return structuredClone(s.modified);
    throw new Error(`unexpected path ${path}`);
  }) as typeof toastGet);
  return w;
}

const guardedCalls = (w: World) => w.rpcCalls.filter((c) => c.name === GUARDED);
const reconcileCalls = (w: World) => w.rpcCalls.filter((c) => c.name === "reconcile_station_lifecycle").map((c) => c.args);
interface Heartbeat { action: string; metadata: Record<string, unknown> }
function heartbeat(): Heartbeat {
  const calls = vi.mocked(audit).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]![0] as unknown as Heartbeat;
}
function expectNoUpsert(w: World) {
  expect(w.upserts).toEqual([]);
  expect(w.fromTables.filter((t) => t !== "locations")).toEqual([]);
}

const A = SHOPS[0]!;
const B = SHOPS[1]!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  vi.stubEnv("TOAST_LABOR_GUARD", "1");
  vi.stubEnv("STATION_LIFECYCLE", undefined);
});
afterEach(() => vi.unstubAllEnvs());

// ── 1. one rpc per non-empty read, the rows exactly as normalized, never the upsert ─────────────────

describe("1. ONE guarded rpc per non-empty read, never the upsert", () => {
  it("sends each read's normalized rows (no pulled_at) in read order; an empty read makes no call", async () => {
    const toast = baseToast();
    shopOf(toast, "rest-a").days["20261006"] = []; // empty day read
    shopOf(toast, "rest-b").modified = []; // empty modification read
    const w = setup(allInserted, toast);
    const result = await runToastLaborPull([D6, D7], { deadlineMs: 10_000, context: "cron", now: now() });

    const want = [
      expectedRows(toast, A, D7), expectedRows(toast, A, "modified"),
      expectedRows(toast, B, D6), expectedRows(toast, B, D7),
    ];
    expect(want.every((rows) => rows.length > 0)).toBe(true);
    expect(guardedCalls(w)).toEqual(want.map((rows) => ({ name: GUARDED, args: { p_rows: rows } })));
    for (const c of guardedCalls(w)) {
      const rows = (c.args as { p_rows: Array<Record<string, unknown>> }).p_rows;
      expect(rows.every((r) => !("pulled_at" in r))).toBe(true);
      expect(Object.keys(c.args as object)).toEqual(["p_rows"]);
    }
    expect(w.rpcCalls.every((c) => c.name === GUARDED)).toBe(true);
    expectNoUpsert(w);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.results).toEqual([
      { locationId: "loc-a", businessDate: D6, ok: true, rows: 0, skipped: 0 },
      { locationId: "loc-a", businessDate: D7, ok: true, rows: 2, skipped: 0 },
      { locationId: "loc-b", businessDate: D6, ok: true, rows: 1, skipped: 0 },
      { locationId: "loc-b", businessDate: D7, ok: true, rows: 1, skipped: 0 },
    ]);
  });

  it("a run whose every read is empty makes no guarded call at all", async () => {
    const toast = baseToast();
    for (const g of ["rest-a", "rest-b"]) { shopOf(toast, g).days["20261007"] = []; shopOf(toast, g).modified = []; }
    const w = setup(allInserted, toast);
    const result = await runToastLaborPull([D7], { deadlineMs: 10_000, context: "cron", now: now() });
    expect(w.rpcCalls).toEqual([]);
    expectNoUpsert(w);
    expect(result.guard).toEqual(counts(0, {}));
  });
});

// ── 2. fail closed ──────────────────────────────────────────────────────────────────────────────────

/** A valid answer bent by one defect (`sent` = the rows of the read). */
const MALFORMED: Array<[string, (sent: number) => unknown]> = [
  ["a missing key", (n) => { const c: Record<string, unknown> = { ...counts(n, { inserted: n }) }; delete c.duplicates; return c; }],
  ["an extra key", (n) => ({ ...counts(n, { inserted: n }), extra: 0 })],
  ["a string-typed value", (n) => ({ ...counts(n, { inserted: n }), received: String(n) })],
  ["a negative", (n) => ({ ...counts(n, { inserted: n + 1 }), duplicates: -1 })],
  ["a fraction", (n) => ({ ...counts(n, { inserted: n - 0.5 }), unchanged: 0.5 })],
  ["NaN", (n) => ({ ...counts(n, { inserted: n }), updated: Number.NaN })],
  ["received != rows sent", (n) => counts(n + 1, { inserted: n + 1 })],
  ["a sum that does not add up", (n) => counts(n, { inserted: n, updated: 1 })],
  ["null", () => null],
  ["an array", (n) => [counts(n, { inserted: n })]],
  ["a string", (n) => JSON.stringify(counts(n, { inserted: n }))],
];

const FAILURES: Array<[string, (sent: number) => Answer, string]> = [
  ["an rpc { error }", () => ({ data: null, error: { message: "synthetic failure", code: "XX000" } }), "toast_labor_write_failed"],
  ["PostgREST function missing (PGRST202)", () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.toast_time_entries_apply_newer(p_rows) in the schema cache" } }), "toast_labor_write_failed"],
  ...MALFORMED.map(([name, f]): [string, (sent: number) => Answer, string] => [`malformed answer: ${name}`, (n) => ({ data: f(n), error: null }), "toast_labor_write_failed"]),
];

describe("2. fail CLOSED: the read is ok:false, no upsert, the other reads still land", () => {
  for (const [name, bad, err] of FAILURES) {
    it(`${name} -> ${err}`, async () => {
      // Guarded call order: 0 A D7, 1 A modified, 2 B D7, 3 B modified. The FIRST one fails.
      const w = setup((i, sent) => (i === 0 ? bad(sent) : okAnswer(counts(sent, { inserted: sent }))));
      const result = await runToastLaborPull([D7], { deadlineMs: 10_000, context: "cron", now: now() });
      expectNoUpsert(w);
      expect(guardedCalls(w)).toHaveLength(4);
      expect(result.results).toEqual([
        { locationId: "loc-a", businessDate: D7, ok: false, rows: 0, skipped: 0, error: err },
        { locationId: "loc-b", businessDate: D7, ok: true, rows: 1, skipped: 0 },
      ]);
      // A's modification read and both of B's reads landed: 1 + 1 + 1 rows.
      expect(result.modified).toBe(2);
      expect(result.guard).toEqual(counts(3, { inserted: 3 }));
      expect(heartbeat().action).toBe("cron.failure");
    });
  }

  it("the deadline: the run's signal fires while the rpc is pending -> toast_labor_deadline", async () => {
    // The LAST guarded call (B modified) never answers; the earlier reads landed before the 1 s deadline.
    const w = setup((i, sent) => (i === 3 ? "hang" : okAnswer(counts(sent, { inserted: sent }))));
    const result = await runToastLaborPull([D7], { deadlineMs: 1_000, context: "cron", now: now() });
    expectNoUpsert(w);
    expect(guardedCalls(w)).toHaveLength(4);
    expect(result.results).toEqual([
      { locationId: "loc-a", businessDate: D7, ok: true, rows: 2, skipped: 0 },
      { locationId: "loc-b", businessDate: D7, ok: true, rows: 1, skipped: 0 },
      { locationId: "loc-b", businessDate: "modified", ok: false, rows: 0, skipped: 0, error: "toast_labor_deadline" },
    ]);
    expect(result.modified).toBe(1);
    expect(result.guard).toEqual(counts(4, { inserted: 4 }));
  }, 30_000);
});

// ── 3. parseLaborGuardCounts directly ───────────────────────────────────────────────────────────────

describe("3. parseLaborGuardCounts: the exact contract or null", () => {
  it("the valid shape returns the eight numbers", () => {
    const valid = { received: 9, inserted: 1, updated: 2, unchanged: 1, skipped_same_stamp: 1, skipped_older: 1, skipped_no_stamp: 1, duplicates: 2 };
    expect(parseLaborGuardCounts(valid, 9)).toEqual(valid);
    expect(Object.keys(parseLaborGuardCounts(valid, 9)!)).toEqual([...LABOR_GUARD_KEYS]);
    expect(parseLaborGuardCounts(counts(0, {}), 0)).toEqual(counts(0, {}));
  });
  for (const [name, f] of MALFORMED) {
    it(`${name} -> null`, () => {
      expect(parseLaborGuardCounts(f(3), 3)).toBeNull();
    });
  }
  it("undefined, a number and a boolean -> null", () => {
    expect(parseLaborGuardCounts(undefined, 0)).toBeNull();
    expect(parseLaborGuardCounts(0, 0)).toBeNull();
    expect(parseLaborGuardCounts(true, 0)).toBeNull();
  });
});

// ── 4. skips are success ────────────────────────────────────────────────────────────────────────────

describe("4. skips of every kind leave the row ok, rows = rows READ, and the digest outcome ok", () => {
  const SKIPS: Array<[string, (n: number) => LaborGuardCounts]> = [
    ["skipped_same_stamp", (n) => counts(n, { skipped_same_stamp: n })],
    ["skipped_older", (n) => counts(n, { skipped_older: n })],
    ["skipped_no_stamp", (n) => counts(n, { skipped_no_stamp: n })],
    ["duplicates", (n) => counts(n, { inserted: 1, duplicates: n - 1 })],
    ["all rows unchanged", (n) => counts(n, { unchanged: n })],
  ];
  for (const [name, c] of SKIPS) {
    it(name, async () => {
      const w = setup((_i, sent) => okAnswer(c(sent)));
      const result = await runToastLaborPull([D7], { deadlineMs: 10_000, context: "digest", now: now(), locationIds: ["loc-a"] });
      expectNoUpsert(w);
      expect(result.results).toEqual([{ locationId: "loc-a", businessDate: D7, ok: true, rows: 2, skipped: 0 }]);
      expect(result.modified).toBe(1);
      expect(laborPullOutcome(result)).toEqual({ ok: true, connected: true });
      expect(heartbeat().action).toBe("cron.success");
    });
  }
});

// ── 5. reconcile is not gated on skips ──────────────────────────────────────────────────────────────

describe("5. the reconcile is not gated on skips (pinned)", () => {
  const run = async (answer: World["answer"]) => {
    vi.clearAllMocks();
    vi.stubEnv("STATION_LIFECYCLE", "1");
    const w = setup(answer);
    const result = await runToastLaborPull([D8], { deadlineMs: 10_000, context: "cron", now: now() });
    return { w, result };
  };

  it("zero skips and ONLY skips make the SAME reconcile calls", async () => {
    const none = await run((_i, sent) => okAnswer(counts(sent, { inserted: sent })));
    const skips = await run((i, sent) => okAnswer(counts(sent, i % 2 === 0 ? { skipped_older: sent } : { skipped_same_stamp: sent })));
    const want = [{ p_location_id: "loc-a", p_day: D8 }, { p_location_id: "loc-b", p_day: D8 }];
    expect(reconcileCalls(none.w)).toEqual(want);
    expect(reconcileCalls(skips.w)).toEqual(want);
    expect(skips.result.results.every((r) => r.ok)).toBe(true);
    expect(skips.result.guard?.inserted).toBe(0);
  });

  it("a FAILED guarded write of today's read makes no reconcile call for that shop", async () => {
    // 0 A D8 (fails), 1 A modified, 2 B D8, 3 B modified.
    const { w, result } = await run((i, sent) => (i === 0
      ? { data: null, error: { message: "synthetic failure", code: "XX000" } }
      : okAnswer(counts(sent, { inserted: sent }))));
    expect(reconcileCalls(w)).toEqual([{ p_location_id: "loc-b", p_day: D8 }]);
    expect(result.results.find((r) => r.locationId === "loc-a" && r.businessDate === D8)).toEqual(
      { locationId: "loc-a", businessDate: D8, ok: false, rows: 0, skipped: 0, error: "toast_labor_write_failed" });
  });
});

// ── 6. the sums: result.guard and the heartbeat ─────────────────────────────────────────────────────

describe("6. result.guard and the heartbeat hold the run's sums", () => {
  // Guarded call order for [D6, D7], two shops: 0 A D6 (1 row), 1 A D7 (2), 2 A modified (1), 3 B D6 (1), 4 B D7 (1), 5 B modified (1).
  const PER_CALL: LaborGuardCounts[] = [
    counts(1, { inserted: 1 }),
    counts(2, { updated: 1, skipped_older: 1 }),
    counts(1, { skipped_same_stamp: 1 }),
    counts(1, { unchanged: 1 }),
    counts(1, { skipped_no_stamp: 1 }),
    counts(1, { updated: 1 }),
  ];

  it("two shops, six reads, known answers: the sums written out by hand", async () => {
    const w = setup((i, sent) => {
      const c = PER_CALL[i];
      if (!c || c.received !== sent) throw new Error(`unexpected guarded call ${i} with ${sent} rows`);
      return okAnswer(c);
    });
    const result = await runToastLaborPull([D6, D7], { deadlineMs: 10_000, context: "cron", now: now() });
    expect(guardedCalls(w)).toHaveLength(6);
    const SUM: LaborGuardCounts = { received: 7, inserted: 1, updated: 2, unchanged: 1, skipped_same_stamp: 1, skipped_older: 1, skipped_no_stamp: 1, duplicates: 0 };
    expect(result.guard).toEqual(SUM);
    const hb = heartbeat();
    expect(hb.action).toBe("cron.success");
    expect(hb.metadata.guard).toEqual(SUM);
    expect(hb.metadata.guard_skips_by_location).toEqual({
      "loc-a": { skipped_same_stamp: 1, skipped_older: 1, skipped_no_stamp: 0 },
      "loc-b": { skipped_same_stamp: 0, skipped_older: 0, skipped_no_stamp: 1 },
    });
    expect(result.results.every((r) => r.ok)).toBe(true);
  });

  it("a run with one failed read still reports the other reads' counts; only shops with a skip are listed; cron.failure", async () => {
    const ANS: Answer[] = [
      okAnswer(counts(1, { inserted: 1 })),
      { data: null, error: { message: "synthetic failure", code: "XX000" } }, // A D7 fails
      okAnswer(counts(1, { skipped_older: 1 })),
      okAnswer(counts(1, { inserted: 1 })),
      okAnswer(counts(1, { inserted: 1 })),
      okAnswer(counts(1, { inserted: 1 })),
    ];
    setup((i) => { const a = ANS[i]; if (!a) throw new Error(`unexpected guarded call ${i}`); return a; });
    const result = await runToastLaborPull([D6, D7], { deadlineMs: 10_000, context: "cron", now: now() });
    const SUM: LaborGuardCounts = { received: 5, inserted: 4, updated: 0, unchanged: 0, skipped_same_stamp: 0, skipped_older: 1, skipped_no_stamp: 0, duplicates: 0 };
    expect(result.guard).toEqual(SUM);
    const hb = heartbeat();
    expect(hb.action).toBe("cron.failure");
    expect(hb.metadata.guard).toEqual(SUM);
    expect(hb.metadata.guard_skips_by_location).toEqual({ "loc-a": { skipped_same_stamp: 0, skipped_older: 1, skipped_no_stamp: 0 } });
    expect(hb.metadata.errors).toEqual([`loc-a:${D7}:toast_labor_write_failed`]);
  });

  it("no skip anywhere: guard_skips_by_location is an empty object", async () => {
    setup();
    await runToastLaborPull([D7], { deadlineMs: 10_000, context: "cron", now: now() });
    const hb = heartbeat();
    expect(hb.action).toBe("cron.success");
    expect(hb.metadata.guard_skips_by_location).toEqual({});
    expect(hb.metadata.guard).toEqual(counts(5, { inserted: 5 }));
  });
});

// ── 7. the switch ───────────────────────────────────────────────────────────────────────────────────

describe("7. the switch", () => {
  it("\"1\" is ON", () => {
    vi.stubEnv("TOAST_LABOR_GUARD", "1");
    expect(laborGuardEnabled()).toBe(true);
  });

  it("with TOAST_LABOR_PULL not \"1\" the result is { ran: false, results: [], modified: 0 } with NO guard key, guard \"1\" or not", async () => {
    for (const pull of [undefined, "0", "true"]) {
      vi.stubEnv("TOAST_LABOR_PULL", pull);
      vi.stubEnv("TOAST_LABOR_GUARD", "1");
      const w = setup();
      const result: LaborPullResult = await runToastLaborPull([D7], { deadlineMs: 10_000, context: "cron", now: now() });
      expect(result).toEqual({ ran: false, results: [], modified: 0 });
      expect(Object.keys(result)).toEqual(["ran", "results", "modified"]);
      expect("guard" in result).toBe(false);
      expect(w.rpcCalls).toEqual([]);
      expect(w.fromTables).toEqual([]);
    }
  });
});

// ── 8. modified keeps main's meaning ────────────────────────────────────────────────────────────────

describe("8. modified = rows READ from the modification window, whatever the function skipped", () => {
  it("every modification-window row skipped: modified still counts them", async () => {
    // 0 A D7, 1 A modified (skipped), 2 B D7, 3 B modified (skipped).
    setup((i, sent) => okAnswer(i % 2 === 1 ? counts(sent, { skipped_older: sent }) : counts(sent, { inserted: sent })));
    const result = await runToastLaborPull([D7], { deadlineMs: 10_000, context: "cron", now: now() });
    expect(result.modified).toBe(2);
    expect(result.guard).toEqual(counts(5, { inserted: 3, skipped_older: 2 }));
  });
});
