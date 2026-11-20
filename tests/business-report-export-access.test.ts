// Business report access (plan r6, test 4): the DOWNLOAD boundary, through the REAL export entry point.
//
// loadExportTable (the route's own loader) runs the real businessExportTable, the real report loader, the real view,
// the real CSV row builders, the real CSV writer and the real PDF model. Only the database is fake.
//   - every coherent setting x every tab, as a GM: a download or a tab that is off is 403 with ZERO report reads;
//     an allowed file holds no amount of a group that is off (CSV cells, the figure_notes cell, the notes block; PDF
//     cells, column labels, legend and notes), and DOES hold the amounts of every group that is on;
//   - Compare: neither period's hidden amounts, both periods' shown ones;
//   - the settings store missing / unreadable / malformed: 503, zero report reads; MoO / Owner / CGS unaffected;
//   - empty ranges obey the same switches;
//   - settings that MOVE between the early check and the load(s): judged on the access the report was built with;
//     two periods built under different settings are refused, never mixed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { gmVisibilityCombinations, businessAccessFor, businessTabAllowed, type GmVisibility } from "@/lib/business-access-shared";
import { ExportError, loadExportTable, type ExportTable } from "@/lib/report-export";
import { BUSINESS_EXPORT_TABS, toCsv, type BusinessExportTab } from "@/lib/report-export-shared";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { serverT } from "@/lib/i18n/server";
import { A, GM_ALL_ON, VISIBILITY_TABLE, gmOff, type FakeOpts } from "./helpers/business-report-fake";
import { DAY, figuresOf, pricedFake } from "./helpers/business-access-fixture";

const B = "bbbbbbbb-0000-4000-8000-00000000000b";
const PREVIOUS = "2026-10-04"; // the one day before DAY: Compare's earlier period, priced at twice DAY's pay
const NOW = new Date("2026-10-08T16:00:00Z");
const RANGE = { range: "custom", from: DAY, to: DAY };
const auth = (role: string, level: number, locations: string[] = [A]) => ({ user: { id: "viewer-1", role, name: "Viewer One", language: "en" }, role, level, locations, session: {} }) as never;
const GM = auth("gm", 7);

function wire(o: FakeOpts = {}) {
  const biz = pricedFake(o, { [DAY]: 1, [PREVIOUS]: 2 });
  const shopQ = { select: () => shopQ, eq: () => shopQ, maybeSingle: async () => ({ data: { id: A, code: "MEP", name: "Capitol Hill" }, error: null }) };
  vi.mocked(getServiceRoleClient).mockImplementation(() => ({
    rpc: (...a: unknown[]) => (biz.client as { rpc: (...x: unknown[]) => unknown }).rpc(...a),
    from: (t: string) => (t === "locations" ? shopQ : (biz.client as { from: (x: string) => unknown }).from(t)),
  }) as never);
  return biz;
}
/** Report reads = anything but the settings read (and the shop's name, which the wrapper answers itself). */
const reportReads = (f: ReturnType<typeof wire>) => f.calls.length + f.tables.filter((t) => t !== VISIBILITY_TABLE).length;
const load = (who: unknown, tab: BusinessExportTab, extra: Record<string, string> = {}) => loadExportTable(who as never, "business", { location: A, tab, ...RANGE, ...extra }, NOW);
async function refusal(p: Promise<unknown>): Promise<[number, string]> {
  const e = await p.then(() => null, (x: unknown) => x);
  if (!(e instanceof ExportError)) throw new Error(`expected a refusal, got ${e === null ? "a file" : String(e)}`);
  return [e.status, e.code];
}
/** Everything a person or a program reads in the two files. */
function texts(t: ExportTable) {
  const notes = (t.notices ?? []).map((n) => serverT("en", n.key, n.values));
  const pdf = t.pdf ? [...t.pdf.tables.flatMap((x) => [x.heading ?? "", ...x.columns.map((c) => c.label ?? ""), ...x.rows.flatMap((r) => Object.values(r).map((v) => String(v ?? "")))]),
    ...t.pdf.legend, ...t.pdf.notes, ...notes].join("\n") : "";
  return { csv: toCsv(t.columns, t.rows, [], notes), pdf, files: [{ kind: "csv" as const, text: toCsv(t.columns, t.rows, [], notes) }, { kind: "pdf" as const, text: pdf }] };
}
const CSV = (text: string) => ({ kind: "csv" as const, text }), PDF = (text: string) => ({ kind: "pdf" as const, text });
const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** `token` as a whole number in `text`: not the tail or the head of a longer one. `afterComma` = a comma may stand
 * right before or after it (a CSV field separator); in the grouped numbers of the PDF ("3,120.00") it may not. */
