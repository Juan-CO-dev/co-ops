// Item 9 PR 9a: the business report's authorized READ boundary (lib/business-report.ts). Failing-first.
// Every refusal happens BEFORE any I/O (switch off = 503, below GM / SMM / other shop = 403, zero calls).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn(() => { throw new Error("no database in unit tests"); }) }));

import { getServiceRoleClient } from "@/lib/supabase-server";
import { businessAccessFor, businessDtoPaths } from "@/lib/business-access-shared";
import { BusinessReportError, loadBusinessReport } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { summarizeSales } from "@/lib/sales-reports-shared";
import { GM_ALL_ON, fakeClient, gmOff } from "./helpers/business-report-fake";

const A = "aaaaaaaa-0000-4000-8000-00000000000a";
const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const TODAY = "2026-10-08";
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const gm = { userId: "u-gm", level: 7, role: "gm" as const, locations: [A] };
const agm = { userId: "u-agm", level: 6, role: "agm" as const, locations: [A] };
const smm = { userId: "u-smm", level: 6, role: "social_media_mgr" as const, locations: [A] };
const moo = { userId: "u-moo", level: 8, role: "moo" as const, locations: [] as string[] };

beforeEach(() => vi.clearAllMocks());
const range = resolveBusinessRange({}, TODAY);

describe("refusals run before any I/O", () => {
  it("switch off (any of the three) = 503 business_report_unavailable, zero calls", async () => {
    for (const env of [{}, { ...ON, BUSINESS_REPORT: "0" }, { ...ON, FACT_LAYER: undefined }, { ...ON, FACT_LAYER_LABOR: "" }]) {
      const f = fakeClient();
      await expect(loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env })).rejects.toMatchObject({ status: 503, code: "business_report_unavailable" });
      expect(f.calls).toHaveLength(0);
      expect(f.tables).toHaveLength(0);
    }
    expect(getServiceRoleClient).not.toHaveBeenCalled();
  });
  it("AGM and SMM see NOTHING (403), and a GM at another shop is 403; zero calls", async () => {
    for (const [viewer, loc] of [[agm, A], [smm, A], [gm, B]] as const) {
      const f = fakeClient();
      const err = await loadBusinessReport(viewer, { locationId: loc, range }, { client: f.client, env: ON }).catch((e) => e);
      expect(err).toBeInstanceOf(BusinessReportError);
      expect(err.status).toBe(403);
      expect(f.calls).toHaveLength(0);
      expect(f.tables).toHaveLength(0);
    }
  });
  it("'all' and junk are not a shop (400)", async () => {
    const f = fakeClient();
    await expect(loadBusinessReport(moo, { locationId: "all", range }, { client: f.client, env: ON })).rejects.toMatchObject({ status: 400 });
    expect(f.calls).toHaveLength(0);
  });
  it("a missing 0341 read is 503 business_reads_not_installed, never an empty report", async () => {
    const f = fakeClient({ failCuts: true });
    await expect(loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON })).rejects.toMatchObject({ status: 503, code: "business_reads_not_installed" });
  });
});

