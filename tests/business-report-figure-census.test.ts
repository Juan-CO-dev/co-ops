// Item 9b fix round 4 (review ITEM9B-r4): THE CENSUS. Four review rounds found one class in a new place each time —
// a figure that is estimated, provisional or unknown shown as a plain number — because a surface could reach a raw
// amount and format it itself. This file makes that impossible to do quietly:
//
//   1. TYPES    a `Figure` is opaque: its number is not readable (compile errors below, checked by tsc).
//   2. VIEW     the view the surfaces receive (lib/business-view-shared.ts) holds no plain money / percent / hours /
//               count: every number leaf of a real view is either inside a Figure or on the short allowlist of
//               configuration and identity (targets, the rush rule, how many days a list covers).
//   3. SOURCE   the surfaces — every file under components/reports-business, the page, the Dashboard strip's labor cell
//               (components/dashboard/StripLaborCell.tsx, nav PR 8 T-B2, under the SAME rules), and the business section of
//               lib/report-export-shared.ts — never name a raw amount, a DTO type, a number formatter or a sum. Each
//               offence is reported BY NAME (file:line, the rule, the text).
//   4. ROWS     every export row that carries a number names, in `figure_notes`, each figure that is not plain.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));

import { loadBusinessReport } from "@/lib/business-report";
import { resolveBusinessRange } from "@/lib/business-report-shared";
import { figureCells, figureKindOf, purePctFigure, type Figure } from "@/lib/business-figure-shared";
import { businessView, type BusinessReportView } from "@/lib/business-view-shared";
import { BUSINESS_EXPORT_COLUMNS, businessChannelRows, businessCompareRows, businessHoursRows, businessOverviewRows, businessPeopleRows, type ExportRow } from "@/lib/report-export-shared";
import { A, fakeClient, gmOff, type FakeOpts } from "./helpers/business-report-fake";
import { PURE_STATES, laborIn, withLabor } from "./helpers/business-report-states";
import { between, census, code, filesUnder, show, type Offence } from "./helpers/business-figure-census";

const ROOT = path.resolve(__dirname, "..");
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const viewer = (role: "moo" | "gm") => ({ userId: `u-${role}`, level: role === "moo" ? 8 : 7, role, locations: role === "gm" ? [A] : [] as string[] });
const load = (role: "moo" | "gm" = "moo", visibility?: FakeOpts["visibility"]) =>
  loadBusinessReport(viewer(role), { locationId: A, range }, { client: fakeClient({ visibility }).client, env: ON });

// ── 1. Types ────────────────────────────────────────────────────────────────────────────────────

/** Never called: tsc checks it (npx tsc --noEmit covers tests). Each line must be a compile error. */
export function figureIsOpaque(f: Figure, view: BusinessReportView): void {
  // @ts-expect-error a Figure has no readable value
  void f.value;
  // @ts-expect-error nor a unit, a kind or notes to rebuild one from
  void [f.unit, f.kind, f.notes];
  // @ts-expect-error a Figure is not a number
  void (f + 1);
  // @ts-expect-error a plain object is not a Figure: only the builders make one
  const forged: Figure = { unit: "cents", value: 1, kind: "known", reason: null, notes: [], soFar: false };
  void forged;
  // @ts-expect-error the view carries no raw cents
  void view.total.sales.totalCents;
  // @ts-expect-error nor the DTO's labor figures
  void view.total.labor.pureHourlyCents;
  // @ts-expect-error nor a person's raw cost
  void view.people[0]?.straightCostCents;
}

// ── 2. The view holds no plain figure ───────────────────────────────────────────────────────────

/** Number leaves that are configuration or identity, never a figure of the report. `[]` = any element. */
const PLAIN_NUMBERS = new Set([
  "range.days",
  "salesDays.covered", "salesDays.expected",
  "breakdown.included", "breakdown.expected", "breakdown.excluded",
  "breakdownNotice.values.n", "breakdownNotice.values.covered", "breakdownNotice.values.expected", "breakdownNotice.values.excluded",
  "total.target", "total.loadedTarget", "weeks[].target", "weeks[].loadedTarget", "days[].target", "days[].loadedTarget",
  "total.labor.salaryGaps", "weeks[].labor.salaryGaps", "days[].labor.salaryGaps",
  "quarters[].wallQuarter", "days[].quarters[].wallQuarter", "days[].hourly[].quarters[].wallQuarter",
  "people[].weeksWithheld",
  "rushRule.multiplier", "rushRule.historyWeeks", "rushRule.minHistory", "rushRule.minChecks", "rushRule.minBaselineChecks", "rushRule.minRunQuarters",
]);
const isFigure = (v: unknown) => typeof v === "object" && v !== null && "unit" in v && "kind" in v && "notes" in v;
function plainNumbers(v: unknown, at: string, out: Set<string>, figures: { n: number }): void {
  if (typeof v === "number") { out.add(at); return; }
  if (v === null || typeof v !== "object") return;
  if (isFigure(v)) { figures.n++; return; }
  if (Array.isArray(v)) { for (const x of v) plainNumbers(x, `${at}[]`, out, figures); return; }
  for (const [k, x] of Object.entries(v)) plainNumbers(x, at ? `${at}.${k}` : k, out, figures);
}