const has = (text: string, token: string, afterComma = false) =>
  new RegExp(`(?<![0-9.${afterComma ? "" : ","}])${token.replace(/[.,$]/g, (c) => `[${c}]`)}(?![0-9]|[.${afterComma ? "" : ","}][0-9])`).test(text);
/** A money amount in a file. The CSV writes plain dollars ("1860.00"); the PDF grouped dollars ("$1,860.00"). Raw
 * integer cents must never be in either, so they are searched for too. */
const hasMoney = (file: { kind: "csv" | "pdf"; text: string }, cents: number) => (file.kind === "csv"
  ? has(file.text, (cents / 100).toFixed(2), true) || has(file.text, String(cents), true)
  : has(file.text, usd(cents)) || has(file.text, String(cents)));
const hasPct = (pdf: string, pct: number) => has(pdf, `${pct}%`);

/** The secrets of each period (scale 1 = DAY, 2 = the earlier period), by the group that holds them. */
function secrets(scale: number) {
  const f = figuresOf(scale);
  return { hourly: [f.hourly, f.premium], loaded: [f.salaried, f.burden, f.loaded], people: f.people, quarters: f.quarters,
    hourlyPct: scale === 1 ? 18.6 : 37.2, loadedPct: scale === 1 ? 32 : 64.1 };
}
const CSV_COLUMNS = {
  hourly: ["pure_hourly_cost", "overtime_premium", "pure_hourly_pct", "pure_hourly_target_pct", "wage_estimated"],
  loaded: ["salaried_cost", "burden_cost", "fully_loaded_cost", "fully_loaded_pct", "fully_loaded_target_pct", "fully_loaded_state", "burden_estimated", "salary_estimated", "salary_gaps"],
  /** One column pair, two groups: on the People file it is cost per hourly person, on the Hours file labor dollars per 15 minutes. */
  cost: ["straight_time_cost", "straight_time_pct"],
};
function cells(t: ExportTable, column: string): unknown[] {
  return t.columns.some((c) => c.key === column) ? t.rows.map((r) => r[column]) : [];
}
const filled = (xs: unknown[]) => xs.filter((x) => x !== null && x !== undefined && x !== "");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BUSINESS_REPORT", "1"); vi.stubEnv("FACT_LAYER", "1"); vi.stubEnv("FACT_LAYER_LABOR", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("the fixture's second period is what the scan looks for", () => {
  it("MoO Compare: both periods' figures are in the files, with the stated percentages", async () => {
    wire();
    const { csv, pdf } = texts(await load(auth("moo", 8, []), "compare"));
    for (const scale of [1, 2]) {
      const s = secrets(scale);
      for (const n of [...s.hourly, ...s.loaded]) { expect(hasMoney(CSV(csv), n), `csv ${n}`).toBe(true); expect(hasMoney(PDF(pdf), n), `pdf ${n}`).toBe(true); }
      expect(hasPct(pdf, s.hourlyPct), String(s.hourlyPct)).toBe(true);
      expect(hasPct(pdf, s.loadedPct), String(s.loadedPct)).toBe(true);
    }
  });
});