describe("the report a GM and a MoO get", () => {
  it("GM own shop, the defaults: hours and hourly cost per person, sales per server, no fully loaded labor; day % uses Toast net + ezCater", async () => {
    const f = fakeClient();
    const dto = await loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON });
    // Business report access: no settings row yet = the defaults. Juan 2026-11-19: a GM knows their shop's hourly
    // pay, so each hourly person's cost and the labor dollars per 15 minutes are ON; the salaried side is OFF.
    expect(dto.access).toEqual(businessAccessFor("gm", null));
    expect(dto.access).toMatchObject({ report: true, hourlyCost: true, loaded: false, people: true, servers: true, personCost: true, quarterCost: true, personSalary: false });
    expect(dto.people![0]).toEqual({ personKey: "u:11111111-1111-4111-8111-111111111111", label: "Ana", source: "7shifts", payClass: "hourly", minutes: 600, otMinutes: 0, weeksSuppressed: 0,
      straightCostCents: 18_000 });
    expect(JSON.stringify(dto)).not.toMatch(/straight_cents|rate|salariedCents|fullyLoadedCents|burdenCents/);
    // The MoO+ turned the two switches off: hours per person and per 15 minutes, no dollars.
    const totals = await loadBusinessReport(gm, { locationId: A, range }, { client: fakeClient({ visibility: [gmOff("person_cost", "quarter_cost")] }).client, env: ON });
    expect(totals.access).toMatchObject({ hourlyCost: true, people: true, quarters: true, personCost: false, quarterCost: false });
    expect(totals.people![0]).toEqual({ personKey: "u:11111111-1111-4111-8111-111111111111", label: "Ana", source: "7shifts", payClass: "hourly", minutes: 600, otMinutes: 0, weeksSuppressed: 0 });
    expect(JSON.stringify(totals)).not.toMatch(/straight_cents|straightCents|CostCents|rate/);
    // Each day: $30 Toast + $20 ezCater = $50 net; labor $9 => 18%.
    expect(dto.days[0]!.labor).toMatchObject({ pureHourlyCents: 900, pct: 18, state: "ok", denominator: { cents: 5_000, state: "ok" } });
    expect(dto.servers!.find((s) => s.key === "srv-1")).toMatchObject({ label: "Ana", cents: 7_000, checks: 7 });
  });
  it("MoO: everything, always (no settings read)", async () => {
    const f = fakeClient();
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(Object.values(dto.access).every((v) => v === true)).toBe(true);
    expect(dto.access).toMatchObject({ personCost: true, quarterCost: true });
    expect(dto.people[0]).toMatchObject({ straightCostCents: 18_000 });
    expect(f.tables).not.toContain("business_report_gm_visibility"); // MoO / Owner / CGS never read the settings
  });
  it("serialized payload paths are an allowlist per role (an unknown path fails)", async () => {
    const paths = (v: unknown, prefix = ""): string[] => v === null || typeof v !== "object" ? [prefix]
      : Array.isArray(v) ? v.flatMap((x) => paths(x, `${prefix}[]`)) : Object.entries(v).flatMap(([k, x]) => paths(x, prefix ? `${prefix}.${k}` : k));
    for (const viewer of [gm, moo]) {
      const dto = await loadBusinessReport(viewer, { locationId: A, range }, { client: fakeClient().client, env: ON });
      // The allowlist is the group table of lib/business-access-shared.ts: the base and every group the viewer holds
      // (tests/business-report-gm-payload.test.ts runs every coherent setting against a hand-written copy).
      const allowed = new Set(businessDtoPaths(dto.access));
      const unknown = [...new Set(paths(dto))].filter((p) => !allowed.has(p.replace(/\[\]/g, "[]")));
      expect(unknown).toEqual([]);
    }
    expect(businessDtoPaths(businessAccessFor("gm", null))).toContain("people[].straightCostCents");
    expect(businessDtoPaths(businessAccessFor("gm", gmOff("person_cost")))).not.toContain("people[].straightCostCents");
    expect(businessDtoPaths(businessAccessFor("moo", null))).toContain("people[].straightCostCents");
  });
  it("company-scope (labor-v1) weeks are suppressed as 'rebuilding'", async () => {
    const f = fakeClient({ weeks: [{ week_start: "2026-09-27", ot_scope: "company", builder_version: "labor-v1" }, { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }] });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    const old = dto.days.find((d) => d.date === "2026-10-03")!;
    expect(old.labor).toMatchObject({ state: "rebuilding", pct: null, pureHourlyCents: null });
    expect(dto.days.find((d) => d.date === "2026-10-04")!.labor.state).toBe("ok");
    expect(dto.people[0]).toMatchObject({ weeksSuppressed: 1 });
    expect(dto.people[0]!.straightCostCents).toBeNull();
    expect(dto.total.labor).toMatchObject({ pct: null, state: "rebuilding" });
    // Fix round 2, P2: a rebuilding week keeps its quarter HOURS; only the money and the % are withheld.
    const oldQ = dto.quarters!.find((q) => q.date === "2026-10-03" && q.quarterStartAt === "2026-10-03T16:00:00.000Z")!;
    expect(oldQ).toMatchObject({ laborMinutes: 30, straightCents: null, pct: null });
    const newQ = dto.quarters!.find((q) => q.date === "2026-10-04" && q.quarterStartAt === "2026-10-04T16:00:00.000Z")!;
    expect(newQ).toMatchObject({ laborMinutes: 30, straightCents: 900, pct: 90 });
  });
  it("fix round 3: a rebuild that commits DURING the labor reads is 'rebuilding', never old money under the new generation", async () => {
    // The costs/people/quarters were read from the company-scope (labor-v1) build; the per_shop rebuild commits
    // right after. A single coverage read taken alongside would see per_shop and pass the old overtime as ready.
    const old = [{ week_start: "2026-09-27", ot_scope: "company", builder_version: "labor-v1", built_at: "2026-11-01T00:00:00Z", source_fingerprint: "a".repeat(32) },
      { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "b".repeat(32) }];
    const fresh = [{ ...old[0]!, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-17T12:00:00Z" }, old[1]!];
    const f = fakeClient({ weeks: old, weeksAfterRebuild: fresh });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.days.find((d) => d.date === "2026-10-03")!.labor).toMatchObject({ state: "rebuilding", pct: null, pureHourlyCents: null });
    expect(dto.days.find((d) => d.date === "2026-10-04")!.labor.state).toBe("ok");
    expect(dto.people[0]).toMatchObject({ weeksSuppressed: 1, straightCostCents: null });
    expect(dto.total.labor).toMatchObject({ pct: null, state: "rebuilding" });
    expect(dto.quarters!.find((q) => q.date === "2026-10-03" && q.quarterStartAt === "2026-10-03T16:00:00.000Z")).toMatchObject({ laborMinutes: 30, straightCents: null, pct: null });
  });
  it("fix round 3: a same-generation rebuild (new built_at only) during the reads is still 'rebuilding'", async () => {
    const old = [{ week_start: "2026-09-27", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "a".repeat(32) },
      { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "b".repeat(32) }];
    const f = fakeClient({ weeks: old, weeksAfterRebuild: [{ ...old[0]!, built_at: "2026-11-17T12:00:00Z", source_fingerprint: "c".repeat(32) }, old[1]!] });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.days.find((d) => d.date === "2026-10-03")!.labor.state).toBe("rebuilding");
    expect(dto.days.find((d) => d.date === "2026-10-04")!.labor.state).toBe("ok");
  });
  it("fix round 3: a week built for the first time during the reads is 'rebuilding', not ready", async () => {
    const built = { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION, built_at: "2026-11-01T00:00:00Z", source_fingerprint: "b".repeat(32) };
    const f = fakeClient({ weeks: [built], weeksAfterRebuild: [{ ...built, week_start: "2026-09-27", source_fingerprint: "a".repeat(32) }, built] });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.days.find((d) => d.date === "2026-10-03")!.labor).toMatchObject({ state: "rebuilding", pct: null });
  });
  it("board PR 1 (Astra r3 P1-2): a week whose SOURCE moved with no rebuild (a payroll-shop save) is 'rebuilding': its money is withheld here too", async () => {
    const f = fakeClient({ currentFingerprint: (w) => (w === "2026-09-27" ? "9".repeat(32) : undefined) });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.days.find((d) => d.date === "2026-10-03")!.labor).toMatchObject({ state: "rebuilding", pct: null, pureHourlyCents: null, minutes: 30 });
    expect(dto.days.find((d) => d.date === "2026-10-04")!.labor.state).toBe("ok");
    expect(dto.total.labor).toMatchObject({ pct: null, state: "rebuilding" });
    expect(dto.people[0]).toMatchObject({ weeksSuppressed: 1, straightCostCents: null });
  });
  it("board PR 1: the fingerprint is read once per STORED payroll week, with the current builder, after the labor reads; nothing moved = ready", async () => {
    const f = fakeClient();
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    const fp = f.calls.filter((c) => c.fn === "fact_labor_week_fingerprint");
    expect(fp.map((c) => c.args)).toEqual([{ p_week_start: "2026-09-27", p_builder_version: LABOR_BUILDER_VERSION }, { p_week_start: "2026-10-04", p_builder_version: LABOR_BUILDER_VERSION }]);
    expect(f.calls.findIndex((c) => c.fn === "fact_labor_week_fingerprint")).toBeGreaterThan(f.calls.map((c) => c.fn).lastIndexOf("fact_labor_cost"));
    expect(dto.days.every((d) => d.labor.state === "ok")).toBe(true);
  });
  it("board PR 1: a fingerprint read that errors or answers nothing fails CLOSED ('rebuilding'), never a 503 and never ready", async () => {
    for (const said of ["error", null] as const) {
      const f = fakeClient({ currentFingerprint: () => said });
      const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
      expect(dto.days.every((d) => d.labor.state === "rebuilding" && d.labor.pct === null)).toBe(true);
      expect(dto.days[0]!.sales.totalCents).toBeGreaterThan(0);
    }
  });
  it("a rebuilding week's labor-only quarter (no sales) is still listed with its minutes", async () => {
    const f = fakeClient({
      weeks: [{ week_start: "2026-09-27", ot_scope: "company", builder_version: "labor-v1" }, { week_start: "2026-10-04", ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }],
      rpcRows: { business_report_labor_quarters: (args) => [{ business_date: "2026-10-03", week_start: null, quarter_start_at: "2026-10-03T13:00:00.000Z", wall_quarter: 36, fold: 0,
        minutes: 45, hourly_minutes: 45, salaried_minutes: 0, straight_cents: 1_200, estimated_minutes: 0 }].filter(() => String(args.p_from) <= "2026-10-03" && String(args.p_to) >= "2026-10-03") },
    });
    const dto = await loadBusinessReport(moo, { locationId: A, range }, { client: f.client, env: ON });
    expect(dto.quarters!.find((q) => q.quarterStartAt === "2026-10-03T13:00:00.000Z")).toMatchObject({ laborMinutes: 45, straightCents: null, pct: null, toastCents: 0 });
  });
  it("day money is the Sales report's own (parity with summarizeSales over sales_report_daily)", async () => {
    const f = fakeClient();
    const dto = await loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON });
    const daily = await (f.client as unknown as { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: never }> })
      .rpc("sales_report_daily", { p_location_id: A, p_from: range.from, p_to: range.to });
    const buckets = summarizeSales([daily.data], range.from, range.to, "day").buckets;
    expect(dto.days.map((d) => [d.date, d.sales.totalCents, d.sales.toastNetCents])).toEqual(buckets.map((b) => [b.from, b.totalCents, b.toastNetCents]));
    expect(dto.days.every((d) => d.cuts === "ok")).toBe(true);
  });
  it("92 days = three <=31-day windows per read; quarters are returned only for ranges <= 31 days", async () => {
    const wide = resolveBusinessRange({ range: "last90" }, TODAY);
    const f = fakeClient();
    const dto = await loadBusinessReport(moo, { locationId: A, range: wide }, { client: f.client, env: ON });
    const windows = f.calls.filter((c) => c.fn === "sales_report_daily");
    expect(windows).toHaveLength(3);
    for (const w of f.calls.filter((c) => c.fn !== "fact_labor_cost" && c.fn !== "fact_labor_week_fingerprint")) {
      expect(Date.parse(String(w.args.p_to)) - Date.parse(String(w.args.p_from))).toBeLessThanOrEqual(30 * 86_400_000);
    }
    expect(dto.quarters).toBeNull();
    expect(dto.quartersReason).toBe("range_too_wide");
    const narrow = await loadBusinessReport(moo, { locationId: A, range }, { client: fakeClient().client, env: ON });
    expect(narrow.quarters?.length).toBeGreaterThan(0);
    expect(narrow.quarters![0]).toMatchObject({ basis: "toast_only_straight_time", pct: 90 });
  });
});

