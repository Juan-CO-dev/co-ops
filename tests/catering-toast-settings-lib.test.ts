/**
 * Item 21 PR 5: lib/catering/catering-toast-settings.ts. The role is bound before any I/O; "not installed" is never a
 * 500; the old orders are linked through the ONE writer of links as the person who pressed, from a list the server
 * recomputes on every batch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import { CateringToastSettingsError, linkOldOrders, loadCateringToastSettings, loadOldOrders, saveCateringToastSettings } from "@/lib/catering/catering-toast-settings";
import { DEFAULT_CATERING_TOAST_SETTINGS as OFF } from "@/lib/catering/catering-toast-settings-shared";
import { OLD_ORDERS_BATCH } from "@/lib/catering/catering-toast-old-orders-shared";
import { CateringPipelineError } from "@/lib/catering/pipeline";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no default client in this test"); }) }));

type Result = { data?: unknown; error?: { code?: string; message?: string } | null; count?: number | null };
const SHOP = "00000000-0000-4000-8000-000000000001";
const actor = (role: string): AuthContext => ({ user: { id: "user-1", role }, role, level: 8, locations: [], session: {} } as unknown as AuthContext);

/** A chainable PostgREST stand-in. Tables and RPCs answer functions of the filters applied (`eq` / `in` / `range`). */
function client(tables: Record<string, (q: Query) => Result>, rpcs: Record<string, (params: Record<string, unknown>, q: Query) => Result>) {
  const reads: string[] = [];
  const chain = (name: string, answer: (q: Query) => Result) => {
    const query: Query = { eq: {}, in: {}, range: null };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "not", "gte", "lte", "order", "abortSignal"]) q[m] = () => q;
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
  return { sb: sb as never, reads };
}
interface Query { eq: Record<string, unknown>; in: Record<string, unknown[]>; range: [number, number] | null }

beforeEach(() => vi.clearAllMocks());

