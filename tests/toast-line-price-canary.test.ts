// Item 1 PR B (phase 1, plan r3 §4 step 3): the read-only canary that must pass before TOAST_LINE_PRICES=1.
// It re-reads closed Toast days, normalizes with the switch ON, and checks every hash against what is
// stored. An absent hash whose order's latest stored modified_at EQUALS Toast's modifiedDate would prove
// the hash claim wrong (a price-only snapshot); absent with a different modified_at is a real Toast edit.
import { beforeEach, describe, expect, it, vi } from "vitest";
import corpus from "./fixtures/toast/line-price-corpus.json";
import golden from "./fixtures/toast-legacy-hashes.json";
import { classifyCanaryDay, CANARY_MIN_ORDERS } from "@/lib/toast/line-price-canary-shared";
import { canaryToastDate } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastConfigured, toastGet } from "@/lib/toast/client";
import { parseCanaryArgs, runCanary } from "../scripts/toast-line-price-canary";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/client", async (original) => ({ ...await original<typeof import("@/lib/toast/client")>(), toastConfigured: vi.fn(), toastGet: vi.fn(), toastGetPage: vi.fn() }));

const T = "2026-10-08T16:00:00.000Z";
const order = (n: number, hash = "h".repeat(64), modified_at: string | null = T) => ({ order_guid: `o${n}`, content_hash: hash, modified_at });

describe("classifyCanaryDay (pure)", () => {
  it("counts present hashes, real edits, never-seen orders and null-modified pairs; passes with zero violations", () => {
    const fetched = [order(1, "a".repeat(64)), order(2, "b".repeat(64)), order(3, "c".repeat(64)), order(4, "d".repeat(64), null)];
    const stored = [
      { id: "s1", order_guid: "o1", content_hash: "a".repeat(64), modified_at: "2026-10-08T16:00:00+00:00", latest: true },
      { id: "s2", order_guid: "o2", content_hash: "x".repeat(64), modified_at: "2026-10-08T15:00:00+00:00", latest: true },
      { id: "s4", order_guid: "o4", content_hash: "y".repeat(64), modified_at: null, latest: true },
    ];
    expect(classifyCanaryDay(fetched, stored)).toEqual({ orders: 4, present: 1, absent_edited: 1, absent_never_captured: 1,
      absent_null_modified: 1, absent_same_modified: 0, violations: [], null_modified_review: ["o4"], representative: false, pass: false });
  });
  it("an absent hash with the SAME latest modified_at is a violation and fails the gate", () => {
    const fetched = Array.from({ length: CANARY_MIN_ORDERS }, (_, i) => order(i, i === 0 ? "z".repeat(64) : "a".repeat(64)));
    const stored = fetched.map((o, i) => ({ id: `s${i}`, order_guid: o.order_guid, content_hash: "a".repeat(64), modified_at: "2026-10-08T16:00:00.000+00:00", latest: true }));
    const result = classifyCanaryDay(fetched, stored);
    expect(result).toMatchObject({ representative: true, absent_same_modified: 1, violations: ["o0"], pass: false });
  });
  it(`fewer than ${CANARY_MIN_ORDERS} orders never counts (pick another day)`, () => {
    const fetched = Array.from({ length: CANARY_MIN_ORDERS - 1 }, (_, i) => order(i));
    const stored = fetched.map((o, i) => ({ id: `s${i}`, order_guid: o.order_guid, content_hash: o.content_hash, modified_at: T, latest: true }));
    expect(classifyCanaryDay(fetched, stored)).toMatchObject({ present: CANARY_MIN_ORDERS - 1, representative: false, pass: false });
    const enough = [...fetched, order(99)];
    expect(classifyCanaryDay(enough, [...stored, { id: "s99", order_guid: "o99", content_hash: "h".repeat(64), modified_at: T, latest: true }])).toMatchObject({ representative: true, pass: true });
  });
  it("judges the LATEST stored snapshot's modified_at, not an older one", () => {
    const stored = [
      { id: "old", order_guid: "o1", content_hash: "x".repeat(64), modified_at: T, latest: false },
      { id: "new", order_guid: "o1", content_hash: "y".repeat(64), modified_at: "2026-10-09T10:00:00Z", latest: true },
    ];
    expect(classifyCanaryDay([order(1, "z".repeat(64))], stored)).toMatchObject({ absent_edited: 1, absent_same_modified: 0 });
  });
});

