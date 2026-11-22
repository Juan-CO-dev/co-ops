/**
 * Nav PR 8 (plan r2 7.4, 8): the role blocks' reads under PR 7's one page deadline.
 *
 * T-D5 (A3, E5): `settleBy` aborts its signal on a REJECTION too, so a cell that runs several reads under one signal
 * cancels its surviving siblings the moment one rejects. Success does not abort. PR 7's own settleBy / deadline tests
 * (tests/dashboard-page-flow.test.ts, tests/dashboard-read-cancellation.test.ts) re-run unchanged.
 * The read budget (8): the OBSERVED requests per viewer, paging included (a fixture large enough to force a second page
 * of `vendor_mail_read` and `catering_pipeline`). Provisional, not a ceiling; the preview timing is the gate.
 * T-D2: after the deadline no next query (no page two, no fingerprint after a hung coverage read, no quotes after a hung
 * pipeline read). T-D4: a hanging AUTHORIZATION read is cancelled at the deadline and no count is ever issued.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { blocksClient, blocksState, countBy, type BlocksDbState } from "./helpers/blocks-fake-db";

const db = vi.hoisted(() => ({ state: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", async () => {
  const { blocksClient: make } = await import("./helpers/blocks-fake-db");
  return { getServiceRoleClient: () => make(db.state as never) };
});

import { settleBy, type Settle } from "@/lib/dashboard-day";
import { loadCateringBlockExtras, loadNeedsYou, loadStrip } from "@/lib/dashboard-blocks";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import type { AuthContext } from "@/lib/session";

const NOW = new Date("2026-11-18T18:45:00.000Z");
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });

describe("T-D5 (E5): settleBy aborts on rejection", () => {
  it("a rejection aborts the signal, resolves failed at once and leaves no timer", async () => {
    let signal: AbortSignal | null = null;
    const r = settleBy((s) => { signal = s; return Promise.reject(new Error("x")); }, Date.now() + 6_000, "t");
    expect(await r).toEqual({ kind: "failed" });
    expect(signal!.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a synchronous throw aborts the signal too", async () => {
    let signal: AbortSignal | null = null;
    expect(await settleBy((s) => { signal = s; throw new Error("sync"); }, Date.now() + 6_000, "t")).toEqual({ kind: "failed" });
    expect(signal!.aborted).toBe(true);
  });

  it("success does not abort", async () => {
    let signal: AbortSignal | null = null;
    expect(await settleBy(async (s) => { signal = s; return 1; }, Date.now() + 6_000, "t")).toEqual({ kind: "ok", value: 1 });
    expect(signal!.aborted).toBe(false);
  });

  it("one sibling rejects at 100 ms while the other hangs: failed at 100 ms, the hanging sibling's signal aborted then", async () => {
    let hanging: AbortSignal | null = null;
    let hangingSaw = false;
    const r = settleBy((s) => Promise.all([
      new Promise((_, reject) => setTimeout(() => reject(new Error("ezcater")), 100)),
      new Promise((resolve) => { hanging = s; s.addEventListener("abort", () => { hangingSaw = true; resolve(null); }); }),
    ]), Date.now() + 6_000, "t");
    let done = false;
    void r.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(99);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await r).toEqual({ kind: "failed" });
    expect(hanging!.aborted).toBe(true);
    expect(hangingSaw).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ── The loaders over one fake database ───────────────────────────────────────────────────────────────────────────────

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const PLAN = "2026-11-18";
const FP = "f".repeat(32);
const ids = { moo: "a0000000-0000-4000-8000-000000000001", cgs: "a0000000-0000-4000-8000-000000000002", gm: "a0000000-0000-4000-8000-000000000003",
  cat: "a0000000-0000-4000-8000-000000000004", owner: "a0000000-0000-4000-8000-000000000005" };
const authOf = (key: keyof typeof ids, role: string, level: number, locations: string[]): AuthContext =>
  ({ user: { id: ids[key], role, active: true, name: key, language: "en" }, session: { id: "s" }, role, level, locations }) as unknown as AuthContext;
const MOO = authOf("moo", "moo", 8, [S1]);
const CGS = authOf("cgs", "cgs", 10, []);
const OWNER = authOf("owner", "owner", 9, []);
const GM = authOf("gm", "gm", 7, [S1]);
const CAT = authOf("cat", "catering_mgr", 6, [S1]);
const SHOPS = [{ id: S1, code: "P", name: "P Street" }, { id: S2, code: "CH", name: "Capitol Hill" }];

function seed(o: { big?: boolean } = {}): BlocksDbState {
  const st = blocksState();
  st.tables.users = Object.entries(ids).map(([k, id]) => ({ id, active: true, role: k === "cat" ? "catering_mgr" : k }));
  st.tables.user_locations = [{ user_id: ids.moo, location_id: S1, active: true }, { user_id: ids.gm, location_id: S1, active: true }, { user_id: ids.cat, location_id: S1, active: true }];
  st.tables.labor_week_coverage = ["2026-11-08", "2026-11-15"].map((week_start) => ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-17T05:00:00Z", source_fingerprint: FP }));
  st.tables.schedule_structures = [];
  const lead = (i: number, loc = S1) => ({ id: `lead-${loc}-${i}`, location_id: loc, contact_name: "x", company: null, event_date: PLAN, time_window: null, headcount: 10, stage: "confirmed",
    delivery_address: null, estimated_revenue_cents: 10_000 });
  st.tables.catering_pipeline = [...Array.from({ length: o.big ? 1001 : 2 }, (_, i) => lead(i)), lead(0, S2)];
  st.tables.catering_quotes = [];
  st.tables.ezcater_orders = [{ id: "ez1", location_id: S1, event_date: PLAN, lead_id: null, event_timestamp: null, handoff_time: null, headcount: 5, total_cents: 900, status: "confirmed" }];
  const mail = (i: number) => ({ id: `m${i}`, effective_location_id: S1, received_at: "2026-11-10T10:00:00Z", is_stale: true, handled_at: null, receipt: null, archive_state: "pending", attachment_manifest: [] });
  st.tables.vendor_mail_read = Array.from({ length: o.big ? 1001 : 2 }, (_, i) => mail(i));
  st.tables.recipe_versions = [];
  st.tables.recipe_notice_dismissals = [];
  st.tables.catering_inbound_messages = [{ id: "c1", inbound_message_id: "i1", location_id: S1, disposition: "needs_human" }, { id: "c2", inbound_message_id: "i2", location_id: null, disposition: "recorded" }];
  st.tables.inbound_messages = [];
  st.tables.ezcater_reconciliation_status = [];
  st.tables.catering_toast_settings = [];
  st.tables.catering_reconciliation_status = [];
  st.rpcs.pulse_sales_today = () => ({ classes: [{ business_date: PLAN, sale_class: "sale", checks: 3, amount_cents: 4_500, tax_cents: 0, amount_missing: 0 }], discounts: [], refunds: [], captured_days: [PLAN], captured_at: "2026-11-18T18:00:00Z" });
  st.rpcs.sales_report_daily = (a) => ({ classes: [], tips: [], discounts: [], refunds: [], captured_days: [String(a.p_from)], ezcater: [] });
  st.rpcs.fact_labor_cost = () => [{ week_start: "2026-11-15", location_id: S1, hourly_straight_cents: 900, ot_premium_cents: 0, salaried_cents: 100, salary_basis: "wages", burden_pct: 12,
    burden_basis: "estimated", estimated_rate_minutes: 0, hourly_minutes: 30, ot_minutes: 0, salaried_minutes: 0, ot_state: "assessed", range_days: 1, days_covered: 1, days_pending: 0,
    days_fallback: 0, days_incomplete: 0, days_missing: 0, open_punches: 0 }];
  st.rpcs.fact_labor_week_fingerprint = () => FP;
  return st;
}
const settleNow = (): Settle => { const at = Date.now() + 6_000; return (area, run) => settleBy(run, at, area); };
const SWITCHES_ON = { businessReport: true };
const onEnv = () => { vi.stubEnv("BUSINESS_REPORT", "1"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1"); };

describe("the read budget, observed (provisional; paging included)", () => {
  beforeEach(() => { vi.useRealTimers(); onEnv(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function run(who: AuthContext, parts: { strip?: boolean; needs?: boolean; block?: boolean }, o: { big?: boolean } = {}) {
    const st = seed(o);
    db.state = st;
    const sb = blocksClient(st) as never;
    const shops = who.level >= 9 ? SHOPS : SHOPS.filter((s) => who.locations.includes(s.id));
    const out = await Promise.all([
      parts.strip ? loadStrip(sb, who, shops, PLAN, SWITCHES_ON, settleNow()) : null,
      parts.needs ? loadNeedsYou(who, S1, settleNow()) : null,
      parts.block ? loadCateringBlockExtras(sb, who, S1, PLAN, settleNow()) : null,
    ]);
    return { st, out };
  }
  const STRIP_ONE_SHOP = { "rpc:pulse_sales_today": 1, "table:labor_week_coverage": 2, "rpc:sales_report_daily": 1, "rpc:fact_labor_cost": 3,
    "table:schedule_structures": 1, "rpc:fact_labor_week_fingerprint": 1, "table:catering_pipeline": 1, "table:catering_quotes": 1, "table:ezcater_orders": 1 };
  const times = (r: Record<string, number>, k: number) => Object.fromEntries(Object.entries(r).map(([n, c]) => [n, c * k]));
  const plus = (...rs: Array<Record<string, number>>) => {
    const out: Record<string, number> = {};
    for (const r of rs) for (const [n, c] of Object.entries(r)) out[n] = (out[n] ?? 0) + c;
    return out;
  };
  const NEEDS = (inboxCounts: number) => ({ "table:users": 2, "table:user_locations": 2, "table:vendor_mail_read": 1,
    "table:recipe_versions": 2, "table:recipe_notice_dismissals": 1, "table:catering_inbound_messages": inboxCounts / 2, "table:inbound_messages": inboxCounts / 2 });

  it("CGS, two shops: (strip x 2) + Needs you (inbox shop + unplaced); every cell ok", async () => {
    const { st, out } = await run(CGS, { strip: true, needs: true });
    const strip = out[0]!;
    expect(strip.map((r) => [r.sales.kind, r.labor === "off" ? "off" : r.labor.kind, r.catering.kind])).toEqual([["ok", "ok", "ok"], ["ok", "ok", "ok"]]);
    expect(countBy(st.calls)).toEqual(plus(times(STRIP_ONE_SHOP, 2), NEEDS(4)));
  });

  it("Owner, two shops: the same as the CGS", async () => {
    const { st } = await run(OWNER, { strip: true, needs: true });
    expect(countBy(st.calls)).toEqual(plus(times(STRIP_ONE_SHOP, 2), NEEDS(4)));
  });

  it("MoO, one member shop: strip x 1 + Needs you", async () => {
    const { st } = await run(MOO, { strip: true, needs: true });
    expect(countBy(st.calls)).toEqual(plus(STRIP_ONE_SHOP, NEEDS(4)));
  });

  it("GM: Needs you only (inbox: the shop's two counts, no unplaced)", async () => {
    const { st } = await run(GM, { needs: true });
    expect(countBy(st.calls)).toEqual(NEEDS(2));
  });

  it("catering manager: the block's inbox (shop + unplaced) and not-rung (view + settings)", async () => {
    const { st } = await run(CAT, { block: true });
    expect(countBy(st.calls)).toEqual({ "table:users": 1, "table:user_locations": 1, "table:catering_inbound_messages": 2, "table:inbound_messages": 2,
      "table:ezcater_reconciliation_status": 1, "table:catering_toast_settings": 1 });
  });

  it("paging: a second page of vendor_mail_read and catering_pipeline, and the quote chunks, are observed", async () => {
    const { st, out } = await run(MOO, { strip: true, needs: true }, { big: true });
    const c = countBy(st.calls);
    expect(c["table:vendor_mail_read"]).toBe(2);
    expect(c["table:catering_pipeline"]).toBe(2);
    expect(c["table:catering_quotes"]).toBe(11); // 1,001 leads in chunks of 100
    expect(out[1]!.vendorMail).toEqual({ kind: "ok", value: 1001 });
    expect(out[0]![0]!.catering).toMatchObject({ kind: "ok", value: { orders: 1002, pipeline: 1001, unlinkedEzcater: 1, valuedCents: 10_010_000, estimated: 1001 } });
  });

  it("the switch off: no labor read and no labor cell (off)", async () => {
    const st = seed();
    db.state = st;
    const r = await loadStrip(blocksClient(st) as never, MOO, [SHOPS[0]!], PLAN, { businessReport: false }, settleNow());
    expect(r[0]!.labor).toBe("off");
    expect(st.calls.map((c) => c.name)).not.toContain("labor_week_coverage");
    expect(st.calls.map((c) => c.name)).not.toContain("fact_labor_cost");
  });

  it("every request carried a signal", async () => {
    const { st } = await run(CGS, { strip: true, needs: true });
    expect(st.calls.filter((c) => c.signal === null).map((c) => c.name)).toEqual([]);
  });
});

describe("T-D2 / T-D4 / T-D5: cancellation", () => {
  beforeEach(() => { onEnv(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function expire<T>(p: Promise<T>, st: BlocksDbState) {
    await vi.advanceTimersByTimeAsync(5_999);
    const before = st.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    const atExpiry = st.calls.length;
    await vi.advanceTimersByTimeAsync(200); // late responses land; a reader carries on as far as it can
    return { result: await p, before, atExpiry, after: st.calls.length };
  }

  it("T-D2: a hung first page of vendor_mail_read (a full page landing late) issues no page two", async () => {
    const st = seed({ big: true });
    st.behave.vendor_mail_read = { hang: true };
    db.state = st;
    const r = await expire(loadNeedsYou(GM, S1, settleNow()), st);
    expect(r.result.vendorMail).toEqual({ kind: "timed_out" });
    expect(st.calls.filter((c) => c.name === "vendor_mail_read")).toHaveLength(1);
    expect(st.calls.find((c) => c.name === "vendor_mail_read")!.signal!.aborted).toBe(true);
    expect(r.after).toBe(r.atExpiry);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("T-D2: a hung coverage read: no fingerprint read after the deadline", async () => {
    const st = seed();
    st.behave.labor_week_coverage = { hang: true };
    db.state = st;
    const r = await expire(loadStrip(blocksClient(st) as never, MOO, [SHOPS[0]!], PLAN, SWITCHES_ON, settleNow()), st);
    expect(r.result[0]!.labor).toEqual({ kind: "timed_out" });
    expect(st.calls.map((c) => c.name)).not.toContain("fact_labor_week_fingerprint");
    expect(st.calls.map((c) => c.name)).not.toContain("fact_labor_cost");
  });

  it("T-D2: a hung pipeline read: no quotes read after the deadline", async () => {
    const st = seed();
    st.behave.catering_pipeline = { hang: true };
    db.state = st;
    const r = await expire(loadStrip(blocksClient(st) as never, MOO, [SHOPS[0]!], PLAN, { businessReport: false }, settleNow()), st);
    expect(r.result[0]!.catering).toEqual({ kind: "timed_out" });
    expect(st.calls.map((c) => c.name)).not.toContain("catering_quotes");
    expect(r.result[0]!.sales.kind).toBe("ok"); // the other cells stand
  });

  it("T-D4: inboxReader's users read hangs: aborted at the deadline, the cell timed out, no count query ever", async () => {
    const st = seed();
    st.behave.users = { hang: true };
    db.state = st;
    const r = await expire(loadCateringBlockExtras(blocksClient(st) as never, CAT, S1, PLAN, settleNow()), st);
    expect(r.result.inbox).toEqual({ kind: "timed_out" });
    expect(st.calls.find((c) => c.name === "users")!.signal!.aborted).toBe(true);
    expect(st.calls.filter((c) => c.name === "catering_inbound_messages" || c.name === "inbound_messages")).toEqual([]);
    expect(r.result.notRung.kind).toBe("ok");
  });

  it.each(["users", "user_locations"])("T-D4: vendor mail's reader %s read hangs: aborted, no list read", async (table) => {
    const st = seed();
    st.behave[table] = { hang: true };
    db.state = st;
    const r = await expire(loadNeedsYou(GM, S1, settleNow()), st);
    expect(r.result.vendorMail).toEqual({ kind: "timed_out" });
    expect(st.calls.filter((c) => c.name === table).every((c) => c.signal!.aborted)).toBe(true);
    expect(st.calls.map((c) => c.name)).not.toContain("vendor_mail_read");
  });

  it("T-D5: in the catering strip cell, ezCater rejects at 100 ms while the pipeline hangs: failed at 100 ms, the pipeline's signal aborted, no further query", async () => {
    const st = seed();
    st.behave.catering_pipeline = { hang: true };
    st.behave.ezcater_orders = { rejectAfterMs: 100 };
    db.state = st;
    let caught: Awaited<ReturnType<typeof loadStrip>> | null = null;
    const p = loadStrip(blocksClient(st) as never, MOO, [SHOPS[0]!], PLAN, { businessReport: false }, settleNow()).then((r) => { caught = r; return r; });
    await vi.advanceTimersByTimeAsync(99);
    expect(caught).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    const result = await p;
    expect(result[0]!.catering).toEqual({ kind: "failed" });
    const pipeline = st.calls.find((c) => c.name === "catering_pipeline")!;
    expect(pipeline.signal!.aborted).toBe(true);
    const n = st.calls.length;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(st.calls.length).toBe(n);
    expect(st.calls.map((c) => c.name)).not.toContain("catering_quotes");
    expect(vi.getTimerCount()).toBe(0);
  });
});