describe("a GM: every coherent setting x every tab, CSV and PDF", () => {
  it("off downloads and off tabs are refused before any report read; an allowed file holds exactly what the setting holds", async () => {
    const combos = gmVisibilityCombinations().filter((s) => s.report);
    let files = 0, refused = 0;
    for (const s of combos) {
      const access = businessAccessFor("gm", s);
      for (const tab of BUSINESS_EXPORT_TABS) {
        const label = `${tab} under ${JSON.stringify(s)}`;
        const f = wire({ visibility: [s] });
        if (!s.export || !businessTabAllowed(access, tab)) {
          // The tab is judged first (a file of a tab that is not in the report is never even considered).
          expect(await refusal(load(GM, tab)), label).toEqual([403, businessTabAllowed(access, tab) ? "business_export_off" : "business_tab_off"]);
          expect(reportReads(f), `report reads: ${label}`).toBe(0);
          refused++;
          continue;
        }
        const t = await load(GM, tab);
        const { csv, pdf } = texts(t);
        files++;
        const periods = tab === "compare" ? [1, 2] : [1];
        for (const scale of periods) {
          const x = secrets(scale);
          // Juan 2026-11-19: cost per hourly person is in the People file exactly with `person_cost`, labor dollars
          // per 15 minutes in the Hours file exactly with `quarter_cost` (the PDF prints the HOUR: both quarters of
          // the fixture are one hour, so it holds their sum). Nowhere else, under any setting.
          const personCost = tab === "people" && s.person_cost, quarterCost = tab === "hours" && s.quarter_cost;
          for (const n of x.people) for (const file of [CSV(csv), PDF(pdf)]) expect(hasMoney(file, n), `${n} (cost per person) in ${label}`).toBe(personCost);
          for (const n of x.quarters) {
            expect(hasMoney(CSV(csv), n), `${n} (15-minute dollars) in the CSV: ${label}`).toBe(quarterCost);
            expect(hasMoney(PDF(pdf), n), `${n} (15-minute dollars) in the PDF: ${label}`).toBe(false);
          }
          if (tab === "hours") expect(hasMoney(PDF(pdf), x.quarters.reduce((a, b) => a + b, 0)), `the hour's labor dollars in the PDF: ${label}`).toBe(s.quarter_cost);
          // A SALARIED amount is never in the People file, whatever is on (the salary per person included: the report lists none).
          if (tab === "people") for (const n of x.loaded) for (const file of [CSV(csv), PDF(pdf)]) expect(hasMoney(file, n), `${n} (a salaried amount) in ${label}`).toBe(false);
          // A group that is off: none of its amounts, in either file.
          if (!s.hourly_cost) for (const n of x.hourly) for (const file of [CSV(csv), PDF(pdf)]) expect(hasMoney(file, n), `${n} (hourly) in ${label}`).toBe(false);
          if (!s.loaded) for (const n of x.loaded) for (const file of [CSV(csv), PDF(pdf)]) expect(hasMoney(file, n), `${n} (loaded) in ${label}`).toBe(false);
          if (!s.hourly_cost) expect(hasPct(pdf, x.hourlyPct), `hourly % in ${label}`).toBe(false);
          if (!s.loaded) expect(hasPct(pdf, x.loadedPct), `loaded % in ${label}`).toBe(false);
          // A group that is ON: its amounts ARE in both files (the tabs that carry labor money: Overview, Compare).
          if (tab === "overview" || tab === "compare") {
            if (s.hourly_cost) for (const n of x.hourly) { expect(hasMoney(CSV(csv), n), `csv lacks ${n}: ${label}`).toBe(true); expect(hasMoney(PDF(pdf), n), `pdf lacks ${n}: ${label}`).toBe(true); }
            if (s.loaded) for (const n of x.loaded) { expect(hasMoney(CSV(csv), n), `csv lacks ${n}: ${label}`).toBe(true); expect(hasMoney(PDF(pdf), n), `pdf lacks ${n}: ${label}`).toBe(true); }
            if (s.hourly_cost) expect(hasPct(pdf, x.hourlyPct), `pdf lacks hourly %: ${label}`).toBe(true);
            if (s.loaded) expect(hasPct(pdf, x.loadedPct), `pdf lacks loaded %: ${label}`).toBe(true);
          }
        }
        // The CSV, column by column: a group that is off has EMPTY cells (state and flag columns included) and no
        // entry in figure_notes; the cost columns are filled only on the file and under the switch that holds them.
        const costOn = (tab === "people" && s.person_cost) || (tab === "hours" && s.quarter_cost);
        if (!costOn) for (const c of CSV_COLUMNS.cost) expect(filled(cells(t, c)), `${c}: ${label}`).toEqual([]);
        else expect(filled(cells(t, "straight_time_cost")).length, `straight_time_cost: ${label}`).toBeGreaterThan(0);
        // ... and a salaried person's cost cell is empty under EVERY setting.
        if (tab === "people") for (const r of t.rows.filter((x) => x.row_type === "person" && x.pay_class !== "hourly")) expect(filled([r.straight_time_cost]), `a salaried person's cost: ${label}`).toEqual([]);
        if (!s.hourly_cost) for (const c of CSV_COLUMNS.hourly) expect(filled(cells(t, c)), `${c}: ${label}`).toEqual([]);
        if (!s.loaded) for (const c of CSV_COLUMNS.loaded) expect(filled(cells(t, c)), `${c}: ${label}`).toEqual([]);
        const notes = cells(t, "figure_notes").map((x) => String(x ?? "")).join("; ");
        for (const c of [...(costOn ? [] : CSV_COLUMNS.cost), ...(s.hourly_cost ? [] : CSV_COLUMNS.hourly), ...(s.loaded ? [] : CSV_COLUMNS.loaded)]) expect(notes, `figure_notes names ${c}: ${label}`).not.toContain(`${c}=`);
        // The PDF names no hidden column and holds no "not included" dash: a hidden group is simply not printed.
        if (!s.loaded) for (const w of ["Salaries", "Burden", "Fully loaded"]) expect(pdf, `"${w}" in the PDF: ${label}`).not.toContain(w);
        if (!s.hourly_cost) for (const w of ["Hourly labor", "Pure hourly labor", "Overtime premium", "Hourly %", "Labor % ="]) expect(pdf, `"${w}" in the PDF: ${label}`).not.toContain(w);
        expect(pdf, label).not.toContain("Not included in this view");
        expect(csv, label).not.toContain("not_shared");
        // The lists: People holds people only with `people`, servers only with `servers`.
        if (tab === "people") {
          const kinds = cells(t, "row_type");
          expect(kinds.includes("person"), `person rows: ${label}`).toBe(s.people);
          expect(kinds.includes("server"), `server rows: ${label}`).toBe(s.servers);
          expect(pdf.includes("Cy"), `a person's name in the PDF: ${label}`).toBe(s.people);
          expect(pdf.includes("Sales by server"), `the server table in the PDF: ${label}`).toBe(s.servers);
        }
      }
    }
    // 448 settings with the report on x 5 tabs.
    // 224 of them allow downloads: Overview for all 224, Channels / Compare for 112 each, Hours for 144 (8 x the 18
    // of 28 money states with the hours section on), People for 192 (112 with servers on + 4 x the 20 with people on).
    expect(combos).toHaveLength(448);
    expect([files, refused]).toEqual([224 + 112 * 2 + 144 + 192, 448 * 5 - (224 + 112 * 2 + 144 + 192)]);
  }, 600_000);
  it("the report switched off for GMs: every tab is 403 gm_report_off, zero report reads", async () => {
    const off = gmVisibilityCombinations().filter((s) => !s.report);
    expect(off).toHaveLength(1);
    for (const tab of BUSINESS_EXPORT_TABS) {
      const f = wire({ visibility: [off[0]!] });
      expect(await refusal(load(GM, tab)), tab).toEqual([403, "gm_report_off"]);
      expect(reportReads(f)).toBe(0);
    }
  });
  it("no settings row yet: the defaults: a GM's Overview has hourly labor and no fully loaded labor", async () => {
    wire({ visibility: [null] });
    const t = await load(GM, "overview");
    const { csv, pdf } = texts(t);
    const x = secrets(1);
    for (const n of x.hourly) { expect(hasMoney(CSV(csv), n)).toBe(true); expect(hasMoney(PDF(pdf), n)).toBe(true); }
    for (const n of x.loaded) { expect(hasMoney(CSV(csv), n)).toBe(false); expect(hasMoney(PDF(pdf), n)).toBe(false); }
    expect(filled(cells(t, "pure_hourly_pct")).length).toBeGreaterThan(0);
    expect(filled(cells(t, "fully_loaded_pct"))).toEqual([]);
  });
});

