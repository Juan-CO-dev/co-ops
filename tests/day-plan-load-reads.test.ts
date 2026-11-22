/**
 * Nav PR 6 (plan r3, 8.2): each read's REAL query, through the recording client (tests/helpers/fake-supabase.ts).
 */
import { describe, expect, it } from "vitest";
import { findPrepDayInstances } from "@/lib/checklist-day-instance";
import { defaultDayFactDeps, loadDayFacts } from "@/lib/day-plan";
import type { DayViewer } from "@/lib/day-plan-shared";
import { loadPriorAmPrepStatus } from "@/lib/midshift";
import { operationalNow } from "@/lib/midshift-shared";
import { etDayRange } from "@/lib/report-digests-shared";
import { SCHEDULE_STRUCTURE_DEFAULTS } from "@/lib/scheduling/structure-shared";
import { ANA, LUIS } from "./fixtures/day-plan/build";
import { args as loaderArgs, at, NO_CLIENT, PLAN, TOMORROW, withDeps, YESTERDAY } from "./fixtures/day-plan/loader-deps";
import { fakeSupabase, type FakeCall } from "./helpers/fake-supabase";

const SHOP = "11111111-1111-4111-8111-111111111111";
const filters = (c: FakeCall) => c.ops.filter((o) => o.op === "eq").map((o) => JSON.stringify(o.args));

describe("findPrepDayInstances: loadPriorAmPrepStatus's filters, every version, no limit, paged", () => {
  it("the same embed and the same equality filters (template type, subtype, shop, in the join)", async () => {
    const prior = fakeSupabase(() => ({ data: null }));
    await loadPriorAmPrepStatus(prior.client as never, { locationId: SHOP, date: "2026-11-18" });
    const priorCall = prior.calls.find((c) => c.table === "checklist_instances")!;

    const mine = fakeSupabase(() => ({ data: [] }));
    await findPrepDayInstances(mine.client as never, { locationId: SHOP, subtype: "am_prep", date: "2026-11-18", columns: "id, template_id, status, created_at" });
    const call = mine.calls[0]!;
    expect(call.table).toBe("checklist_instances");
    expect(filters(call)).toEqual(filters(priorCall));
    expect(String(call.arg("select"))).toContain("checklist_templates!inner(type, prep_subtype, location_id)");
    expect(String(priorCall.arg("select"))).toContain("checklist_templates!inner(type, prep_subtype, location_id)");
    expect(call.has("limit")).toBe(false);
    expect(call.has("maybeSingle")).toBe(false);
    expect(call.has("order", "created_at", { ascending: true })).toBe(true);
    expect(call.has("order", "id", { ascending: true })).toBe(true);
    expect(call.arg("range", 0)).toBe(0);
  });

  it("mid-day: the subtype filter follows the argument; pages past 1,000 rows; a read error throws", async () => {
    const rows = (from: number) => Array.from({ length: from === 0 ? 1000 : 2 }, (_, i) => ({ id: `i-${from + i}`, template_id: "t", status: "open", created_at: "x" }));
    const paged = fakeSupabase((c) => ({ data: rows(c.arg("range", 0) as number) }));
    const got = await findPrepDayInstances(paged.client as never, { locationId: SHOP, subtype: "mid_day_prep", date: "2026-11-18", columns: "id, template_id, status, created_at" });
    expect(got).toHaveLength(1002);
    expect(paged.calls.every((c) => c.has("eq", "checklist_templates.prep_subtype", "mid_day_prep"))).toBe(true);
    const bad = fakeSupabase(() => ({ error: { message: "down" } }));
    await expect(findPrepDayInstances(bad.client as never, { locationId: SHOP, subtype: "am_prep", date: "2026-11-18", columns: "id" })).rejects.toThrow(/findPrepDayInstances am_prep: .*down/);
  });
});

// ══ The loader's real reads (defaultDayFactDeps) on the recording client ═══════════════════════════════════════════════

const PLAN_DATE = "2026-11-18";
const T = etDayRange("2026-11-16").startIso;
type Answer = { data?: unknown; error?: unknown };

