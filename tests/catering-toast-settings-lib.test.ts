/**
 * Item 21 PR 5: lib/catering/catering-toast-settings.ts. The role is bound before any I/O; "not installed" is never a
 * 500; the older orders are matched by the house reconciler itself (0348), one stretch of dates per step, after the
 * note lookup examined that stretch. The lib decides nothing: it sequences, counts and records who started it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { CateringToastSettingsError, loadBackfillStatus, loadCateringToastSettings, runBackfillStep, saveCateringToastSettings } from "@/lib/catering/catering-toast-settings";
import { audit } from "@/lib/audit";
import { DEFAULT_CATERING_TOAST_SETTINGS as OFF } from "@/lib/catering/catering-toast-settings-shared";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null };
const SHOP = "00000000-0000-4000-8000-000000000001";
const actor = (role: string): AuthContext => ({ user: { id: "user-1", role }, role, level: 8, locations: [], session: {} } as unknown as AuthContext);

/** A chainable PostgREST stand-in. Tables and RPCs answer functions of the filters applied (`eq` / `in` / `range`). */
function client(tables: Record<string, (q: Query) => Result>, rpcs: Record<string, (params: Record<string, unknown>, q: Query) => Result>) {
  const reads: string[] = [];
  const signals: string[] = [];
  const chain = (name: string, answer: (q: Query) => Result) => {
    const query: Query = { eq: {}, in: {}, gte: {}, lte: {}, range: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "not", "order"]) q[m] = () => q;
    q.abortSignal = (signal: unknown) => { if (signal instanceof AbortSignal) signals.push(name); return q; };
    q.gte = (col: string, value: unknown) => { query.gte[col] = value; return q; };
    q.lte = (col: string, value: unknown) => { query.lte[col] = value; return q; };
    q.eq = (col: string, value: unknown) => { query.eq[col] = value; return q; };
    q.in = (col: string, value: unknown[]) => { query.in[col] = value; return q; };
    q.range = (from: number, to: number) => { query.range = [from, to]; return q; };
    const settle = () => { reads.push(name); return Promise.resolve(answer(query)); };
    q.maybeSingle = () => settle();
    q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => settle().then(resolve, reject);
    return q;
  };
  const sb = {
    from: (name: string) => chain(name, (q) => { const t = tables[name]; if (!t) throw new Error(`unexpected table ${name}`); return t(q); }),
    rpc: (name: string, params: Record<string, unknown>) => chain(name, (q) => { const f = rpcs[name]; if (!f) throw new Error(`unexpected rpc ${name}`); return f(params, q); }),
  };
  return { sb: sb as never, reads, signals };
}
interface Query { eq: Record<string, unknown>; in: Record<string, unknown[]>; gte: Record<string, unknown>; lte: Record<string, unknown>; range: [number, number] | null }

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.useRealTimers(); });

describe("the role is bound before any I/O", () => {
  it("every entry point refuses a GM, the catering manager and the social media manager without touching the database", async () => {
    const { sb, reads } = client({}, {});
    for (const role of ["gm", "catering_mgr", "social_media_mgr", "agm"]) {
      const who = actor(role);
      for (const run of [() => loadCateringToastSettings(who, { client: sb }), () => saveCateringToastSettings(who, { locationId: SHOP, values: OFF, expectedUpdatedAt: null }, { client: sb }),
        () => loadBackfillStatus(who, SHOP, { client: sb }), () => runBackfillStep(who, SHOP, null, { client: sb })]) {
        await expect(run()).rejects.toMatchObject({ status: 403, code: "forbidden" });
      }
    }
    expect(reads).toEqual([]);
  });
});