describe("the settings store, fail closed", () => {
  const CASES: Array<[string, FakeOpts["visibility"], [number, string]]> = [
    ["the table is missing (0349 not applied)", ["missing"], [503, "business_access_not_installed"]],
    ["the read fails", ["error"], [503, "business_access_unavailable"]],
    ["the read throws", ["throw"], [503, "business_access_unavailable"]],
    ["a row with an extra key", [{ raw: { ...GM_ALL_ON, extra: true } }], [503, "business_access_unavailable"]],
    ["a row with a non-boolean", [{ raw: { ...GM_ALL_ON, loaded: "true" } }], [503, "business_access_unavailable"]],
    ["an incoherent row (a child on under a parent that is off)", [{ raw: { ...GM_ALL_ON, hourly_cost: false } }], [503, "business_access_unavailable"]],
    ["a row that is not an object", [{ raw: "all" }], [503, "business_access_unavailable"]],
    ["a row whose settings are null", [{ raw: null }], [503, "business_access_unavailable"]],
    ["a row with a key missing", [{ raw: { ...GM_ALL_ON, export: undefined } }], [503, "business_access_unavailable"]],
  ];
  for (const [name, visibility, want] of CASES) {
    it(`${name}: a GM gets ${want[1]} on every tab, with zero report reads; MoO / Owner / CGS get their file and read no settings`, async () => {
      for (const tab of BUSINESS_EXPORT_TABS) {
        const f = wire({ visibility });
        expect(await refusal(load(GM, tab)), tab).toEqual(want);
        expect(reportReads(f), tab).toBe(0);
      }
      for (const [role, level] of [["moo", 8], ["owner", 9], ["cgs", 10]] as const) {
        const f = wire({ visibility });
        const t = await load(auth(role, level, []), "overview");
        expect(hasMoney(CSV(texts(t).csv), figuresOf().loaded), role).toBe(true);
        expect(f.visibilityReads(), role).toBe(0);
      }
    });
  }
});