/** A quiet day (no orders, deliveries, catering or prep demand), today's closing open, the opening confirmed. */
function quiet(opts: { installed: boolean; role?: string; date?: string }) {
  const day = opts.date ?? PLAN_DATE;
  return (c: FakeCall): Answer => {
    const sel = String(c.arg("select") ?? "");
    const eq = (k: string) => c.ops.find((o) => o.op === "eq" && o.args[0] === k)?.args[1];
    switch (c.table) {
      case "schedule_structures": return { data: [{ id: "s1", structure: SCHEDULE_STRUCTURE_DEFAULTS, created_at: "x" }] };
      case "stations":
        if (sel === "id, starts_mid_day, not_phase_station") {
          return opts.installed ? { data: [{ id: "st-1", starts_mid_day: false, not_phase_station: true }] } : { error: { code: "42703", message: "column stations.starts_mid_day does not exist" } };
        }
        return { data: null };
      case "checklist_templates":
        if (sel.startsWith("id, type")) return { data: [{ id: "tc", type: "closing", active: true, effective_from: null, created_at: "2026-01-01" }] };
        return { data: [{ id: eq("type") === "closing" ? "tc" : "to" }] };
      case "checklist_instances": {
        if (sel.includes("!inner")) return { data: [] };
        const ids = (c.arg("in", 1) as string[]) ?? [];
        if (ids.includes("tc") && eq("date") === day) return { data: [{ id: "ic", template_id: "tc", status: "open", created_at: "x", confirmed_at: null, confirmed_by: null }] };
        if (ids.includes("to")) return { data: [{ id: "io", template_id: "to", status: "confirmed", created_at: "x", confirmed_at: "y", confirmed_by: "u-ana" }] };
        return { data: [] };
      }
      case "checklist_template_items": return { data: [{ id: "i1", station: "Expo", active: true, report_reference_type: null }] };
      case "checklist_submissions": return { data: [{ submitted_at: "z" }] };
      case "users": return c.has("maybeSingle") ? { data: { role: opts.role ?? "social_media_mgr" } } : { data: [{ id: "u-ana", name: "Ana Ruiz" }] };
      case "user_locations": return { data: { user_id: "u" } };
      case "cash_reports": case "pm_reports": return { data: null };
      default: return { data: [] };
    }
  };
}
const budget = async (viewer: DayViewer, installed: boolean) => {
  // The social media manager's own-task read binds the server's today (loadOwnTaskAssignments), so that case runs at the
  // real instant; every other case at 13:45 ET on the plan date.
  const now = viewer.role === "social_media_mgr" ? new Date() : at("13:45", PLAN_DATE);
  const f = fakeSupabase(quiet({ installed, date: operationalNow(now).date }), () => ({ data: PLAN_DATE }));
  const input = await loadDayFacts(f.client as never, { viewer, shop: { id: SHOP, code: "P" }, now, board: async () => ({ stationDate: operationalNow(now).date,
    locationId: SHOP, date: operationalNow(now).date, viewerId: viewer.userId, viewerLevel: viewer.level, stations: [], people: [], events: [], tasks: [] }), locations: [SHOP] });
  return { input, count: f.calls.length + f.rpcs.length, reads: [...f.calls.map((c) => c.table), ...f.rpcs.map((r) => `rpc:${r.name}`)].sort() };
};

describe("8.1 item 8: the query budget on a quiet day (recomputed in r3)", () => {
  it("key holder 29 before 0353, 27 after; crew 19 / 17; the social media manager 5 (no task, no station)", async () => {
    const ana = { ...ANA, userId: "u-ana" };
    const got = {
      khBefore: await budget(ana, false), khAfter: await budget(ana, true),
      crewBefore: await budget(LUIS, false), crewAfter: await budget(LUIS, true),
      smm: await budget({ ...ANA, userId: "22222222-2222-4222-8222-222222222222", role: "social_media_mgr", level: 6 }, false),
    };
    const counts = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.count]));
    expect(counts, JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.reads])))).toEqual({ khBefore: 29, khAfter: 27, crewBefore: 19, crewAfter: 17, smm: 5 });
    expect(got.smm.reads).toEqual(["report_assignments", "rpc:station_business_date", "station_events", "user_locations", "users"]);
    expect(got.khBefore.input.facts.kind).toBe("shop");
  });
});

