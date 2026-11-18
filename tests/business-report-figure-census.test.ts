// Item 9b fix round 4 (review ITEM9B-r4): THE CENSUS. Four review rounds found one class in a new place each time —
// a figure that is estimated, provisional or unknown shown as a plain number — because a surface could reach a raw
// amount and format it itself. This file makes that impossible to do quietly:
//
//   1. TYPES    a `Figure` is opaque: its number is not readable (compile errors below, checked by tsc).
//   2. VIEW     the view the surfaces receive (lib/business-view-shared.ts) holds no plain money / percent / hours /
//               count: every number leaf of a real view is either inside a Figure or on the short allowlist of
//               configuration and identity (targets, the rush rule, how many days a list covers).
//   3. SOURCE   the surfaces — every file under components/reports-business, the page, and the business section of
//               lib/report-export-shared.ts — never name a raw amount, a DTO type, a number formatter or a sum. Each
//               offence is reported BY NAME (file:line, the rule, the text).
//   4. ROWS     every export row that carries a number names, in `figure_notes`, each figure that is not plain.
import { readdirSync, readFileSync } from "node:fs";
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
import { A, fakeClient } from "./helpers/business-report-fake";
import { PURE_STATES, laborIn, withLabor } from "./helpers/business-report-states";

const ROOT = path.resolve(__dirname, "..");
const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const SHOP = { id: A, code: "MEP", name: "Capitol Hill" };
const range = resolveBusinessRange({ range: "custom", from: "2026-10-01", to: "2026-10-07" }, "2026-10-08");
const viewer = (role: "moo" | "gm") => ({ userId: `u-${role}`, level: role === "moo" ? 8 : 7, role, locations: role === "gm" ? [A] : [] as string[] });
const load = (role: "moo" | "gm" = "moo") => loadBusinessReport(viewer(role), { locationId: A, range }, { client: fakeClient().client, env: ON });

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
  "quarters[].wallQuarter", "days[].quarters[].wallQuarter",
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
  it("a GM's view has no cost-per-person and no per-15-minute cost figure at all", async () => {
    const gm = businessView(await load("gm")), moo = businessView(await load("moo"));
    expect(gm.people.every((p) => !("cost" in p))).toBe(true);
    expect(gm.quarters!.every((q) => !("cost" in q) && !("pct" in q))).toBe(true);
    expect(moo.people.every((p) => "cost" in p)).toBe(true);
    expect(moo.quarters!.every((q) => "cost" in q && "pct" in q)).toBe(true);
  });
});

// ── 3. The surfaces name no raw amount ──────────────────────────────────────────────────────────

const COMPONENT_DIR = "components/reports-business";
const EXPORT_FILE = "lib/report-export-shared.ts";
const EXPORT_BEGIN = "// ── Business rows (item 9c";
const EXPORT_END = "/** `{family}_{shop-code}_{from}_{to}.{ext}`";

function filesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}
/** Comments removed, line numbers kept (a comment may talk about cents; code may not). */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, (m, p: string) => p + " ".repeat(m.length - p.length));
}
/** [first, last] line (1-based) between two markers, or the whole file. */
function between(src: string, begin: string, end: string): [number, number] {
  const a = src.indexOf(begin), b = src.indexOf(end);
  if (a < 0 || b < a) throw new Error(`census marker missing: ${begin} … ${end}`);
  return [src.slice(0, a).split("\n").length, src.slice(0, b).split("\n").length];
}