describe("empty ranges obey the same switches (nothing is loaded, so the early check is the whole answer)", () => {
  const EMPTY: Array<[string, Record<string, string>]> = [
    ["no finished day", { from: "2026-10-08", to: "2026-10-08" }], ["a start after the end", { from: "2026-10-07", to: "2026-10-01" }],
  ];
  for (const [name, range] of EMPTY) {
    it(`${name}: downloads off = 403; the tab off = 403; the store unreadable = 503; otherwise the notice file`, async () => {
      let f = wire({ visibility: [{ ...GM_ALL_ON, export: false }] });
      expect(await refusal(load(GM, "overview", range))).toEqual([403, "business_export_off"]);
      f = wire({ visibility: [{ ...GM_ALL_ON, compare: false }] });
      expect(await refusal(load(GM, "compare", range))).toEqual([403, "business_tab_off"]);
      f = wire({ visibility: ["missing"] });
      expect(await refusal(load(GM, "overview", range))).toEqual([503, "business_access_not_installed"]);
      expect(reportReads(f)).toBe(0);
      f = wire({ visibility: [GM_ALL_ON] });
      const t = await load(GM, "overview", range);
      expect(t.rows).toHaveLength(1);
      expect(t.rows[0]).toMatchObject({ row_type: "notice" });
      expect(reportReads(f)).toBe(0);
    });
  }
  it("dates missing: a GM with downloads off is refused for the switch; with them on, for the dates", async () => {
    wire({ visibility: [{ ...GM_ALL_ON, export: false }] });
    expect(await refusal(loadExportTable(GM, "business", { location: A, tab: "overview", range: "custom" }, NOW))).toEqual([403, "business_export_off"]);
    wire({ visibility: [GM_ALL_ON] });
    expect(await refusal(loadExportTable(GM, "business", { location: A, tab: "overview", range: "custom" }, NOW))).toEqual([400, "range_dates_missing"]);
  });
  it("an empty-range file is the same for a GM and a MoO (it holds no figure at all)", async () => {
    const range = { from: "2026-10-08", to: "2026-10-08" };
    wire({ visibility: [null] });
    const g = await load(GM, "overview", range);
    wire();
    const m = await load(auth("moo", 8, []), "overview", range);
    expect([texts(g).csv, texts(g).pdf]).toEqual([texts(m).csv, texts(m).pdf]);
  });
});

