/**
 * Item 4 PR 6 (first half): signals on the order walk. The walk NAMES what is coming and suggests no quantity.
 *   · the gate a tested number must pass (`orderNudgeFor`): every miss is a named refusal, and no number is
 *     reachable without an approval, E2 evidence, an exact authorization, verified sources and a term;
 *   · the walk's view lists only days AFTER the walk date that carry an event, from a WHOLE event read;
 *   · the walk is dark and safe: nothing of the layer is imported unless DEMAND_SIGNALS is on, the read runs
 *     beside the walk's own reads under a deadline, and no failure reaches the walk;
 *   · NO PAR: nothing in the signal layer names a par writer.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ page: null as unknown, args: null as Record<string, unknown> | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("@/lib/demand-signals/signals-page", () => ({ loadSignalsPage: async (_sb: unknown, a: Record<string, unknown>) => { h.args = a; return h.page; } }));

import { SIGNAL_BOUNDS } from "@/lib/demand-signals/candidates-shared";
import { ORDER_SIGNALS_DEADLINE_MS, loadOrderSignals } from "@/lib/demand-signals/order-signals";
import {
  ORDER_NUDGE_TARGET, ORDER_SIGNALS_HORIZON_DAYS, buildOrderSignals, orderNudgeFor, type ApprovedSignal, type SignalTerm,
} from "@/lib/demand-signals/order-signals-shared";
import type { SourceState } from "@/lib/demand-signals/sources-shared";
import type { EventIn, SignalsDay } from "@/lib/demand-signals/signals-view-shared";

const SHOP = "1c000000-0000-4000-8000-000000000002", DATE = "2026-11-21";
const qualified = { modelHash: "m1", target: ORDER_NUDGE_TARGET, leadDays: 2, shopIds: [SHOP], evidenceRunId: "run-1", holdoutReadId: "read-1" };
const approved = (over: Partial<ApprovedSignal> = {}): ApprovedSignal =>
  ({ modelHash: "m1", target: ORDER_NUDGE_TARGET, leadDays: 2, shopId: SHOP, evidenceClass: "E2", qualified, sourceIds: ["nws"], ...over });
const term = (over: Partial<SignalTerm> = {}): SignalTerm => ({ modelHash: "m1", validDate: DATE, multiplier: 1.1, sourceIds: ["nws"], ...over });
const states = (status: SourceState["status"]): SourceState[] => [{ sourceId: "nws", definitionHash: "h", gate: "allow_with_conditions", adapter: "nws@1", status }];
const ask = (over: Partial<Parameters<typeof orderNudgeFor>[0]> = {}) =>
  orderNudgeFor({ approved: approved(), term: term(), shopId: SHOP, validDate: DATE, leadDays: 2, states: states("verified"), velocityRatio: 1, ...over });

describe("the gate a number must pass", () => {
  it("everything in place: the number, clamped by the composition bounds", () => {
    expect(ask()).toEqual({ kind: "number", multiplier: 1.1, modelHash: "m1", sourceIds: ["nws"] });
    const big = ask({ term: term({ multiplier: 3 }) });
    expect(big).toMatchObject({ kind: "number", multiplier: SIGNAL_BOUNDS.perSignal[1] });
    // Signals times velocity stay inside today's velocity envelope.
    const withVelocity = ask({ term: term({ multiplier: 1.15 }), velocityRatio: 1.2 });
    if (withVelocity.kind !== "number") throw new Error("expected a number");
    expect(withVelocity.multiplier * 1.2).toBeCloseTo(SIGNAL_BOUNDS.withVelocity[1], 10);
  });
  it("no approval is the first refusal, whatever else is true (today's only answer)", () => {
    expect(ask({ approved: null })).toEqual({ kind: "named_only", reason: "no_approved_signal" });
    expect(ask({ approved: null, term: null, states: [] })).toEqual({ kind: "named_only", reason: "no_approved_signal" });
  });
  it("hindsight and retrospective evidence unlock nothing", () => {
    for (const evidenceClass of ["E0", "E1"] as const) expect(ask({ approved: approved({ evidenceClass }) })).toEqual({ kind: "named_only", reason: "evidence_not_point_in_time" });
  });
  it("an approval for another target, shop, lead or model authorizes nothing", () => {
    expect(ask({ approved: approved({ target: "labor_day_cents" }) })).toEqual({ kind: "named_only", reason: "wrong_target" });
    for (const over of [{ shopId: "another-shop" }, { leadDays: 3 }, { qualified: null }, { qualified: { ...qualified, modelHash: "m2" } },
      { qualified: { ...qualified, shopIds: ["another-shop"] } }, { qualified: { ...qualified, leadDays: 5 } }] as Array<Partial<ApprovedSignal>>) {
      expect(ask({ approved: approved(over) }), JSON.stringify(over)).toEqual({ kind: "named_only", reason: "not_authorized_for_scope" });
    }
    expect(ask({ leadDays: 4 })).toEqual({ kind: "named_only", reason: "not_authorized_for_scope" });
    expect(ask({ shopId: "another-shop" })).toEqual({ kind: "named_only", reason: "not_authorized_for_scope" });
  });
  it("a source that is not verified NOW refuses, whether the approval or the term names it", () => {
    expect(ask({ states: states("revoked") })).toEqual({ kind: "named_only", reason: "source_revoked" });
    expect(ask({ states: states("unverified") })).toEqual({ kind: "named_only", reason: "source_unverified" });
    expect(ask({ states: [] })).toEqual({ kind: "named_only", reason: "source_unverified" });   // not in the register
    expect(ask({ approved: approved({ sourceIds: [] }), term: term({ sourceIds: ["ncei"] }) })).toEqual({ kind: "named_only", reason: "source_unverified" });
    // A zero-feed signal has no source and is usable on this axis.
    expect(ask({ approved: approved({ sourceIds: [] }), term: term({ sourceIds: [] }), states: [] }).kind).toBe("number");
  });
  it("no term, another model's term or another day's term is not a number; a multiplier of 1, or an unusable one, is no nudge", () => {
    for (const t of [null, term({ modelHash: "m2" }), term({ validDate: "2026-11-22" })]) expect(ask({ term: t })).toEqual({ kind: "named_only", reason: "no_term_for_date" });
    for (const multiplier of [1, 0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(ask({ term: term({ multiplier }) }), String(multiplier)).toEqual({ kind: "named_only", reason: "no_effect" });
  });
});

const day = (date: string, eventIds: string[] | null): SignalsDay => ({ date, weather: null, weatherGap: "not_collected", eventIds });
const event = (id: string): EventIn => ({ id, origin: "manual", sourceId: null, locationId: SHOP, category: "sports_game", validFrom: DATE, validTo: DATE,
  startLocal: null, endLocal: null, title: id, expectedImpact: "up", severity: null });

describe("the walk's view", () => {
  it("lists only the days that carry an event, and only the events those days name", () => {
    const view = buildOrderSignals({ days: [day("2026-11-20", []), day(DATE, ["game"]), day("2026-11-22", [])], events: [event("game"), event("far-away")],
      nudgeFor: () => ({ kind: "named_only", reason: "no_approved_signal" }) });
    expect(view.days.map((d) => d.date)).toEqual([DATE]);
    expect(view.events.map((e) => e.id)).toEqual(["game"]);
    expect(view.days[0]!.nudge).toEqual({ kind: "named_only", reason: "no_approved_signal" });
  });
  it("refuses days whose events were not read (it cannot say 'nothing coming')", () => {
    expect(() => buildOrderSignals({ days: [day(DATE, null)], events: [], nudgeFor: () => ({ kind: "named_only", reason: "no_approved_signal" }) })).toThrow("events_not_read");
  });
});

describe("the walk's loader", () => {
  const ok = (over: Record<string, unknown> = {}) => ({ state: "ok", today: "2026-11-19", shop: { id: SHOP, name: "Shop A" },
    days: [day("2026-11-19", ["today-only"]), day("2026-11-20", []), day(DATE, ["game"])],
    events: [{ ...event("today-only"), canEdit: true }, { ...event("game"), canEdit: true }], weatherStatus: "verified", weatherFeeds: { nws: "fresh" },
    sources: { registered: 1, verified: 1, revoked: 0 }, adapters: [], can: { enter: true, enterAllShops: false, mark: false }, ...over });
  const load = (role = "key_holder", signal = AbortSignal.timeout(60_000)) =>
    loadOrderSignals({} as never, { actor: { role, locations: [SHOP] }, shop: { id: SHOP, name: "Shop A" }, nowIso: "2026-11-19T11:00:00Z", signal });
  beforeEach(() => { h.page = ok(); h.args = null; });

  it("asks the page's own loader for the walk's look-ahead, under the caller's deadline", async () => {
    const signal = AbortSignal.timeout(60_000);
    await load("key_holder", signal);
    expect(h.args).toMatchObject({ horizonDays: ORDER_SIGNALS_HORIZON_DAYS + 1, nowIso: "2026-11-19T11:00:00Z" });
    expect(h.args!.signal).toBe(signal);
    expect(ORDER_SIGNALS_DEADLINE_MS).toBeLessThanOrEqual(3_000);
  });
  it("keeps the days AFTER the walk date, and every day answers 'no approved signal' (no number exists yet)", async () => {
    const data = await load();
    if (data.state !== "ok") throw new Error("not ok");
    expect(data.view.days.map((d) => d.date)).toEqual([DATE]);            // today's event is not a day this order looks ahead to
    expect(data.view.events.map((e) => e.id)).toEqual(["game"]);
    expect(data.view.days.every((d) => d.nudge.kind === "named_only" && d.nudge.reason === "no_approved_signal")).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/"multiplier"|"kind":"number"/);
    expect(data.horizonDays).toBe(14);
  });
  it("a whole read with nothing coming is 'ok' with no day; an event read that failed is 'unreadable', never 'nothing coming'", async () => {
    h.page = ok({ days: [day("2026-11-19", []), day("2026-11-20", [])], events: [] });
    const none = await load();
    expect(none.state === "ok" && none.view.days).toEqual([]);
    h.page = ok({ events: null, days: [day("2026-11-19", null), day("2026-11-20", null)] });
    expect(await load()).toEqual({ state: "unreadable" });
  });
  it("0343 missing renders nothing; an unreadable register and a passed deadline are 'unreadable'", async () => {
    h.page = { state: "unavailable" };
    expect(await load()).toEqual({ state: "unavailable" });
    h.page = { state: "unreadable" };
    expect(await load()).toEqual({ state: "unreadable" });
    h.page = ok();
    const gone = new AbortController(); gone.abort();
    expect(await load("gm", gone.signal)).toEqual({ state: "unreadable" });
  });
  it("the link to the signals page is offered only to who may open it (GM of the shop, MoO+)", async () => {
    const can = async (role: string) => { const d = await load(role); return d.state === "ok" && d.canOpenPage; };
    expect(await can("gm")).toBe(true);
    expect(await can("moo")).toBe(true);
    for (const role of ["key_holder", "shift_lead", "agm", "social_media_mgr", "employee"]) expect(await can(role), role).toBe(false);
  });
});

const read = (p: string) => readFileSync(p, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name).replace(/\\/g, "/");
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("dark, safe, and never a par", () => {
  const page = read("app/ordering/page.tsx");
  it("the ordering page statically imports only the import-free switch, a type and the panel", () => {
    expect([...page.matchAll(/^import (type )?\{[^}]*\} from "@\/lib\/demand-signals\/([\w-]+)";/gm)].map((m) => `${m[1] ?? ""}${m[2]}`)).toEqual(["config-shared", "type order-signals"]);
    expect(read("lib/demand-signals/config-shared.ts")).not.toMatch(/^import /m);
    expect(page.match(/import\("@\/lib\/demand-signals/g)!.length).toBe(1);
  });
  it("OFF: the loader is reached only inside the DEMAND_SIGNALS branch, and nothing is rendered without data", () => {
    const on = page.indexOf("demandSignalsEnabled(process.env.DEMAND_SIGNALS) && loc");
    expect(on).toBeGreaterThan(-1);
    expect(page.indexOf('await import("@/lib/demand-signals/order-signals")')).toBeGreaterThan(on);
    expect(page).toContain(": Promise.resolve(null);");
    expect(page).toContain('{orderSignals && orderSignals.state !== "unavailable" && <OrderSignalsPanel');
  });
  it("it runs beside the walk's reads, under a deadline, and a failure is a state, never a throw", () => {
    const start = page.indexOf("const orderSignalsRead"), walkReads = page.indexOf("await Promise.all(["), awaited = page.indexOf("await orderSignalsRead");
    expect(start).toBeGreaterThan(-1);
    expect(start).toBeLessThan(walkReads);
    expect(awaited).toBeGreaterThan(walkReads);
    const body = page.slice(start, walkReads);
    expect(body).toContain("signal: AbortSignal.timeout(ORDER_SIGNALS_DEADLINE_MS)");
    expect(body).toContain('} catch { return { state: "unreadable" } as const; }');
  });
  it("the walk's own loader and writer do not know the signal layer", () => {
    for (const p of ["lib/ordering.ts", "lib/dynamic-pars.ts", "lib/dynamic-pars-shared.ts", "lib/dynamic-pars-walker.ts", "lib/dynamic-pars-engine-shared.ts", "components/ordering/ParPassWalker.tsx"]) {
      expect(read(p), p).not.toMatch(/from "@\/lib\/demand-signals|import\("@\/lib\/demand-signals|OrderSignals/);
    }
  });
  it("NO PAR: nothing in the signal layer, its pages or the panel names a par writer or a par column", () => {
    const files = [...walk("lib/demand-signals"), ...walk("app/admin/demand-signals"), ...walk("app/api/admin/demand-signals"), ...walk("components/admin/demand-signals"), "components/ordering/OrderSignalsPanel.tsx"];
    expect(files.length).toBeGreaterThan(25);
    for (const p of files) {
      expect(read(p), p).not.toMatch(/parWriteColumns|par_suggestion_actions|writeParFromSuggestion|upsertLocationSkuSettings|setItemPar|submitParPass|location_sku_settings|auto_weekday_par|auto_weekend_par/);
    }
    // The panel has no control that writes: no button, no input, no fetch.
    const panel = read("components/ordering/OrderSignalsPanel.tsx");
    expect(panel).not.toMatch(/<button|<input|<select|fetch\(|postJson|useStepUp/);
  });
  it("every reason the panel can render has its sentence in en AND es", () => {
    const en = JSON.parse(read("lib/i18n/en.json")) as Record<string, string>, es = JSON.parse(read("lib/i18n/es.json")) as Record<string, string>;
    for (const reason of ["no_approved_signal", "wrong_target", "evidence_not_point_in_time", "not_authorized_for_scope", "source_unverified", "source_revoked", "no_term_for_date", "no_effect",
      "number_up", "number_down"]) {
      expect(en[`ordering.signals.nudge.${reason}`], reason).toBeTruthy();
      expect(es[`ordering.signals.nudge.${reason}`], reason).toBeTruthy();
    }
    for (const key of Object.keys(en).filter((k) => k.startsWith("ordering.signals."))) {
      expect(es[key], key).toBeTruthy();
      expect([...es[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual([...en[key]!.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
});