describe("canaryToastDate (read-only, switch ON)", () => {
  const writes: string[] = [];
  beforeEach(() => {
    vi.clearAllMocks(); writes.length = 0;
    vi.stubEnv("TOAST_ORDER_CAPTURE", "1"); vi.stubEnv("TOAST_FIXTURES", "0"); vi.stubEnv("TOAST_LINE_PRICES", "");
    vi.mocked(toastConfigured).mockReturnValue(true);
    vi.mocked(toastGet).mockResolvedValueOnce(corpus.valid as never).mockResolvedValue([] as never);
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { toast_restaurant_guid: "restaurant" }, error: null }) };
    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: (table: string) => ({ ...query, insert: () => writes.push(`insert:${table}`), update: () => writes.push(`update:${table}`), upsert: () => writes.push(`upsert:${table}`) }),
      rpc: (name: string) => writes.push(`rpc:${name}`),
    } as unknown as ReturnType<typeof getServiceRoleClient>);
  });
  it("normalizes with line prices ON whatever the env says, returns identities and main's hashes, and writes nothing", async () => {
    const result = await canaryToastDate("shop", "2026-10-08");
    expect(writes).toEqual([]);
    const frozen = new Map(golden.entries.map((e) => [e.label, e.capture]));
    expect(result.orders).toEqual(corpus.valid.map((raw) => ({ order_guid: raw.guid, content_hash: frozen.get(`valid:${raw.guid}`)!.hash,
      modified_at: (frozen.get(`valid:${raw.guid}`)!.out as { order: { modified_at: string | null } }).order.modified_at })));
    expect(JSON.stringify(result)).not.toMatch(/price|PRIVATE|cents/);
  });
  it("skips (does not throw) when capture is disabled", async () => {
    vi.stubEnv("TOAST_ORDER_CAPTURE", "0");
    expect(await canaryToastDate("shop", "2026-10-08")).toEqual({ skipped: "capture_disabled_or_fixture", orders: [] });
  });
});