describe("loadCateringToastSettings", () => {
  const shops = () => ({ data: [{ id: SHOP, name: "Shop" }, { id: "b", name: "Other" }], error: null });
  it("0350 missing (the probe is not there) or 0344 missing (the table is not there) = not installed", async () => {
    expect(await loadCateringToastSettings(actor("moo"), { client: client({}, { catering_toast_settings_ready: () => ({ error: { code: "PGRST202" } }) }).sb })).toEqual({ state: "not_installed" });
    expect(await loadCateringToastSettings(actor("moo"), { client: client({ locations: shops, catering_toast_settings: () => ({ error: { code: "42P01" } }) },
      { catering_toast_settings_ready: () => ({ data: { link_step: true, automatic: true }, error: null }) }).sb })).toEqual({ state: "not_installed" });
  });
  it("a failed probe or a failed read is 503, never an empty list of shops", async () => {
    await expect(loadCateringToastSettings(actor("moo"), { client: client({}, { catering_toast_settings_ready: () => ({ error: { code: "57014" } }) }).sb }))
      .rejects.toMatchObject({ status: 503, code: "settings_unavailable" });
    await expect(loadCateringToastSettings(actor("moo"), { client: client({ locations: shops, catering_toast_settings: () => ({ error: { code: "57014" } }) },
      { catering_toast_settings_ready: () => ({ data: { link_step: true, automatic: true }, error: null }) }).sb })).rejects.toMatchObject({ status: 503 });
  });
  it("every active shop: its row, or the defaults (off) when it has none; the probe's facts as they are", async () => {
    const view = await loadCateringToastSettings(actor("owner"), { client: client({ locations: shops,
      catering_toast_settings: () => ({ data: [{ location_id: SHOP, enabled: true, ring_code_enabled: false, auto_link_enabled: false, origin_auto_link_enabled: true,
        include_toast_origin_leads: false, tolerance_cents: 2500, tolerance_pct: "0.100", auto_link_from_date: "2026-11-19", updated_at: "2026-11-19T12:00:00+00:00" }], error: null }) },
      { catering_toast_settings_ready: () => ({ data: { link_step: true, automatic: false }, error: null }) }).sb });
    expect(view).toEqual({ state: "ready", readiness: { linkStep: true, automatic: false }, shops: [
      { locationId: SHOP, name: "Shop", updatedAt: "2026-11-19T12:00:00+00:00",
        values: { ...OFF, enabled: true, originAutoLinkEnabled: true, toleranceCents: 2500, tolerancePct: 0.1, autoLinkFromDate: "2026-11-19" } },
      { locationId: "b", name: "Other", updatedAt: null, values: OFF }] });
  });
});

const NOW = new Date("2026-11-19T15:00:00Z");
/** A shop with a settings row, unmatched orders on `dates`, and `uncovered` answers handed out in order. */
function shopWith(opts: { row?: Record<string, unknown> | null; dates?: string[]; uncovered?: number[]; reconcile?: (p: Record<string, unknown>) => Result } = {}) {
  const row = opts.row === undefined ? { enabled: true, auto_link_enabled: false, origin_auto_link_enabled: true, auto_link_from_date: "2025-10-01" } : opts.row;
  const uncovered = [...(opts.uncovered ?? [0])];
  const calls: Array<[string, Record<string, unknown>]> = [];
  const c = client({
    catering_toast_settings: () => ({ data: row, error: null }),
    catering_reconciliation_status: (q) => ({ data: (opts.dates ?? []).filter((d) => !q.gte.event_date || d >= (q.gte.event_date as string))
      .filter((d) => d <= (q.lte.event_date as string)).map((d, i) => ({ lead_id: `lead-${i}`, event_date: d })), error: null }),
  }, {
    catering_toast_uncovered_orders: (p) => { calls.push(["uncovered", p]); const n = uncovered.length > 1 ? uncovered.shift()! : uncovered[0]!; return { data: Array.from({ length: n }, (_, i) => ({ order_guid: `o${i}` })), error: null }; },
    reconcile_catering_toast: (p) => { calls.push(["reconcile", p]); return opts.reconcile ? opts.reconcile(p) : { data: { added: 3, ring_code: 0, toast_origin: 3, already_linked: 0, skipped: { owned: 1, evidence_pending: 2 } }, error: null }; },
  });
  return { ...c, calls };
}
const noCover = vi.fn(async () => ({ lookups: 0, examined: 0, failed: 0 }));