describe("the role is bound before any I/O", () => {
  it("every entry point refuses a GM, the catering manager and the social media manager without touching the database", async () => {
    const { sb, reads } = client({}, {});
    for (const role of ["gm", "catering_mgr", "social_media_mgr", "agm"]) {
      const who = actor(role);
      for (const run of [() => loadCateringToastSettings(who, { client: sb }), () => saveCateringToastSettings(who, { locationId: SHOP, values: OFF, expectedUpdatedAt: null }, { client: sb }),
        () => loadOldOrders(who, SHOP, { client: sb }), () => linkOldOrders(who, SHOP, 0, { client: sb })]) {
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

const status = (lead: string, date: string) => ({ lead_id: lead, location_id: SHOP, event_date: date, lead_source: "toast_catering", ring_code: null, headcount: null, value_cents: 10000, toast_origin: true, status: "not_rung_in_toast" });
const planRow = (lead: string, order: string) => ({ lead_id: lead, location_id: SHOP, order_guid: order, check_guid: `${order}c`, toast_snapshot_id: "s", business_date: "2026-10-10", evidence: "toast_origin",
  check_total_cents: 10000, lead_value_cents: 10000, amount_diff_cents: 0, amount_mismatch: false, dual_code: false, owner: null, owner_lead_id: null, blocked: false });
function shopWith(n: number, opts: { enabled?: boolean; ready?: boolean; heads?: unknown[] } = {}) {
  const leads = Array.from({ length: n }, (_, i) => `lead-${String(i).padStart(3, "0")}`);
  const plan = leads.map((l) => planRow(l, `O${l}`));
  return client({
    catering_toast_settings: () => ({ data: opts.enabled === false ? { enabled: false } : { enabled: true }, error: null }),
    catering_reconciliation_status: () => ({ data: leads.map((l) => status(l, "2026-10-10")), error: null }),
    catering_toast_decision_heads: (q) => ({ data: (opts.heads ?? []).filter((h) => (q.in.lead_id ?? []).includes((h as { lead_id: string }).lead_id)), error: null }),
  }, {
    catering_toast_link_ready: () => ({ data: opts.ready !== false, error: null }),
    plan_catering_toast: (_p, q) => ({ data: plan.slice(q.range![0], q.range![1] + 1), count: plan.length, error: null }),
  });
}

describe("the old orders", () => {
  const now = new Date("2026-11-19T15:00:00Z");
  it("a shop that is off, or a link step that is not installed, shows nothing to confirm and links nothing", async () => {
    expect((await loadOldOrders(actor("moo"), SHOP, { client: shopWith(3, { enabled: false }).sb, now })).state).toBe("off");
    expect((await loadOldOrders(actor("moo"), SHOP, { client: shopWith(3, { ready: false }).sb, now })).state).toBe("not_installed");
    const decide = vi.fn();
    await expect(linkOldOrders(actor("moo"), SHOP, 0, { client: shopWith(3, { enabled: false }).sb, now, decide })).rejects.toMatchObject({ status: 409, code: "switch_needs_enabled" });
    await expect(linkOldOrders(actor("moo"), SHOP, 0, { client: shopWith(3, { ready: false }).sb, now, decide })).rejects.toMatchObject({ status: 409, code: "link_step_not_installed" });
    expect(decide).not.toHaveBeenCalled();
  });

  it("loadOldOrders: the counts and a sample, read to completion", async () => {
    const view = await loadOldOrders(actor("moo"), SHOP, { client: shopWith(14).sb, now });
    expect([view.state, view.orders, view.ordersMatched, view.checks, view.sample.length]).toEqual(["ready", 14, 14, 14, 10]);
  });

  it("a read that fails is 503 (never 'nothing to match')", async () => {
    const { sb } = client({ catering_toast_settings: () => ({ data: { enabled: true }, error: null }), catering_reconciliation_status: () => ({ error: { code: "57014" } }) },
      { catering_toast_link_ready: () => ({ data: true, error: null }) });
    await expect(loadOldOrders(actor("moo"), SHOP, { client: sb, now })).rejects.toMatchObject({ status: 503, code: "settings_unavailable" });
    await expect(linkOldOrders(actor("moo"), SHOP, 0, { client: sb, now, decide: vi.fn() })).rejects.toMatchObject({ status: 503 });
  });

  it("one batch: each check is a human link through the one writer, as this person, naming the head the server read", async () => {
    const decide = vi.fn().mockResolvedValue({ decisionId: "d", kind: "link" });
    const who = actor("cgs");
    const out = await linkOldOrders(who, SHOP, 0, { client: shopWith(3, { heads: [{ id: "head-1", lead_id: "lead-001", kind: "link", location_id: SHOP, order_guid: "Olead-001", check_guid: "Olead-001c" }] }).sb, now, decide });
    expect(out).toEqual({ linked: 3, refused: {}, remaining: 0 });
    expect(decide.mock.calls.map((c) => [c[0] === who, c[1], c[2]])).toEqual([
      [true, "lead-000", { kind: "link", locationId: SHOP, orderGuid: "Olead-000", checkGuid: "Olead-000c", reasonCode: null, expectedHeadId: null }],
      [true, "lead-001", { kind: "link", locationId: SHOP, orderGuid: "Olead-001", checkGuid: "Olead-001c", reasonCode: null, expectedHeadId: "head-1" }],
      [true, "lead-002", { kind: "link", locationId: SHOP, orderGuid: "Olead-002", checkGuid: "Olead-002c", reasonCode: null, expectedHeadId: null }],
    ]);
  });

  it("a batch is bounded; `remaining` says what is left; `skip` starts after the checks the writer refused before", async () => {
    const decide = vi.fn().mockResolvedValue({ decisionId: "d", kind: "link" });
    const first = await linkOldOrders(actor("moo"), SHOP, 0, { client: shopWith(OLD_ORDERS_BATCH + 15).sb, now, decide });
    expect(first).toEqual({ linked: OLD_ORDERS_BATCH, refused: {}, remaining: 15 });
    decide.mockClear();
    const skipped = await linkOldOrders(actor("moo"), SHOP, 2, { client: shopWith(5).sb, now, decide });
    expect(skipped).toEqual({ linked: 3, refused: {}, remaining: 0 });
    expect(decide.mock.calls.map((c) => c[1])).toEqual(["lead-002", "lead-003", "lead-004"]);
  });

  it("a refusal is counted by its name and the batch goes on; an unknown failure is 'generic'", async () => {
    const decide = vi.fn().mockRejectedValueOnce(new CateringPipelineError(409, "check_owned_by_ezcater")).mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new CateringPipelineError(409, "check_owned_by_ezcater")).mockResolvedValue({ decisionId: "d", kind: "link" });
    expect(await linkOldOrders(actor("moo"), SHOP, 0, { client: shopWith(5).sb, now, decide })).toEqual({ linked: 2, refused: { check_owned_by_ezcater: 2, generic: 1 }, remaining: 0 });
  });

  it("the route's deadline stops a batch early and reports the rest as remaining", async () => {
    const decide = vi.fn().mockResolvedValue({ decisionId: "d", kind: "link" });
    expect(await linkOldOrders(actor("moo"), SHOP, 0, { client: shopWith(5).sb, now, decide, deadlineAt: Date.now() - 1 })).toEqual({ linked: 0, refused: {}, remaining: 5 });
    expect(decide).not.toHaveBeenCalled();
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