describe("scripts/toast-line-price-canary", () => {
  it("defaults to T−10 and T−11 (ET) and accepts explicit closed days", () => {
    expect(parseCanaryArgs([], "2026-11-16")).toEqual({ dates: ["2026-11-06", "2026-11-05"], location: null });
    expect(parseCanaryArgs(["--date", "2026-10-01", "--date", "2026-10-02", "--location", "00000000-0000-4000-8000-000000000001"], "2026-11-16"))
      .toEqual({ dates: ["2026-10-01", "2026-10-02"], location: "00000000-0000-4000-8000-000000000001" });
  });
  it("refuses an open day (inside the nightly / intraday / T−4 window) and unknown arguments", () => {
    expect(() => parseCanaryArgs(["--date", "2026-11-13"], "2026-11-16")).toThrow("canary_day_not_closed");
    expect(() => parseCanaryArgs(["--write"], "2026-11-16")).toThrow("canary_unknown_argument");
  });
  it("reads only (select), chunked by order, and reports per shop-day with an overall verdict", async () => {
    const ops: string[] = [];
    const orders = Array.from({ length: 120 }, (_, i) => order(i, "a".repeat(64)));
    const sb = {
      from: (table: string) => {
        let ids: string[] = [];
        const q = {
          select: () => { ops.push(`select:${table}`); return q; },
          eq: () => q, not: () => q, order: () => q, range: () => q,
          in: (_k: string, values: string[]) => { ids = values; expect(values.length).toBeLessThanOrEqual(50); return q; },
          then: (resolve: (v: unknown) => void) => {
            const data = table === "locations" ? [{ id: "shop" }]
              : table === "toast_orders" ? ids.map((g) => ({ id: `s-${g}`, order_guid: g, content_hash: "a".repeat(64), modified_at: T }))
              : ids.map((g) => ({ order_guid: g, snapshot_id: `s-${g}` }));
            resolve({ error: null, data, count: data.length });
          },
          insert: () => { throw new Error("write"); }, update: () => { throw new Error("write"); }, upsert: () => { throw new Error("write"); },
        };
        return q;
      },
      rpc: () => { throw new Error("write"); },
    };
    const fetch = vi.fn(async () => ({ orders }));
    const report = await runCanary({ dates: ["2026-10-01", "2026-10-02"], location: null }, { sb: sb as never, fetchDay: fetch });
    expect(fetch.mock.calls).toEqual([["shop", "2026-10-01"], ["shop", "2026-10-02"]]);
    expect(new Set(ops)).toEqual(new Set(["select:locations", "select:toast_orders", "select:toast_order_latest_pointers"]));
    expect(report).toMatchObject({ pass: true, days: [{ location: "shop", date: "2026-10-01", present: 120, pass: true }, { date: "2026-10-02", pass: true }] });
  });
  // Fix round 1 (ITEM1B-r1 P2 #1): a truncated history must REFUSE, never pass. The mock below is a
  // PostgREST stand-in: it honours select's `count: "exact"`, .range() and a server row cap (`cap`).
  type Snap = { id: string; order_guid: string; content_hash: string; modified_at: string | null };
  const history = (snaps: Snap[], pointers: { order_guid: string; snapshot_id: string }[], cap = Infinity, log: string[] = []) => ({
    from: (table: string) => {
      let ids: string[] | null = null; let range: [number, number] | null = null; let counted = false;
      const q = {
        select: (_c: string, opts?: { count?: string }) => { counted = opts?.count === "exact"; return q; },
        eq: () => q, not: () => q, order: () => q,
        in: (_k: string, values: string[]) => { ids = values; return q; },
        range: (from: number, to: number) => { range = [from, to]; log.push(`${table}:${from}-${to}`); return q; },
        then: (resolve: (v: unknown) => void) => {
          const all: unknown[] = table === "locations" ? [{ id: "shop" }]
            : table === "toast_orders" ? snaps.filter((s) => !ids || ids.includes(s.order_guid))
            : pointers.filter((p) => !ids || ids.includes(p.order_guid));
          const window = range ? all.slice(range[0], range[1] + 1) : all;
          resolve({ error: null, data: window.slice(0, cap), count: counted ? all.length : null });
        },
      };
      return q;
    },
  });
  /** 50 orders, each with 3 snapshots (the 3rd is latest); order o0's latest has the SAME modified_at but
   *  another hash than Toast now returns = a violation that only the LAST page of history can reveal. */
  const violationFixture = () => {
    const snaps: Snap[] = []; const pointers: { order_guid: string; snapshot_id: string }[] = [];
    for (let i = 0; i < CANARY_MIN_ORDERS; i++) {
      for (let v = 0; v < 3; v++) snaps.push({ id: `s${String(i).padStart(3, "0")}-${v}`, order_guid: `o${i}`, content_hash: (v === 2 ? "a" : String(v)).repeat(64), modified_at: v === 2 ? T : "2026-10-08T10:00:00Z" });
      pointers.push({ order_guid: `o${i}`, snapshot_id: `s${String(i).padStart(3, "0")}-2` });
    }
    const orders = Array.from({ length: CANARY_MIN_ORDERS }, (_, i) => order(i, i === 0 ? "z".repeat(64) : "a".repeat(64)));
    return { snaps, pointers, orders };
  };
  const one = { dates: ["2026-10-01"], location: null };

  it("pages every history read to completion: a violation on a later page still FAILS", async () => {
    const { snaps, pointers, orders } = violationFixture();
    const log: string[] = [];
    const report = await runCanary(one, { sb: history(snaps, pointers, Infinity, log) as never, fetchDay: async () => ({ orders }), pageSize: 40 });
    expect(log.some((l) => l.startsWith("toast_orders:40-"))).toBe(true);
    expect(report).toMatchObject({ pass: false, days: [{ absent_same_modified: 1, violations: ["o0"] }] });
  });
  it("REFUSES (never PASS) when the server row cap truncates the snapshot history", async () => {
    const { snaps, pointers, orders } = violationFixture();
    // The server returns at most 100 rows per request whatever range was asked: o0's latest is cut off.
    await expect(runCanary(one, { sb: history(snaps, pointers, 100) as never, fetchDay: async () => ({ orders }) })).rejects.toThrow("canary_history_truncated");
  });
  it("REFUSES when a latest pointer names a snapshot the history does not contain", async () => {
    const { snaps, pointers, orders } = violationFixture();
    await expect(runCanary(one, { sb: history(snaps.filter((s) => s.id !== "s000-2"), pointers) as never, fetchDay: async () => ({ orders }) }))
      .rejects.toThrow("canary_snapshot_history_missing");
  });
  it("REFUSES when an order has stored snapshots but no latest pointer", async () => {
    const { snaps, pointers, orders } = violationFixture();
    await expect(runCanary(one, { sb: history(snaps, pointers.filter((p) => p.order_guid !== "o0")) as never, fetchDay: async () => ({ orders }) }))
      .rejects.toThrow("canary_latest_pointer_missing");
  });
  it("REFUSES when a read hits the page cap", async () => {
    const { snaps, pointers, orders } = violationFixture();
    await expect(runCanary(one, { sb: history(snaps, pointers) as never, fetchDay: async () => ({ orders }), pageSize: 10, maxPages: 3 }))
      .rejects.toThrow("canary_page_cap");
  });
  it("REFUSES when the server does not report a row count", async () => {
    const { snaps, pointers, orders } = violationFixture();
    const sb = history(snaps, pointers);
    const from = sb.from;
    const uncounted = { from: (t: string) => { const q = from(t); const select = q.select; q.select = (c: string) => select(c); return q; } };
    await expect(runCanary(one, { sb: uncounted as never, fetchDay: async () => ({ orders }) })).rejects.toThrow("canary_history_uncounted");
  });

  it("fails overall on any violation or any day that could not be judged", async () => {
    const sb = { from: () => { const q = { select: () => q, eq: () => q, not: () => q, order: () => q, in: () => q, range: () => q,
      then: (r: (v: unknown) => void) => r({ error: null, data: [{ id: "shop" }], count: 1 }) }; return q; } };
    const report = await runCanary({ dates: ["2026-10-01"], location: null }, { sb: sb as never, fetchDay: async () => ({ skipped: "capture_disabled_or_fixture", orders: [] }) });
    expect(report).toMatchObject({ pass: false, days: [{ skipped: "capture_disabled_or_fixture", pass: false }] });
  });
});