describe("the older orders: status", () => {
  it("a shop that is off, or has no automatic switch, says so; 0344 missing is not installed", async () => {
    expect(await loadBackfillStatus(actor("moo"), SHOP, { client: shopWith({ row: null }).sb, now: NOW })).toMatchObject({ state: "off", unmatched: 0 });
    expect(await loadBackfillStatus(actor("moo"), SHOP, { client: shopWith({ row: { enabled: false, auto_link_enabled: true, origin_auto_link_enabled: false, auto_link_from_date: "2025-10-01" } }).sb, now: NOW }))
      .toMatchObject({ state: "off" });
    expect(await loadBackfillStatus(actor("moo"), SHOP, { client: shopWith({ row: { enabled: true, auto_link_enabled: false, origin_auto_link_enabled: false, auto_link_from_date: null }, dates: ["2026-01-01"] }).sb, now: NOW }))
      .toEqual({ state: "no_switch", startDate: null, unmatched: 1, fromStart: 0, beforeStart: 1 });
    const missing = client({ catering_toast_settings: () => ({ error: { code: "42P01" } }) }, {});
    expect((await loadBackfillStatus(actor("moo"), SHOP, { client: missing.sb, now: NOW })).state).toBe("not_installed");
  });
  it("ready: the unmatched orders, split at the start date (never a made-up zero: a failed read is 503)", async () => {
    expect(await loadBackfillStatus(actor("owner"), SHOP, { client: shopWith({ dates: ["2025-09-01", "2025-09-30", "2025-10-01", "2026-11-19"] }).sb, now: NOW }))
      .toEqual({ state: "ready", startDate: "2025-10-01", unmatched: 4, fromStart: 2, beforeStart: 2 });
    const broken = client({ catering_toast_settings: () => ({ data: { enabled: true, auto_link_enabled: true, origin_auto_link_enabled: false, auto_link_from_date: "2025-10-01" }, error: null }),
      catering_reconciliation_status: () => ({ error: { code: "57014" } }) }, {});
    await expect(loadBackfillStatus(actor("moo"), SHOP, { client: broken.sb, now: NOW })).rejects.toMatchObject({ status: 503, code: "settings_unavailable" });
  });
});