// Fix round 1, P1: a table-returning RPC is read to completion (paged, exact count) or refused by name —
// never cut at PostgREST's 1,000-row cap.
describe("table-returning reads page to completion (never the 1,000-row cap)", () => {
  const month = resolveBusinessRange({ range: "last30" }, TODAY);
  const weeks = ["2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27", "2026-10-04"]
    .map((w) => ({ week_start: w, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION }));
  const dates = (from: string, to: string) => {
    const out: string[] = [];
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  // 40 occupied quarters a day x 30 days = 1,200 rows in one window.
  const quarters = (args: Record<string, unknown>) => dates(String(args.p_from), String(args.p_to)).flatMap((d) =>
    Array.from({ length: 40 }, (_, i) => ({ business_date: d, week_start: null, quarter_start_at: new Date(Date.parse(`${d}T12:00:00.000Z`) + i * 900_000).toISOString(),
      wall_quarter: 32 + i, fold: 0, minutes: 15, hourly_minutes: 15, salaried_minutes: 0, straight_cents: 10, estimated_minutes: 0 })));
  // 40 gift-card rows a day ahead of each day's two sale rows: the late days' sales fall past row 1,000 unpaged.
  const cuts = (args: Record<string, unknown>) => dates(String(args.p_from), String(args.p_to)).flatMap((d) => [
    ...Array.from({ length: 40 }, (_, i) => ({ business_date: d, quarter_start_at: `${d}T15:00:00.000Z`, wall_quarter: 44, fold: 0, et_date: d, channel: "gift_card",
      provider: `g${String(i).padStart(2, "0")}`, server_guid: null, server_label: null, sale_class: "gift_card", checks: 1, amount_cents: 500, amount_missing: 0, large_checks: 0, large_cents: 0 })),
    { business_date: d, quarter_start_at: `${d}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: d, channel: "dine_in", provider: null,
      server_guid: "srv-1", server_label: "Ana", sale_class: "sale", checks: 1, amount_cents: 1_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
    { business_date: d, quarter_start_at: `${d}T16:15:00.000Z`, wall_quarter: 49, fold: 0, et_date: d, channel: "online", provider: null,
      server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: 2_000, amount_missing: 0, large_checks: 0, large_cents: 0 },
  ]);
  const people = (args: Record<string, unknown>) => Array.from({ length: 1_300 }, (_, i) => ({ week_start: "2026-09-27",
    person_key: `toast:${String(i).padStart(5, "0")}`, user_id: null, person_label: null, role_key: 0, source: "toast", pay_class: "hourly",
    minutes: args.p_from === month.from ? 1 : 0, ot_minutes: 0, straight_cents: 0 }));

  it("1,200 labor quarters, 1,260 cut rows and 1,300 people in one window all arrive", async () => {
    const f = fakeClient({ weeks, rpcRows: { business_report_labor_quarters: quarters, business_report_check_cuts: cuts, business_report_labor_people: people } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: month }, { client: f.client, env: ON });
    expect(dto.days.every((d) => d.cuts === "ok")).toBe(true);
    const laborQuarters = dto.quarters!.filter((q) => q.laborMinutes !== null);
    expect(laborQuarters).toHaveLength(30 * 40);
    expect(laborQuarters.reduce((s, q) => s + q.laborMinutes!, 0)).toBe(30 * 40 * 15);
    expect(dto.people).toHaveLength(1_300);
    expect(f.calls.filter((c) => c.fn === "business_report_labor_quarters").length).toBeGreaterThan(1);
  });
  it("a server whose max-rows is below the page still delivers everything (exact count decides the end)", async () => {
    const f = fakeClient({ weeks, maxRows: 300, rpcRows: { business_report_labor_quarters: quarters } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: month }, { client: f.client, env: ON });
    expect(dto.quarters!.filter((q) => q.laborMinutes !== null)).toHaveLength(30 * 40);
  });
  it("a read that cannot be completed is refused by name, never a partial report", async () => {
    const f = fakeClient({ weeks, countBias: 5, rpcRows: { business_report_labor_quarters: quarters } });
    await expect(loadBusinessReport(moo, { locationId: A, range: month }, { client: f.client, env: ON }))
      .rejects.toMatchObject({ status: 503, code: "business_reads_incomplete" });
  });
});

// Fix round 1, P2: the quarter denominator is ALL that quarter's Toast check sales, catering channel included;
// only the rush detector leaves catering out. Checks with no opened quarter are an unassigned bucket.
describe("quarter sales include ordinary Toast catering; unassigned is shown", () => {
  const D = "2026-10-07";
  const one = resolveBusinessRange({ range: "yesterday" }, TODAY);
  const daily = () => ({ classes: [{ business_date: D, sale_class: "sale", checks: 3, amount_cents: 52_500, tax_cents: 0, amount_missing: 0, tax_missing: 0,
    gross_cents: 52_500, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: [D], ezcater: [] });
  const cut = (channel: string, at: string | null, cents: number) => ({ business_date: D, quarter_start_at: at, wall_quarter: at ? 48 : null, fold: at ? 0 : null,
    et_date: at ? D : null, channel, provider: null, server_guid: null, server_label: null, sale_class: "sale", checks: 1, amount_cents: cents, amount_missing: 0, large_checks: 0, large_cents: 0 });
  const cuts = (args: Record<string, unknown>) => String(args.p_to) < D ? [] : [
    cut("dine_in", `${D}T16:00:00.000Z`, 10_000), cut("catering", `${D}T16:00:00.000Z`, 40_000), cut("dine_in", null, 2_500)];
  const labor = () => [{ business_date: D, week_start: null, quarter_start_at: `${D}T16:00:00.000Z`, wall_quarter: 48, fold: 0,
    minutes: 15, hourly_minutes: 15, salaried_minutes: 0, straight_cents: 5_000, estimated_minutes: 0 }];

  it("$100 ordinary + $400 unlinked Toast catering, $50 straight time = 10%, not 50%", async () => {
    const f = fakeClient({ rpcRows: { sales_report_daily: daily, business_report_check_cuts: cuts, business_report_labor_quarters: labor } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: one }, { client: f.client, env: ON });
    expect(dto.days[0]!.cuts).toBe("ok");
    const q = dto.quarters!.find((x) => x.quarterStartAt === `${D}T16:00:00.000Z`)!;
    expect(q).toMatchObject({ toastCents: 50_000, checks: 2, straightCents: 5_000, pct: 10 });
  });
  it("quarters plus the unassigned bucket recompose to the day's Toast check sales", async () => {
    const f = fakeClient({ rpcRows: { sales_report_daily: daily, business_report_check_cuts: cuts, business_report_labor_quarters: labor } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: one }, { client: f.client, env: ON });
    expect(dto.quartersUnassigned).toEqual([{ date: D, toastCents: 2_500, checks: 1, amountMissing: 0 }]);
    const sum = dto.quarters!.filter((x) => x.date === D).reduce((s, x) => s + (x.toastCents ?? 0), 0) + dto.quartersUnassigned![0]!.toastCents;
    expect(sum).toBe(dto.days[0]!.sales.toastChecksCents);
  });
});

// Fix round 2, P2: a quarter holding a check of UNKNOWN amount has unknown sales — no labor %, and it never
// takes part in a rush comparison (today or as history). The day still recomposes (the missing counts match).
describe("a quarter with an unknown check amount has no labor %", () => {
  const D = "2026-10-07";
  const one = resolveBusinessRange({ range: "yesterday" }, TODAY);
  const daily = () => ({ classes: [{ business_date: D, sale_class: "sale", checks: 2, amount_cents: 10_000, tax_cents: 0, amount_missing: 1, tax_missing: 0,
    gross_cents: 10_000, discounts_comps_cents: 0, voids_cents: 0, service_charges_cents: 0, accounting_missing: 0 }],
    tips: [], discounts: [], refunds: [], captured_days: [D], ezcater: [] });
  const cuts = (args: Record<string, unknown>) => String(args.p_to) < D ? [] : [
    { business_date: D, quarter_start_at: `${D}T16:00:00.000Z`, wall_quarter: 48, fold: 0, et_date: D, channel: "dine_in", provider: null,
      server_guid: null, server_label: null, sale_class: "sale", checks: 2, amount_cents: 10_000, amount_missing: 1, large_checks: 0, large_cents: 0 }];
  const labor = () => [{ business_date: D, week_start: null, quarter_start_at: `${D}T16:00:00.000Z`, wall_quarter: 48, fold: 0,
    minutes: 15, hourly_minutes: 15, salaried_minutes: 0, straight_cents: 5_000, estimated_minutes: 0 }];

  it("$100 known + one unknown check, $50 straight time = no % (not 50%); the missing count is carried", async () => {
    const f = fakeClient({ rpcRows: { sales_report_daily: daily, business_report_check_cuts: cuts, business_report_labor_quarters: labor } });
    const dto = await loadBusinessReport(moo, { locationId: A, range: one }, { client: f.client, env: ON });
    expect(dto.days[0]!.cuts).toBe("ok");
    const q = dto.quarters!.find((x) => x.quarterStartAt === `${D}T16:00:00.000Z`)!;
    expect(q).toMatchObject({ toastCents: 10_000, checks: 2, amountMissing: 1, straightCents: 5_000, pct: null });
  });
});

// ── Business report access (2026-11-19): who reads which shop, and the settings a GM's report is cut by ──
describe("business report access: scope by ROLE, and the settings store read fail closed", () => {
  const ALL_ON = GM_ALL_ON;
  const load = (viewer: Parameters<typeof loadBusinessReport>[0], o: Parameters<typeof fakeClient>[0] = {}, locationId = A) => {
    const f = fakeClient(o);
    return { f, p: loadBusinessReport(viewer, { locationId, range }, { client: f.client, env: ON }) };
  };
  it("a GM reads only a shop they belong to; MoO / Owner / CGS any shop; nobody reads 'all'", async () => {
    await expect(load(gm, {}, B).p).rejects.toMatchObject({ status: 403, code: "location_forbidden" });
    await expect(load({ ...gm, locations: [A, B] }, {}, B).p).resolves.toMatchObject({ locationId: B });
    for (const viewer of [moo, { userId: "o", level: 9, role: "owner" as const, locations: [] }, { userId: "c", level: 10, role: "cgs" as const, locations: [] }]) {
      await expect(load(viewer, {}, B).p).resolves.toMatchObject({ locationId: B });
      await expect(load(viewer, {}, "all").p).rejects.toMatchObject({ status: 400, code: "invalid_location" });
    }
  });
  it("the shop is by ROLE, never by level: a level 8+ that is not MoO / Owner / CGS reads no shop it does not belong to", async () => {
    // No such role exists today; the rule must not hand a future one every shop because of its number.
    const r = load({ userId: "x", level: 9, role: "gm", locations: [A] }, {}, B);
    await expect(r.p).rejects.toMatchObject({ status: 403, code: "location_forbidden" });
    expect(r.f.tables).toHaveLength(0);
  });
  it("a GM's load reads the settings FIRST, once, before any report read", async () => {
    const { f, p } = load(gm);
    await p;
    expect(f.tables[0]).toBe("business_report_gm_visibility");
    expect(f.visibilityReads()).toBe(1);
  });
  it("MoO / Owner / CGS never read the settings, whatever state the store is in", async () => {
    for (const visibility of [["missing"], ["error"], ["throw"], [{ raw: "junk" }], [gmOff("report")]] as const) {
      const { f, p } = load(moo, { visibility });
      const dto = await p;
      expect(Object.values(dto.access).every((v) => v === true)).toBe(true);
      expect(f.visibilityReads()).toBe(0);
      expect(dto.people![0]).toMatchObject({ straightCostCents: 18_000 });
    }
  });
  const REFUSED: Array<[string, Parameters<typeof fakeClient>[0], number, string]> = [
    ["the table is missing (0349 not applied)", { visibility: ["missing"] }, 503, "business_access_not_installed"],
    ["the read fails", { visibility: ["error"] }, 503, "business_access_unavailable"],
    ["the read throws", { visibility: ["throw"] }, 503, "business_access_unavailable"],
    ["the row has an extra key", { visibility: [{ raw: { ...ALL_ON, extra: true } }] }, 503, "business_access_unavailable"],
    ["the row has a non-boolean", { visibility: [{ raw: { ...ALL_ON, people: 1 } }] }, 503, "business_access_unavailable"],
    ["the row is incoherent", { visibility: [{ raw: { ...ALL_ON, hourly_cost: false } }] }, 503, "business_access_unavailable"],
    ["the row's settings are not an object", { visibility: [{ raw: [ALL_ON] }] }, 503, "business_access_unavailable"],
    ["the report is switched off for GMs", { visibility: [gmOff("report")] }, 403, "gm_report_off"],
    ["the row is the nine keys of 0349's first draft", { visibility: [{ raw: { report: true, hourly_cost: true, loaded: true, quarters: true, channels: true, people: true,
      servers: true, compare: true, export: true } }] }, 503, "business_access_unavailable"],
  ];
  for (const [name, opts, status, code] of REFUSED) {
    it(`a GM, when ${name}: ${status} ${code}, and NOTHING of the report is read (never the defaults, never wider)`, async () => {
      const { f, p } = load(gm, opts);
      await expect(p).rejects.toMatchObject({ status, code });
      expect(f.calls).toHaveLength(0);
      expect(f.tables).toEqual(["business_report_gm_visibility"]);
    });
  }
  it("no row saved yet: the defaults; a saved row: its settings", async () => {
    expect((await load(gm, { visibility: [null] }).p).access).toEqual(businessAccessFor("gm", null));
    expect((await load(gm, { visibility: [ALL_ON] }).p).access).toMatchObject({ loaded: true, personCost: true, quarterCost: true, personSalary: true });
    const hoursOnly = await load(gm, { visibility: [gmOff("hourly_cost")] }).p;
    expect(hoursOnly.access).toMatchObject({ hourlyCost: false, loaded: false, people: true, personCost: false, quarterCost: false, personSalary: false });
    expect(JSON.stringify(hoursOnly)).not.toMatch(/straightCents|CostCents/);
    expect(hoursOnly.total.labor).not.toHaveProperty("pureHourlyCents");
    expect(hoursOnly.total.labor).not.toHaveProperty("pct");
    expect(hoursOnly.total.labor).toMatchObject({ minutes: expect.any(Number) });
  });
  it("the settings are read per load: nothing is remembered between two loads", async () => {
    const f = fakeClient({ visibility: [ALL_ON, gmOff("loaded")] });
    const first = await loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON });
    const second = await loadBusinessReport(gm, { locationId: A, range }, { client: f.client, env: ON });
    expect([first.access.loaded, second.access.loaded]).toEqual([true, false]);
    expect(second.total.labor).not.toHaveProperty("fullyLoadedCents");
  });
  it("the switch and the role are still judged before the settings (nothing is read while dark or for a refused role)", async () => {
    for (const [viewer, env] of [[gm, { ...ON, BUSINESS_REPORT: "0" }], [agm, ON], [smm, ON]] as const) {
      const f = fakeClient({ visibility: ["throw"] });
      await expect(loadBusinessReport(viewer, { locationId: A, range }, { client: f.client, env })).rejects.toBeInstanceOf(BusinessReportError);
      expect(f.tables).toHaveLength(0);
    }
  });
});