/** What a surface may never write. The name is what the failure prints. */
const RULES: Array<{ name: string; re: RegExp }> = [
  { name: "raw cents (a *Cents / *_cents / cents identifier)", re: /\b[A-Za-z_]*[cC]ents\b/ },
  { name: "raw minutes (a *Minutes identifier or .minutes)", re: /\b[A-Za-z_]*Minutes\b|\.minutes\b/ },
  { name: "a figure's number read directly (.value)", re: /\.value\b/ },
  { name: "the DTO or a raw figure type", re: /\b(BusinessReportDto|BusinessDayDto|BusinessWeekDto|BusinessQuarterDto|BusinessPersonDto|BusinessUnassignedDto|LaborFigures|DaySales|CutTotal|LaborCostRow)\b/ },
  { name: "a number formatter (only the figure formatter may format)", re: /\b(formatCents|formatQuantity|formatNumber|centsToDollars|toFixed|toLocaleString|toPrecision)\b|Intl\.NumberFormat/ },
  { name: "arithmetic on report values (a sum, Math, Number())", re: /\.reduce\(|\bMath\.|\bNumber\(|\bparseFloat\(|\bparseInt\(/ },
  { name: "a labor state turned into words by hand", re: /\b(laborReasonKey|loadedReasonKey|loadedQualifiers|laborHoursComplete|salesAmountMissing|breakdownCoverage|sumBusinessDays|compareChange)\b/ },
];
/** What a surface may import from the report's modules. Anything else fails by name. */
const ALLOWED_IMPORTS: Record<string, readonly string[]> = {
  "@/lib/business-figure-shared": ["Figure", "FigureFormat", "figureChange", "figureKindOf", "figureReasonOf", "figureDisplay", "figureText", "figureValueText",
    "figureCells", "FIGURE_NOTES_COLUMN"],
  "@/lib/business-figure-format": ["figureFormatFor", "changeWords"],
  "@/lib/business-view-shared": ["businessView", "BusinessReportView", "CutView", "DayView", "LaborView", "QuarterView", "SalesView", "WeekView", "PersonView", "RushWindowView"],
  "@/lib/business-report-shared": ["BUSINESS_RANGES", "BUSINESS_REPORT_TABS", "BusinessRange", "BusinessReportTab", "CompareChange", "businessReportEnabled", "businessReportRefusal", "businessTab",
    // Fix round 5: the range's URL query (date strings, never a figure): every link re-resolves to the same range.
    "businessRangeQuery"],
  // Only the page loads; it hands the DTO straight to businessView.
  "@/lib/business-report": ["BusinessReportError", "loadBusinessReport", "resolveBusinessRange"],
};

interface Offence { file: string; line: number; rule: string; text: string }
function census(file: string, src: string, opts: { only?: [number, number]; mayLoad?: boolean } = {}): Offence[] {
  const out: Offence[] = [];
  const lines = code(src).split("\n");
  const inRange = (n: number, r?: [number, number]) => r !== undefined && n >= r[0] && n <= r[1];
  lines.forEach((text, i) => {
    const n = i + 1;
    if (opts.only && !inRange(n, opts.only)) return;
    for (const r of RULES) if (r.re.test(text)) out.push({ file, line: n, rule: r.name, text: text.trim().slice(0, 140) });
  });
  for (const m of code(src).matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    const allowed = ALLOWED_IMPORTS[m[2]!];
    if (!allowed) continue;
    const line = src.slice(0, src.indexOf(m[0])).split("\n").length;
    if (m[2] === "@/lib/business-report" && !opts.mayLoad) out.push({ file, line, rule: "imports the loader / DTO module", text: m[0].slice(0, 140) });
    for (const raw of m[1]!.split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (name && !allowed.includes(name)) out.push({ file, line, rule: `imports ${name} from ${m[2]} (not on the surface allowlist)`, text: m[0].slice(0, 140) });
    }
  }
  return out;
}
const show = (o: readonly Offence[]) => o.map((x) => `${x.file}:${x.line}  ${x.rule}  →  ${x.text}`);

function surfaceOffences(): Offence[] {
  const out: Offence[] = [];
  for (const f of filesUnder(COMPONENT_DIR)) {
    out.push(...census(f, readFileSync(path.join(ROOT, f), "utf8")));
  }
  const page = "app/(authed)/reports/business/page.tsx";
  out.push(...census(page, readFileSync(path.join(ROOT, page), "utf8"), { mayLoad: true }));
  const exp = readFileSync(path.join(ROOT, EXPORT_FILE), "utf8");
  out.push(...census(EXPORT_FILE, exp, { only: between(exp, EXPORT_BEGIN, EXPORT_END) }));
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