describe("the older orders: one step", () => {
  it("refused by name where it cannot run, before any lookup or link", async () => {
    const off = shopWith({ row: { enabled: false, auto_link_enabled: true, origin_auto_link_enabled: false, auto_link_from_date: "2025-10-01" } });
    await expect(runBackfillStep(actor("moo"), SHOP, null, { client: off.sb, now: NOW, cover: noCover })).rejects.toMatchObject({ status: 409, code: "switch_needs_enabled" });
    const none = shopWith({ row: { enabled: true, auto_link_enabled: false, origin_auto_link_enabled: false, auto_link_from_date: "2025-10-01" } });
    await expect(runBackfillStep(actor("moo"), SHOP, null, { client: none.sb, now: NOW, cover: noCover })).rejects.toMatchObject({ status: 409, code: "backfill_needs_switch" });
    expect([...off.calls, ...none.calls]).toEqual([]);
    expect(noCover).not.toHaveBeenCalled();
  });

  it("nothing unmatched from the cursor on: done, and nothing is called", async () => {
    const s = shopWith({ dates: ["2025-09-01"] });
    expect(await runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover: noCover })).toMatchObject({ phase: "done", next: null, added: 0, from: null });
    expect(s.calls).toEqual([]);
  });

  it("a stretch with every capture examined: the reconciler runs over exactly that stretch, the counts are its own, and ONE audit row names the person", async () => {
    const s = shopWith({ dates: ["2025-10-06", "2025-10-20", "2026-11-18"] });
    const who = actor("cgs");
    const step = await runBackfillStep(who, SHOP, null, { client: s.sb, now: NOW, cover: noCover });
    expect(step).toEqual({ phase: "linked", from: "2025-10-06", to: "2025-12-05", examined: 0, pendingOrders: 0, added: 3, ringCode: 0, toastOrigin: 3,
      skipped: { owned: 1, evidence_pending: 2 }, next: "2025-12-06" });
    expect(s.calls).toEqual([["uncovered", { p_location_id: SHOP, p_from: "2025-10-05", p_to: "2025-12-12" }],
      ["reconcile", { p_location_id: SHOP, p_from: "2025-10-06", p_to: "2025-12-05" }]]);
    expect(noCover).not.toHaveBeenCalled();
    expect(vi.mocked(audit).mock.calls.map((c) => c[0])).toEqual([{ actorId: "user-1", actorRole: "cgs", action: "catering.toast_backfill", resourceTable: "catering_toast_links", resourceId: null,
      metadata: { location_id: SHOP, from: "2025-10-06", to: "2025-12-05", added: 3, ring_code: 0, toast_origin: 3, skipped: { owned: 1, evidence_pending: 2 } }, ipAddress: null, userAgent: null }]);
  });

  it("the last stretch ends at today and ends the run; a run that added nothing writes no audit row", async () => {
    const s = shopWith({ dates: ["2026-11-10"], reconcile: () => ({ data: { added: 0, ring_code: 0, toast_origin: 0, already_linked: 1, skipped: {} }, error: null }) });
    expect(await runBackfillStep(actor("moo"), SHOP, "2026-01-01", { client: s.sb, now: NOW, cover: noCover })).toMatchObject({ phase: "done", from: "2026-11-10", to: "2026-11-19", added: 0, next: null });
    // The look-ahead for late rings never passes today.
    expect(s.calls[0]).toEqual(["uncovered", { p_location_id: SHOP, p_from: "2026-11-09", p_to: "2026-11-19" }]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("the cursor never reaches before the shop's start date, whatever is sent", async () => {
    const s = shopWith({ dates: ["2025-09-01", "2025-10-06"] });
    await runBackfillStep(actor("moo"), SHOP, "2020-01-01", { client: s.sb, now: NOW, cover: noCover });
    expect(s.calls.find((c) => c[0] === "reconcile")![1]).toMatchObject({ p_from: "2025-10-06" });
  });

  it("review PORTAL5-r1 P1: unexamined captures are looked up FIRST. Progress with more left = 'checking' with the same cursor, and nothing is linked", async () => {
    const s = shopWith({ dates: ["2025-10-06"], uncovered: [40, 25] });
    const cover = vi.fn(async (...args: unknown[]) => { void args; return { lookups: 6, examined: 15, failed: 0 }; });
    const step = await runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover });
    expect(step).toMatchObject({ phase: "checking", from: "2025-10-06", to: "2025-12-05", examined: 15, pendingOrders: 25, added: 0, next: "2025-10-06" });
    expect(cover.mock.calls[0]![1]).toMatchObject({ from: "2025-10-05", to: "2025-12-12", onlyLocationId: SHOP });
    expect(s.calls.map((c) => c[0])).toEqual(["uncovered", "uncovered"]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("the lookup finished the stretch: the same step goes on to link", async () => {
    const s = shopWith({ dates: ["2025-10-06"], uncovered: [12, 0] });
    const cover = vi.fn(async () => ({ lookups: 3, examined: 12, failed: 0 }));
    expect((await runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover })).phase).toBe("linked");
    expect(s.calls.map((c) => c[0])).toEqual(["uncovered", "uncovered", "reconcile"]);
  });

  it("a lookup that made NO progress does not loop for ever: the stretch is reconciled, and what was not examined is the reconciler's 'evidence_pending' (never a link)", async () => {
    const s = shopWith({ dates: ["2025-10-06"], uncovered: [7] });
    const cover = vi.fn(async () => ({ lookups: 2, examined: 0, failed: 1 }));
    const step = await runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover });
    expect(step.phase).toBe("linked");
    expect(step.skipped.evidence_pending).toBe(2);
    expect(s.calls.map((c) => c[0])).toEqual(["uncovered", "reconcile"]);
  });

  it("review PORTAL5-r2 P2: every request of a step carries the step's own deadline signal", async () => {
    const s = shopWith({ dates: ["2025-10-06"], uncovered: [3, 0] });
    const cover = vi.fn(async (...args: unknown[]) => { void args; return { lookups: 1, examined: 3, failed: 0 }; });
    await runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover });
    expect(s.reads).toEqual(["catering_toast_settings", "catering_reconciliation_status", "catering_toast_uncovered_orders", "catering_toast_uncovered_orders", "reconcile_catering_toast"]);
    expect(s.signals).toEqual(s.reads);
    expect((cover.mock.calls[0]![1] as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
  });

  it("review PORTAL5-r2 P2: a deadline that has already passed starts NOTHING (no read, no lookup, no reconcile)", async () => {
    const s = shopWith({ dates: ["2025-10-06"], uncovered: [3] });
    const cover = vi.fn(async () => ({ lookups: 1, examined: 3, failed: 0 }));
    await expect(runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover, deadlineAt: Date.now() - 1 })).rejects.toMatchObject({ status: 503, code: "backfill_timeout" });
    expect(s.reads).toEqual([]);
    expect(s.calls).toEqual([]);
    expect(cover).not.toHaveBeenCalled();
  });

  it("review PORTAL5-r2 P2: a request that never answers cannot hold the step past its deadline, whichever request it is; nothing is linked after it", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const never = () => new Promise<never>(() => {});
    const stalls: Array<[string, () => ReturnType<typeof shopWith>]> = [
      ["the settings read", () => { const s = shopWith({ dates: ["2025-10-06"] }); stall(s, "catering_toast_settings"); return s; }],
      ["the unmatched orders", () => { const s = shopWith({ dates: ["2025-10-06"] }); stall(s, "catering_reconciliation_status"); return s; }],
      ["the uncovered orders", () => { const s = shopWith({ dates: ["2025-10-06"] }); stall(s, "catering_toast_uncovered_orders"); return s; }],
      ["the reconciler", () => { const s = shopWith({ dates: ["2025-10-06"] }); stall(s, "reconcile_catering_toast"); return s; }],
    ];
    function stall(s: ReturnType<typeof shopWith>, name: string) {
      const sb = s.sb as unknown as { from: (n: string) => unknown; rpc: (n: string, p: Record<string, unknown>) => unknown };
      const from = sb.from.bind(sb), rpc = sb.rpc.bind(sb);
      const hang = () => { const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "gte", "lte", "order", "range", "abortSignal"]) q[m] = () => q; q.maybeSingle = never; q.then = (a: never, b: never) => never().then(a, b); return q; };
      sb.from = (n) => (n === name ? hang() : from(n));
      sb.rpc = (n, p) => (n === name ? hang() : rpc(n, p));
    }
    for (const [what, make] of stalls) {
      const s = make();
      const pending = runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover: noCover, deadlineAt: Date.now() + 5_000 });
      let outcome: unknown = "pending";
      void pending.then((v) => { outcome = v; }, (e) => { outcome = e; });
      await vi.advanceTimersByTimeAsync(4_900);
      expect([what, outcome]).toEqual([what, "pending"]);
      await vi.advanceTimersByTimeAsync(200);
      expect([what, (outcome as { code?: string }).code]).toEqual([what, "backfill_timeout"]);
      expect([what, s.calls.some((c) => c[0] === "reconcile")]).toEqual([what, false]);
    }
    expect(audit).not.toHaveBeenCalled();
  });

  it("review PORTAL5-r2 P2: a lookup that used up the step's time is not followed by a reconcile", async () => {
    vi.useFakeTimers({ now: Date.now() });
    const s = shopWith({ dates: ["2025-10-06"], uncovered: [9] });
    // The lookup made no progress and returned only after the step's deadline.
    const cover = vi.fn(async () => { await new Promise((r) => setTimeout(r, 30_000)); return { lookups: 4, examined: 0, failed: 0 }; });
    const pending = runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover, deadlineAt: Date.now() + 20_000 });
    const settled = pending.then(() => "resolved", (e: { code?: string }) => e.code);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await settled).toBe("backfill_timeout");
    expect(s.calls.map((c) => c[0])).toEqual(["uncovered"]);
  });

  it("with no time left for a lookup the step links what is already examined and leaves the rest pending", async () => {
    const s = shopWith({ dates: ["2025-10-06"], uncovered: [7] });
    const cover = vi.fn(async () => ({ lookups: 1, examined: 1, failed: 0 }));
    expect((await runBackfillStep(actor("moo"), SHOP, null, { client: s.sb, now: NOW, cover, deadlineAt: Date.now() + 5_000 })).phase).toBe("linked");
    expect(cover).not.toHaveBeenCalled();
  });

  it("the switch went off under the run (the reconciler's own read): refused by name, nothing audited; a failed RPC is 503; 0348 missing is by name", async () => {
    const off = shopWith({ dates: ["2025-10-06"], reconcile: () => ({ data: { skipped: "off" }, error: null }) });
    await expect(runBackfillStep(actor("moo"), SHOP, null, { client: off.sb, now: NOW, cover: noCover })).rejects.toMatchObject({ status: 409, code: "backfill_needs_switch" });
    const down = shopWith({ dates: ["2025-10-06"], reconcile: () => ({ error: { code: "57014", message: "statement timeout" } }) });
    await expect(runBackfillStep(actor("moo"), SHOP, null, { client: down.sb, now: NOW, cover: noCover })).rejects.toMatchObject({ status: 503, code: "settings_unavailable" });
    const missing = shopWith({ dates: ["2025-10-06"], reconcile: () => ({ error: { code: "PGRST202" } }) });
    await expect(runBackfillStep(actor("moo"), SHOP, null, { client: missing.sb, now: NOW, cover: noCover })).rejects.toMatchObject({ status: 409, code: "automatic_not_installed" });
    expect(audit).not.toHaveBeenCalled();
  });

  it("review PORTAL5-r1 P2: two steps over a list that changes between them never skip an order (the cursor is a date)", async () => {
    // Step 1 links the first stretch. Before step 2, another manager links one of the later orders by hand.
    const first = shopWith({ dates: ["2025-10-06", "2026-03-03", "2026-03-04"] });
    const one = await runBackfillStep(actor("moo"), SHOP, null, { client: first.sb, now: NOW, cover: noCover });
    expect(one.next).toBe("2025-12-06");
    const second = shopWith({ dates: ["2026-03-04"] });
    const two = await runBackfillStep(actor("moo"), SHOP, one.next, { client: second.sb, now: NOW, cover: noCover });
    expect(second.calls.find((c) => c[0] === "reconcile")![1]).toEqual({ p_location_id: SHOP, p_from: "2026-03-04", p_to: "2026-05-03" });
    expect(two.next).toBe("2026-05-04");
  });
});