describe("settings that MOVE during the request: the file follows the access the report was BUILT with", () => {
  const off = (k: keyof GmVisibility) => gmOff(k);
  it("downloads ON at the early check, OFF when the loader reads: 403 business_export_off, no file", async () => {
    wire({ visibility: [GM_ALL_ON, off("export")] });
    expect(await refusal(load(GM, "overview"))).toEqual([403, "business_export_off"]);
  });
  it("the tab ON at the early check, OFF when the loader reads: 403 business_tab_off", async () => {
    for (const [tab, key] of [["hours", "quarters"], ["channels", "channels"], ["compare", "compare"]] as const) {
      wire({ visibility: [GM_ALL_ON, off(key)] });
      expect(await refusal(load(GM, tab)), tab).toEqual([403, "business_tab_off"]);
    }
  });
  it("Compare: the settings change between the two periods' loads: 409 business_access_changed, never a file mixing two grants", async () => {
    // early ON, the current period ON, the earlier period with fully loaded labor off.
    wire({ visibility: [GM_ALL_ON, GM_ALL_ON, off("loaded")] });
    expect(await refusal(load(GM, "compare"))).toEqual([409, "business_access_changed"]);
    wire({ visibility: [GM_ALL_ON, off("loaded"), GM_ALL_ON] });
    expect(await refusal(load(GM, "compare"))).toEqual([409, "business_access_changed"]);
    // ... and when the earlier period loses Compare itself, that is the refusal.
    wire({ visibility: [GM_ALL_ON, GM_ALL_ON, off("compare")] });
    expect(await refusal(load(GM, "compare"))).toEqual([403, "business_tab_off"]);
  });
  it("fully loaded labor ON at the early check, OFF at the loader: the file is the NARROWER one", async () => {
    wire({ visibility: [GM_ALL_ON, off("loaded")] });
    const t = await load(GM, "overview");
    const { csv, pdf } = texts(t);
    for (const n of secrets(1).loaded) { expect(hasMoney(CSV(csv), n)).toBe(false); expect(hasMoney(PDF(pdf), n)).toBe(false); }
    for (const n of secrets(1).hourly) expect(hasMoney(CSV(csv), n)).toBe(true);
  });
  it("OFF at the early check is a refusal even if it would be ON a moment later (never wider than what was checked)", async () => {
    wire({ visibility: [off("export"), GM_ALL_ON] });
    expect(await refusal(load(GM, "overview"))).toEqual([403, "business_export_off"]);
  });
});

describe("who may download at all (unchanged, and still before any read)", () => {
  it("AGM, the social media manager and below: 403; a GM at another shop: 403; 'all': 400", async () => {
    for (const [who, location, want] of [[auth("agm", 6), A, [403, "role_insufficient"]], [auth("social_media_mgr", 6), A, [403, "role_insufficient"]],
      [auth("shift_lead", 5), A, [403, "role_insufficient"]], [GM, B, [403, "location_forbidden"]], [auth("moo", 8, []), "all", [400, "one_shop_at_a_time"]]] as const) {
      const f = wire();
      expect(await refusal(loadExportTable(who, "business", { location, tab: "overview", ...RANGE }, NOW))).toEqual(want);
      expect(reportReads(f) + f.visibilityReads()).toBe(0);
    }
  });
});
