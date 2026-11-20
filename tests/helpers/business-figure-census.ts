// The census machinery of tests/business-report-figure-census.test.ts (moved here in fix round 9 so other
// rounds can plant a leak and see it fail by name, without re-registering that file's tests).
import { readdirSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(__dirname, "../..");
export function filesUnder(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : []);
}
/** Comments removed, line numbers kept (a comment may talk about cents; code may not). */
export function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`])\/\/.*$/gm, (m, p: string) => p + " ".repeat(m.length - p.length));
}
/** [first, last] line (1-based) between two markers, or the whole file. */
export function between(src: string, begin: string, end: string): [number, number] {
  const a = src.indexOf(begin), b = src.indexOf(end);
  if (a < 0 || b < a) throw new Error(`census marker missing: ${begin} … ${end}`);
  return [src.slice(0, a).split("\n").length, src.slice(0, b).split("\n").length];
}

/** What a surface may never write. The name is what the failure prints. */
export const RULES: Array<{ name: string; re: RegExp; except?: readonly string[] }> = [
  // Fix round 9 (ITEM9B-r9): a figure's value WITHOUT its reason and qualifications. The figure module exports none;
  // a helper of that shape defined or imported anywhere on a surface fails here by name.
  { name: "a value-only figure accessor (drops the reason and qualifications)", re: /\b(figureValueText|figureValueWords|valueWords|figureValue|figureNumber)\b/ },
  // The display parts (words / reason / notes) are read only by the page's ONE formatter, which renders all three.
  { name: "a figure display outside the page's one formatter", re: /\bfigureDisplay\b|\.words\b/, except: ["components/reports-business/BusinessParts.tsx"] },
  { name: "raw cents (a *Cents / *_cents / cents identifier)", re: /\b[A-Za-z_]*[cC]ents\b/ },
  { name: "raw minutes (a *Minutes identifier or .minutes)", re: /\b[A-Za-z_]*Minutes\b|\.minutes\b/ },
  { name: "a figure's number read directly (.value)", re: /\.value\b/ },
  { name: "the DTO or a raw figure type", re: /\b(BusinessReportDto|BusinessDayDto|BusinessWeekDto|BusinessQuarterDto|BusinessPersonDto|BusinessUnassignedDto|LaborFigures|DaySales|CutTotal|LaborCostRow)\b/ },
  { name: "a number formatter (only the figure formatter may format)", re: /\b(formatCents|formatQuantity|formatNumber|centsToDollars|toFixed|toLocaleString|toPrecision)\b|Intl\.NumberFormat/ },
  { name: "arithmetic on report values (a sum, Math, Number())", re: /\.reduce\(|\bMath\.|\bNumber\(|\bparseFloat\(|\bparseInt\(/ },
  { name: "a labor state turned into words by hand", re: /\b(laborReasonKey|loadedReasonKey|loadedQualifiers|laborHoursComplete|salesAmountMissing|breakdownCoverage|sumBusinessDays|compareChange)\b/ },
];
/** What a surface may import from the report's modules. Anything else fails by name. */
export const ALLOWED_IMPORTS: Record<string, readonly string[]> = {
  "@/lib/business-figure-shared": ["Figure", "FigureFormat", "figureChange", "figureKindOf", "figureReasonOf", "figureDisplay", "figureText",
    "figureCells", "FIGURE_NOTES_COLUMN",
    // Fix round 7: an empty list's claim (a kind and reason keys, never a number) and its cell for a file.
    "EmptyClaim", "emptyClaimNote"],
  // Polish: the per-scope legend (marks + sentences, never a number).
  "@/lib/business-figure-format": ["figureFormatFor", "changeWords", "figureLegend", "FigureLegend", "LegendEntry"],
  "@/lib/business-view-shared": ["businessView", "BusinessReportView", "CutView", "DayView", "LaborView", "QuarterView", "SalesView", "WeekView", "PersonView", "RushWindowView", "HourView"],
  "@/lib/business-report-shared": ["BUSINESS_RANGES", "BUSINESS_REPORT_TABS", "BusinessRange", "BusinessReportTab", "CompareChange", "businessReportEnabled", "businessReportRefusal", "businessTab",
    // Fix round 6: the ONE parse of the raw range query (date strings, never a figure): form, links, exports.
    "parseBusinessRangeRequest", "BusinessRangeRequest", "BusinessRangeEmptyReason"],
  // Only the page loads; it hands the DTO straight to businessView.
  "@/lib/business-report": ["BusinessReportError", "loadBusinessReport", "resolveBusinessRange",
    // Business report access: what the viewer may see (booleans) and the tab / download check on the loaded report.
    "resolveBusinessAccess", "assertBusinessSurface"],
};

export interface Offence { file: string; line: number; rule: string; text: string }
export function census(file: string, src: string, opts: { only?: [number, number]; mayLoad?: boolean } = {}): Offence[] {
  const out: Offence[] = [];
  const lines = code(src).split("\n");
  const inRange = (n: number, r?: [number, number]) => r !== undefined && n >= r[0] && n <= r[1];
  lines.forEach((text, i) => {
    const n = i + 1;
    if (opts.only && !inRange(n, opts.only)) return;
    for (const r of RULES) if (!r.except?.includes(file) && r.re.test(text)) out.push({ file, line: n, rule: r.name, text: text.trim().slice(0, 140) });
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
export const show = (o: readonly Offence[]) => o.map((x) => `${x.file}:${x.line}  ${x.rule}  →  ${x.text}`);
export function censusOf(file: string, src: string, opts: { only?: [number, number]; mayLoad?: boolean } = {}): string[] { return show(census(file, src, opts)); }