describe("saveCateringToastSettings", () => {
  it("one RPC with the actor, the shop, the whole row and the row the person saw", async () => {
    const calls: unknown[] = [];
    const { sb } = client({}, { set_catering_toast_settings: (p) => { calls.push(p); return { data: { enabled: true, ring_code_enabled: false, auto_link_enabled: false, origin_auto_link_enabled: false,
      include_toast_origin_leads: false, tolerance_cents: 5000, tolerance_pct: 0.15, auto_link_from_date: null, updated_at: "2026-11-19T12:00:00+00:00" }, error: null }; } });
    const saved = await saveCateringToastSettings(actor("moo"), { locationId: SHOP, values: { ...OFF, enabled: true }, expectedUpdatedAt: "2026-11-18T00:00:00+00:00" }, { client: sb });
    expect(saved).toEqual({ ...OFF, enabled: true, updatedAt: "2026-11-19T12:00:00+00:00" });
    expect(calls).toEqual([{ p_actor_id: "user-1", p_location_id: SHOP, p_expected_updated_at: "2026-11-18T00:00:00+00:00",
      p_settings: { enabled: true, ring_code_enabled: false, auto_link_enabled: false, origin_auto_link_enabled: false, include_toast_origin_leads: false, tolerance_cents: 5000, tolerance_pct: 0.15, auto_link_from_date: null } }]);
  });
  it("an answer without the row is a failure, never a silent success", async () => {
    const { sb } = client({}, { set_catering_toast_settings: () => ({ data: null, error: null }) });
    await expect(saveCateringToastSettings(actor("moo"), { locationId: SHOP, values: OFF, expectedUpdatedAt: null }, { client: sb })).rejects.toBeInstanceOf(CateringToastSettingsError);
  });
});