describe("the view: every number is a Figure or named configuration", () => {
  for (const role of ["moo", "gm"] as const) {
    for (const state of PURE_STATES) {
      it(`${role}, labor ${state}`, async () => {
        const found = new Set<string>();
        const figures = { n: 0 };
        plainNumbers(businessView(withLabor(await load(role), (l) => laborIn(l, state))), "", found, figures);
        expect([...found].filter((p) => !PLAIN_NUMBERS.has(p)).sort()).toEqual([]);
        expect(figures.n).toBeGreaterThan(100);
      });
    }
  }
  it("the walker is real: a raw amount added to a view is found by its path", async () => {
    const view = businessView(await load()) as unknown as { total: { sales: Record<string, unknown> } };
    view.total.sales.totalCents = 35_000;
    const found = new Set<string>();
    plainNumbers(view, "", found, { n: 0 });
    expect([...found].filter((p) => !PLAIN_NUMBERS.has(p))).toEqual(["total.sales.totalCents"]);
  });
  it("a view without the two groups has no cost-per-person and no per-15-minute cost figure at all; a GM's default view has both", async () => {
    const gm = businessView(await load("gm", [gmOff("person_cost", "quarter_cost")])), moo = businessView(await load("moo")), byDefault = businessView(await load("gm"));
    expect(gm.people.every((p) => !("cost" in p))).toBe(true);
    expect(gm.quarters!.every((q) => !("cost" in q) && !("pct" in q))).toBe(true);
    for (const v of [moo, byDefault]) {
      expect(v.people.every((p) => "cost" in p)).toBe(true);
      expect(v.quarters!.every((q) => "cost" in q && "pct" in q)).toBe(true);
    }
  });
});

// ── 3. The surfaces name no raw amount ──────────────────────────────────────────────────────────

const COMPONENT_DIR = "components/reports-business";
const EXPORT_FILE = "lib/report-export-shared.ts";
const PDF_FILE = "lib/business-report-pdf.ts";
/** Nav PR 8 (T-B2, A8): the Dashboard strip's labor cell, the only strip file that renders a business-report figure. */
const STRIP_LABOR_FILE = "components/dashboard/StripLaborCell.tsx";
/** Digests round 3 PR 4 (plan §3.6): the digests' labor-money lines print business-report figures in an email. */
const DIGEST_LABOR_FILE = "lib/report-digests-labor-compose.ts";
const EXPORT_BEGIN = "// ── Business rows (item 9c";
const EXPORT_END = "/** `{family}_{shop-code}_{from}_{to}.{ext}`";


function surfaceOffences(): Offence[] {
  const out: Offence[] = [];
  for (const f of filesUnder(COMPONENT_DIR)) {
    out.push(...census(f, readFileSync(path.join(ROOT, f), "utf8")));
  }
  const page = "app/(authed)/reports/business/page.tsx";
  out.push(...census(page, readFileSync(path.join(ROOT, page), "utf8"), { mayLoad: true }));
  const exp = readFileSync(path.join(ROOT, EXPORT_FILE), "utf8");
  out.push(...census(EXPORT_FILE, exp, { only: between(exp, EXPORT_BEGIN, EXPORT_END) }));
  // Polish: the readable PDF is a surface too (it prints figures): the page's rules, whole file.
  out.push(...census(PDF_FILE, readFileSync(path.join(ROOT, PDF_FILE), "utf8")));
  // Nav PR 8 (T-B2): the strip's labor cell, whole file, the unchanged RULES and ALLOWED_IMPORTS.
  out.push(...census(STRIP_LABOR_FILE, readFileSync(path.join(ROOT, STRIP_LABOR_FILE), "utf8")));
  // Digests round 3 PR 4: the labor-money lines F1–F5, whole file, the unchanged RULES and ALLOWED_IMPORTS.
  out.push(...census(DIGEST_LABOR_FILE, readFileSync(path.join(ROOT, DIGEST_LABOR_FILE), "utf8")));
  return out;
}