describe("8.1 item 8: the query budget on a POPULATED day (Astra r1: a quiet day cannot catch a per-row read)", () => {
  // Open orders, in-progress and complete deliveries and Prep demand rows, at 3 and at 90 rows each. Rows add exactly
  // three CONDITIONAL follow-up reads to the quiet key holder's 27 (after 0353): openOrders' read of the orders' complete
  // deliveries (vendor_deliveries, in chunks of 100 order ids, so one read up to 100 orders), and Prep demand's item
  // registry reads (items and item_par_levels, in chunks of 100 item ids). 30 at 3 rows AND 30 at 90 rows is what proves
  // there is no per-row read: one would add 87 more at 90 rows than at 3.
  const populated = (n: number) => (c: FakeCall): Answer => {
    const rows = <T,>(f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
    switch (c.table) {
      case "purchase_orders": return { data: rows((i) => ({ id: `po${i}`, display_code: `P${i}`, vendor_id: "v", status: "placed",
        created_at: `${PLAN_DATE}T12:00:00Z`, confirmed_at: null, placed_at: `${PLAN_DATE}T12:00:00Z` })) };
      case "vendor_deliveries": return { data: rows((i) => ({ id: `d${i}`, vendor_id: "v", created_at: `${PLAN_DATE}T12:00:00Z`, purchase_order_id: `po${i}` })) };
      case "catering_prep_demand": return { data: rows((i) => ({ pipeline_id: `p${i}`, need_date: PLAN_DATE, item_id: `it${i}`, menu_item_id: null,
        choice_package_item_id: null, portion: "full", qty: 2 })) };
      case "items": return { data: rows((i) => ({ id: `it${i}`, name: `Item ${i}`, name_es: null, default_par: 1, default_par_unit: null, active: true })) };
      default: return quiet({ installed: true, date: PLAN_DATE })(c);
    }
  };
  const run = async (n: number) => {
    const now = at("13:45", PLAN_DATE);
    const f = fakeSupabase(populated(n), () => ({ data: PLAN_DATE }));
    await loadDayFacts(f.client as never, { viewer: { ...ANA, userId: "u-ana" }, shop: { id: SHOP, code: "P" }, now, locations: [SHOP],
      board: async () => ({ stationDate: PLAN_DATE, locationId: SHOP, date: PLAN_DATE, viewerId: "u-ana", viewerLevel: 4, stations: [], people: [], events: [], tasks: [] }) });
    return { count: f.calls.length + f.rpcs.length, reads: [...f.calls.map((c) => c.table), ...f.rpcs.map((r) => `rpc:${r.name}`)].sort() };
  };

  it("key holder after 0353: exactly 30 reads at 3 rows and at 90 rows (27 quiet + the three conditional follow-ups)", async () => {
    const [few, many] = [await run(3), await run(90)];
    expect({ few: few.count, many: many.count }, JSON.stringify({ few: few.reads, many: many.reads })).toEqual({ few: 30, many: 30 });
    expect(many.reads).toEqual(few.reads);
    // The follow-ups did fire: three vendor_deliveries reads (half-logged, completed today, the open orders' complete ones) and the registry pair.
    expect(many.reads.filter((t) => t === "vendor_deliveries")).toHaveLength(3);
    expect(many.reads.filter((t) => t === "items" || t === "item_par_levels")).toEqual(["item_par_levels", "items"]);
  });
});

describe("8.2: each read's real query", () => {
  const sb = (respond: (c: FakeCall) => Answer) => fakeSupabase(respond);
  const pages = (n: number, make: (i: number) => Record<string, unknown>) => (c: FakeCall): Answer => {
    const from = c.arg("range", 0) as number;
    return { data: Array.from({ length: Math.max(0, Math.min(1000, n - from)) }, (_, i) => make(from + i)) };
  };

  it("receiving is paged and uncapped: R1 and R2 past 2,500 rows, no limit or date window; in-progress never clears an order; R3 = the date and complete", async () => {
    const r1 = sb(pages(2500, (i) => ({ id: `d${i}`, vendor_id: "v", created_at: i === 2499 ? "2025-10-14T12:00:00Z" : "2026-11-18T12:00:00Z" })));
    const half = await defaultDayFactDeps.halfLogged(r1.client as never, SHOP);
    expect(half).toHaveLength(2500);
    expect(half.at(-1)!.created_at).toBe("2025-10-14T12:00:00Z"); // 400 days old, still open work
    expect(r1.calls.map((c) => c.arg("range", 0))).toEqual([0, 1000, 2000]);
    for (const c of r1.calls) {
      expect(c.has("eq", "delivery_status", "in_progress")).toBe(true);
      for (const op of ["limit", "gte", "lte", "gt", "lt"]) expect(c.has(op)).toBe(false);
    }
    const r2 = sb((c) => {
      if (c.table === "purchase_orders") return pages(2500, (i) => ({ id: `po${i}`, display_code: `P${i}`, vendor_id: "v", status: "placed", created_at: "x", confirmed_at: null, placed_at: null }))(c);
      // Only a COMPLETE delivery clears an order: po0 has one; po1's only delivery is in progress (filtered out by the read).
      const ids = c.arg("in", 1) as string[];
      return { data: c.has("eq", "delivery_status", "complete") && ids.includes("po0") ? [{ purchase_order_id: "po0" }] : [] };
    });
    const open = await defaultDayFactDeps.openOrders(r2.client as never, SHOP);
    expect(open).toHaveLength(2499);
    expect(open.some((o) => o.id === "po0")).toBe(false);
    expect(open.some((o) => o.id === "po1")).toBe(true);
    const poCalls = r2.calls.filter((c) => c.table === "purchase_orders");
    expect(poCalls.map((c) => c.arg("range", 0))).toEqual([0, 1000, 2000]);
    expect(poCalls[0]!.has("in", "status", ["confirmed", "placed", "invoiced"])).toBe(true);
    for (const c of r2.calls) for (const op of ["limit", "gte", "lte"]) expect(c.has(op)).toBe(false);
    expect(r2.calls.filter((c) => c.table === "vendor_deliveries").every((c) => (c.arg("in", 1) as string[]).length <= 100)).toBe(true);
    const r3 = sb(() => ({ data: [] }));
    await defaultDayFactDeps.completedOn(r3.client as never, SHOP, PLAN_DATE);
    expect(r3.calls[0]!.has("eq", "delivery_date", PLAN_DATE) && r3.calls[0]!.has("eq", "delivery_status", "complete")).toBe(true);
  });

  it("O2 reads every weekday; O3's window starts at the ET start of planDate − 2 on created, confirmed or placed", async () => {
    const o = sb(() => ({ data: [] }));
    await defaultDayFactDeps.cutoffs(o.client as never, SHOP);
    expect(o.calls[0]!.ops.some((x) => x.args[0] === "order_day")).toBe(false);
    expect(o.calls[0]!.arg("or")).toBe(`location_id.is.null,location_id.eq.${SHOP}`);
    // Through the loader: the window it passes is planDate − 2.
    const seen: string[] = [];
    await loadDayFacts(NO_CLIENT, { ...loaderArgs(ANA), now: at("13:45") }, withDeps({ recentPos: async (_s, _shop, since) => { seen.push(since); return []; } }));
    expect(seen).toEqual([T]);
    const p = sb(() => ({ data: [{ id: "po-3d", display_code: "P", vendor_id: "v", status: "placed", created_at: "2026-11-15T15:00:00Z", confirmed_at: null, placed_at: "2026-11-18T15:00:00Z" }] }));
    expect(await defaultDayFactDeps.recentPos(p.client as never, SHOP, T)).toHaveLength(1);
    expect(p.calls[0]!.arg("or")).toBe(`created_at.gte.${T},confirmed_at.gte.${T},placed_at.gte.${T}`);
  });

  it("C1 asks for exactly [planDate, tomorrow]; C2 filters lead_id is null; a cancelled ezCater status → cancelled, an OUT stage → out", async () => {
    const dates: string[][] = [];
    const deps = withDeps({ booked: async (_s, _shop, d) => { dates.push([...d]); return [{ id: "p", eventDate: PLAN, timeWindow: null, headcount: 1, stage: "out" }]; },
      ezcater: async (_s, _shop, d) => { dates.push([...d]); return [{ id: "e", event_date: PLAN, event_timestamp: null, handoff_time: null, headcount: 1, status: "CANCELLED" }]; } });
    const f = await loadDayFacts(NO_CLIENT, loaderArgs(ANA), deps);
    expect(dates).toEqual([[PLAN, TOMORROW], [PLAN, TOMORROW]]);
    const today = f.facts.kind === "shop" && f.facts.cateringToday.kind === "ok" ? f.facts.cateringToday.value.orders : [];
    expect(today.map((o) => [o.id, o.state])).toEqual([["p", "out"], ["e", "cancelled"]]);
    const ez = sb(() => ({ data: [] }));
    await defaultDayFactDeps.ezcater(ez.client as never, SHOP, [PLAN, TOMORROW]);
    expect(ez.calls[0]!.has("is", "lead_id", null)).toBe(true);
    expect(ez.calls[0]!.has("in", "event_date", [PLAN, TOMORROW])).toBe(true);
  });

  it("no money, names or addresses: the loader's own reads never name them; the reused readers' sentinels never reach the facts", async () => {
    const SENTINELS = ["Sentinel Contact", "Sentinel Co", "1 Sentinel Way", 987654321];
    const f = fakeSupabase((c) => {
      if (c.table === "catering_pipeline") return { data: [{ id: "lead", contact_name: SENTINELS[0], company: SENTINELS[1], event_date: PLAN_DATE, time_window: "noon", headcount: 9,
        stage: "confirmed", delivery_address: SENTINELS[2], estimated_revenue_cents: SENTINELS[3] }] };
      if (c.table === "catering_quotes") return { data: [{ pipeline_id: "lead", total_cents: SENTINELS[3], is_delivery: true, version: 1 }] };
      if (c.table === "ezcater_orders") return { data: [{ id: "ez", event_date: PLAN_DATE, event_timestamp: null, handoff_time: null, headcount: 3, total_cents: SENTINELS[3], status: null }] };
      return quiet({ installed: true })(c);
    }, () => ({ data: PLAN_DATE }));
    const now = at("13:45", PLAN_DATE);
    const input = await loadDayFacts(f.client as never, { viewer: ANA, shop: { id: SHOP, code: "P" }, now, locations: [SHOP],
      board: async () => ({ stationDate: PLAN_DATE, locationId: SHOP, date: PLAN_DATE, viewerId: ANA.userId, viewerLevel: 4, stations: [], people: [], events: [], tasks: [] }) });
    const text = JSON.stringify(input);
    for (const s of SENTINELS) expect(text).not.toContain(String(s));
    expect(text).toContain("lead"); // the order itself did arrive
    const own = f.calls.filter((c) => !["catering_pipeline", "catering_quotes", "ezcater_orders"].includes(c.table));
    for (const c of own) {
      expect(c.table).not.toBe("po_lines");
      expect(String(c.arg("select") ?? "")).not.toMatch(/_cents|contact_name|delivery_address|company/);
    }
    // The reused readers keep their existing projections (allowed, ruling B6).
    expect(String(f.calls.find((c) => c.table === "catering_pipeline")!.arg("select"))).toContain("contact_name");
  });

  it("every default read that fails throws out of its dependency (no `data ?? []` swallowing)", async () => {
    const down = fakeSupabase(() => ({ error: { code: "08006", message: "down" } }), () => ({ error: { code: "08006", message: "down" } }));
    const sbDown = down.client as never;
    const calls: Array<[string, () => Promise<unknown>]> = [
      ["shopDay", () => defaultDayFactDeps.shopDay(sbDown, SHOP)], ["stationFlags", () => defaultDayFactDeps.stationFlags(sbDown, SHOP)],
      ["closingClassification", () => defaultDayFactDeps.closingClassification(sbDown, SHOP, PLAN_DATE)], ["templateItems", () => defaultDayFactDeps.templateItems(sbDown, "t")],
      ["dayInstance", () => defaultDayFactDeps.dayInstance(sbDown, { shopId: SHOP, type: "closing", date: PLAN_DATE })],
      ["completedItems", () => defaultDayFactDeps.completedItems(sbDown, "i")], ["phase1At", () => defaultDayFactDeps.phase1At(sbDown, "i")],
      ["prepInstances", () => defaultDayFactDeps.prepInstances(sbDown, { shopId: SHOP, subtype: "am_prep", date: PLAN_DATE })],
      ["userNames", () => defaultDayFactDeps.userNames(sbDown, ["u"])], ["cashReport", () => defaultDayFactDeps.cashReport(sbDown, SHOP, PLAN_DATE)],
      ["pmReport", () => defaultDayFactDeps.pmReport(sbDown, SHOP, PLAN_DATE)], ["vendors", () => defaultDayFactDeps.vendors(sbDown)],
      ["cutoffs", () => defaultDayFactDeps.cutoffs(sbDown, SHOP)], ["recentPos", () => defaultDayFactDeps.recentPos(sbDown, SHOP, T)],
      ["rhythm", () => defaultDayFactDeps.rhythm(sbDown, SHOP)], ["halfLogged", () => defaultDayFactDeps.halfLogged(sbDown, SHOP)],
      ["openOrders", () => defaultDayFactDeps.openOrders(sbDown, SHOP)], ["completedOn", () => defaultDayFactDeps.completedOn(sbDown, SHOP, PLAN_DATE)],
      ["booked", () => defaultDayFactDeps.booked(sbDown, SHOP, [PLAN_DATE])], ["ezcater", () => defaultDayFactDeps.ezcater(sbDown, SHOP, [PLAN_DATE])],
      ["outEvents", () => defaultDayFactDeps.outEvents(sbDown, ["p"])], ["flaggedLines", () => defaultDayFactDeps.flaggedLines(sbDown, SHOP, [PLAN_DATE])],
      ["stationBusinessDate", () => defaultDayFactDeps.stationBusinessDate(sbDown, SHOP)],
      ["ownStationEvents", () => defaultDayFactDeps.ownStationEvents(sbDown, { shopId: SHOP, userId: "u", businessDate: PLAN_DATE })],
      ["stationWithPositions", () => defaultDayFactDeps.stationWithPositions(sbDown, { shopId: SHOP, stationId: "s" })],
    ];
    for (const [name, call] of calls) await expect(call(), name).rejects.toThrow();
  });
});

describe("8.4: instance first (a version change between the day's instance and today's effective template)", () => {
  // The day's instance sits on V1 (retired); V2 is active with no instance. Two shapes: V1 retired before the day, and an
  // apply-now publish that retired today's version mid-day (V2 created today). The loader reads V1's status, finish and
  // (closing) sections left on V1's items; it never asks for V2's items.
  const shapes = [["retired earlier", "2026-11-01T00:00:00Z"], ["apply-now publish today", "2026-11-18T17:00:00Z"]] as const;
  const versioned = (v2CreatedAt: string) => (c: FakeCall): Answer => {
    const sel = String(c.arg("select") ?? "");
    if (c.table === "checklist_templates") return { data: [{ id: "v1" }, { id: "v2", created_at: v2CreatedAt }] };
    if (c.table === "checklist_instances") {
      if (sel.includes("!inner")) return { data: [{ id: "prep-v1", template_id: "v1", status: "confirmed", created_at: "x", confirmed_at: "2026-11-18T12:00:00Z", confirmed_by: null }] };
      return { data: (c.arg("in", 1) as string[]).includes("v1") ? [{ id: "inst-v1", template_id: "v1", status: "confirmed", created_at: "x", confirmed_at: "2026-11-18T12:00:00Z", confirmed_by: null }] : [] };
    }
    if (c.table === "checklist_template_items") return { data: c.has("eq", "template_id", "v1") ? [{ id: "a", station: "Expo", active: true }, { id: "b", station: "Dish", active: true }] : [{ id: "z", station: "Other", active: true }] };
    if (c.table === "checklist_completions") return { data: [{ template_item_id: "a" }] };
    return { data: [] };
  };
  it.each(shapes)("opening, closing, yesterday's closing (%s): V1's instance, V1's items", async (_label, created) => {
    const f = fakeSupabase(versioned(created));
    const deps = withDeps({ dayInstance: defaultDayFactDeps.dayInstance, templateItems: defaultDayFactDeps.templateItems, completedItems: defaultDayFactDeps.completedItems,
      prepInstances: defaultDayFactDeps.prepInstances });
    const input = await loadDayFacts(f.client as never, loaderArgs(ANA), deps);
    const facts = input.facts.kind === "shop" ? input.facts : null;
    expect(facts!.closing).toMatchObject({ kind: "ok", value: { status: "confirmed", finishedAt: "2026-11-18T12:00:00Z", sectionsLeft: 1 } });
    expect(facts!.opening).toMatchObject({ kind: "ok", value: { status: "confirmed" } });
    expect(facts!.yesterdayClosing).toMatchObject({ kind: "ok", value: { forDate: YESTERDAY, status: "confirmed" } });
    expect(facts!.amPrep).toMatchObject({ kind: "ok", value: { status: "confirmed" } });
    expect(facts!.midDay).toMatchObject({ kind: "ok", value: { instances: [{ status: "confirmed" }] } });
    const itemReads = f.calls.filter((c) => c.table === "checklist_template_items");
    expect(itemReads.length).toBeGreaterThan(0);
    expect(itemReads.every((c) => c.has("eq", "template_id", "v1"))).toBe(true);
    expect(f.calls.filter((c) => c.table === "checklist_instances" && !String(c.arg("select")).includes("!inner")).every((c) => (c.arg("in", 1) as string[]).includes("v1"))).toBe(true);
  });
});