describe("the surfaces: no raw amount, no DTO, no number formatter, no sum", () => {
  it("every file under components/reports-business, the page, and the export's business section are clean", () => {
    expect(filesUnder(COMPONENT_DIR).length).toBeGreaterThanOrEqual(2);
    expect(show(surfaceOffences())).toEqual([]);
  });
  it("the export file names the DTO nowhere, and its business section is where the row builders are", () => {
    const exp = readFileSync(path.join(ROOT, EXPORT_FILE), "utf8");
    expect(code(exp)).not.toMatch(/\bBusinessReportDto\b|from "@\/lib\/business-report"/);
    const [a, b] = between(exp, EXPORT_BEGIN, EXPORT_END);
    const section = exp.split("\n").slice(a - 1, b).join("\n");
    for (const fn of ["businessOverviewRows", "businessCompareRows", "businessHoursRows", "businessChannelRows", "businessPeopleRows", "businessCoverageRow"]) {
      expect(section, fn).toContain(`export function ${fn}(view: BusinessReportView`);
    }
    // No business row builder lives outside the censused section.
    expect(code(exp.split("\n").slice(0, a - 1).join("\n"))).not.toMatch(/\bBusinessReportView\b.*=>|function business\w+Rows/);
  });
  it("there is NO exemption: the one number formatter of the report is lib/business-figure-format.ts", () => {
    for (const f of filesUnder(COMPONENT_DIR)) expect(code(readFileSync(path.join(ROOT, f), "utf8")), f).not.toMatch(/formatCents|formatQuantity/);
    const fmt = readFileSync(path.join(ROOT, "lib/business-figure-format.ts"), "utf8");
    expect(fmt).toMatch(/export function figureFormatFor\(language: Language\): FigureFormat/);
    // It formats what the figure module hands it and reads no report type.
    expect(code(fmt)).not.toMatch(/BusinessReportDto|BusinessReportView|LaborFigures|business-view-shared|@\/lib\/business-report"/);
  });
  // The census must be able to fail: each line below is one of the leaks reviews r1-r4 found, or its cousin.
  const LEAKS: Array<[string, string]> = [
    ["<Money cents={p.straightCostCents} language={language} />", "raw cents"],
    ["sales: dto.total.sales.ezcaterCents, amount_missing: 0,", "raw cents"],
    ["const pct = l.pct === null ? null : formatQuantity(l.pct, language);", "a number formatter"],
    ["labor_hours: q.laborMinutes === null ? null : q.laborMinutes / 60,", "raw minutes"],
    ["pure_hourly_pct: purePctFigure(l).value,", "a figure's number read directly"],
    ["checks: view.days.reduce((s, d) => s + 1, 0),", "arithmetic on report values"],
    ["import type { BusinessReportDto } from \"@/lib/business-report\";", "the DTO or a raw figure type"],
    ["const why = laborReasonKey(state);", "a labor state turned into words by hand"],
    ["import { purePctFigure } from \"@/lib/business-figure-shared\";", "imports purePctFigure"],
    ["import { salesAmountMissing } from \"@/lib/business-report-shared\";", "imports salesAmountMissing"],
    ["import { loadBusinessReport } from \"@/lib/business-report\";", "imports the loader"],
  ];
  for (const [line, rule] of LEAKS) {
    it(`fails by name on: ${line}`, () => {
      const found = census("components/reports-business/Planted.tsx", `const ok = 1;\n${line}\n`);
      expect(found.length, line).toBeGreaterThan(0);
      expect(found.every((o) => o.line === 2)).toBe(true);
      expect(show(found).join("\n")).toContain(rule);
      expect(show(found)[0]).toMatch(/^components\/reports-business\/Planted\.tsx:2 {2}/);
    });
  }
  // Nav PR 8 (T-B2): a leak planted in the strip's labor cell fails by name, under the unchanged rules.
  for (const [line, rule] of [
    ["<span>{formatCents(1, language)}</span>", "a number formatter"],
    ["const shown = pick.view.loadedPct.value;", "a figure's number read directly"],
    ["const n = Number(day.date);", "arithmetic on report values"],
    ["const x = days.reduce((s, d) => s, 0);", "arithmetic on report values"],
  ] as const) {
    it(`StripLaborCell: fails by name on: ${line}`, () => {
      const src = readFileSync(path.join(ROOT, STRIP_LABOR_FILE), "utf8");
      const planted = `${src}\n${line}\n`;
      const found = show(census(STRIP_LABOR_FILE, planted));
      expect(found.length, line).toBeGreaterThan(0);
      expect(found.join("\n")).toContain(rule);
      expect(found[0]).toMatch(/^components\/dashboard\/StripLaborCell\.tsx:\d+ {2}/);
    });
  }
  // Digests round 3 PR 4: a leak planted in the digests' labor-money lines fails by name, under the unchanged rules.
  for (const [line, rule] of [
    ["const s = formatCents(b.cents, ctx.language);", "a number formatter"],
    ["const pct = `${Math.round(x)}%`;", "arithmetic on report values"],
    ["const n = view.hourly.latestFinalDay.value;", "a figure's number read directly"],
    ["import { purePctFigure } from \"@/lib/business-figure-shared\";", "imports purePctFigure"],
  ] as const) {
    it(`report-digests-labor-compose: fails by name on: ${line}`, () => {
      const src = readFileSync(path.join(ROOT, DIGEST_LABOR_FILE), "utf8");
      const found = show(census(DIGEST_LABOR_FILE, `${src}\n${line}\n`));
      expect(found.length, line).toBeGreaterThan(0);
      expect(found.join("\n")).toContain(rule);
      expect(found[0]).toMatch(/^lib\/report-digests-labor-compose\.ts:\d+ {2}/);
    });
  }
  it("a comment may talk about cents; code may not", () => {
    expect(census("x.tsx", "// straightCostCents is never read here\n/* nor totalCents */\nconst a = 1;\n")).toEqual([]);
  });
});

// ── 4. Every export row names what is not plain ─────────────────────────────────────────────────

describe("export rows: a number never travels without its state", () => {
  const NUMERIC = new Set(["money", "number", "int"]);
  /** Columns that are configuration / identity counts, not figures (the same split as PLAIN_NUMBERS). */
  const PLAIN_COLUMNS = new Set(["pure_hourly_target_pct", "fully_loaded_target_pct", "salary_gaps", "days_included", "days_in_period", "weeks_withheld"]);
  const tables = (dto: Awaited<ReturnType<typeof load>>): Array<[keyof typeof BUSINESS_EXPORT_COLUMNS, ExportRow[]]> => {
    const v = businessView(dto);
    return [["overview", businessOverviewRows(v, SHOP)], ["compare", businessCompareRows(v, v, SHOP)], ["hours", businessHoursRows(v, SHOP)],
      ["channels", businessChannelRows(v, SHOP)], ["people", businessPeopleRows(v, SHOP)]];
  };
  it("every table has the figure_notes column, and every key a row writes is a declared column", async () => {
    for (const [tab, rows] of tables(await load())) {
      const keys = new Set(BUSINESS_EXPORT_COLUMNS[tab].map((c) => c.key));
      expect(keys.has("figure_notes"), tab).toBe(true);
      for (const r of rows) for (const k of Object.keys(r)) expect(keys.has(k), `${tab}.${k}`).toBe(true);
    }
  });
  for (const state of PURE_STATES) {
    it(`labor ${state}: an empty figure cell is named unknown, and nothing is named that is plain`, async () => {
      const dto = withLabor(await load(), (l) => laborIn(l, state));
      for (const [tab, rows] of tables(dto)) {
        const figureColumns = BUSINESS_EXPORT_COLUMNS[tab].filter((c) => NUMERIC.has(c.kind) && !PLAIN_COLUMNS.has(c.key)).map((c) => c.key);
        for (const r of rows) {
          const notes = String(r.figure_notes ?? "");
          for (const c of figureColumns) {
            if (!(c in r)) continue;
            const named = new RegExp(`(^|; )${c}=(estimated|incomplete|unknown)\\(`).exec(notes)?.[2];
            if (r[c] === null) expect(named, `${tab}.${r.row_type}.${c}`).toBe("unknown");
            else expect(named === "unknown", `${tab}.${r.row_type}.${c}`).toBe(false);
          }
        }
      }
    });
  }
  it("figureCells is the row's one writer: values and notes come out of the same call", () => {
    const base = { state: "hours_unknown", minutes: 60, pureHourlyCents: 100, otPremiumCents: 0, otMinutes: 0, denominator: { cents: null, state: "ok" }, pct: null,
      tone: "none", loadedState: "hours_unknown", salariedCents: null, burdenCents: null, fullyLoadedCents: null, loadedPct: null, loadedTone: "none",
      burdenEstimated: false, salaryEstimated: false, salaryGaps: 0, wageEstimated: false, hoursUnverified: false } as never;
    const f = purePctFigure(base);
    expect(figureKindOf(f)).toBe("unknown");
    expect(figureCells({ pure_hourly_pct: f })).toEqual({ pure_hourly_pct: null, figure_notes: "pure_hourly_pct=unknown(hours_unknown)" });
    expect(figureCells({ a: undefined, b: null })).toEqual({ figure_notes: null });
  });
});
