/**
 * Item 21 PR 0 (plan r3, carried from r2 F3): the consumer census for catering PIPELINE VALUE.
 *
 * Pipeline value (the live accepted quote's total, else the lead's estimated revenue — 0195 / 0232
 * `sales_report_catering_values`) is an INTENT figure. It is never Toast sales. The portal ↔ Toast
 * work (item 21) leaves it unchanged and only LABELS how much of it is also rung in Toast, so a
 * reporting correction is owed only if some module ADDS pipeline value to a Toast or classified
 * sales figure. This census proves none does today, and fails the day one starts:
 *
 *  1. CLOSED LIST: every module that reads a pipeline-value source is listed here with its
 *     adjudication. A new reader fails until someone decides what it does with the number.
 *  2. NO SUM: no line anywhere in lib/, app/ or components/ adds a pipeline-value identifier to a
 *     sales identifier. A list (`[a, b]`) is not a sum; `+` and `+=` are.
 *
 * If (2) ever fails for a real reason, that consumer is fixed in its own PR with this failure as
 * the proof (plan r3 PR 5). Nothing in PRs 0–2 changes a pipeline-value number.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOTS = ["lib", "app", "components"];

/** The sources of pipeline value: the 0195/0232 reads, their JSON keys, the lead's own estimate. */
const SOURCE = /sales_report_catering_values|catering_insights_v2|completed_value_cents|confirmed_value_cents|estimated_revenue_cents|estimatedRevenueCents|catering_pipeline_reconciliation/;

/** Every module that touches a pipeline-value source, and what it does with it. */
const CENSUS: Record<string, string> = {
  "app/(authed)/reports/sales/catering/page.tsx": "label: item 21's \"of this, $X is also rung in Toast\" line under block 3 (the unchanged total, partitioned)",
  "app/(authed)/catering/insights/page.tsx": "display: the 0194 insights page (comment + render), never beside Toast sales",
  "app/api/catering/pipeline/[id]/route.ts": "writer: a manager edits the lead's estimate",
  "app/api/catering/pipeline/route.ts": "writer: a manager creates a lead with an estimate",
  "components/catering/pipeline/PipelineClient.tsx": "display: the lead card's estimate",
  "lib/catering/booked-events.ts": "valuation: booked events (0195 rule), shown as catering value",
  "lib/dashboard-blocks-shared.ts": "valuation: the Dashboard strip's catering cell (nav PR 8, A2): the booked-events rule without its ?? 0, pipeline orders only, estimates and missing prices named; its own cell, never added to a Toast sales figure",
  "lib/catering/catering-toast.ts": "label: reads catering_pipeline_reconciliation, the partition of the unchanged total",
  "lib/catering/insights.ts": "valuation: catering_insights_v2, its own page",
  "lib/catering/pipeline.ts": "writer/reader: the lead row itself",
  "lib/catering/toast-catering-scan.ts": "writer: a Toast-origin lead's estimate = its Toast order total",
  "lib/marketing/scorecard.ts": "valuation: the scorecard's separate `pipeline` metric (never in classifiedCents)",
  "lib/report-digests-compose.ts": "valuation: the digest's catering block (0195 rule), its own line",
  "lib/report-digests.ts": "valuation: the digest's catering block (0195 rule), its own line",
  "lib/report-package-shared.ts": "valuation: the report package's catering section",
  "lib/report-package.ts": "valuation: the report package's catering section read",
  "lib/sales-reports-shared.ts": "valuation: mergeCateringValues, block 3 of the Sales catering page",
  "lib/sales-reports.ts": "valuation: loadSalesCatering's pipeline block (block 3), separate from toastCatering",
  "lib/toast/catering-orders-shared.ts": "writer: maps a Toast catering order's total to the lead estimate",
};

/** Pipeline-value identifiers (after reading) and sales identifiers that must never be summed. */
const VALUE_ID = /\b(valueCents|value_cents|completedCents|confirmedCents|completed_value_cents|confirmed_value_cents|estimatedRevenueCents|estimated_revenue_cents)\b|pipeline\.cents/;
const SALES_ID = /\b(classifiedCents|toastNetCents|netCents|net_cents|netSalesCents|salesCents|grossCents|gross_cents|directCents|toastTotal|toastCents|toast_cents|checkCents)\b/;
const SUM = /[^+]\+(?!\+)|\+=/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.replace(/\\/g, "/"));
  }
  return out;
}
const files = ROOTS.flatMap((root) => walk(root));
const text = (path: string) => readFileSync(path, "utf8");

/** A line is a forbidden sum when it adds value to sales. */
function addsValueToSales(line: string): boolean {
  const code = line.replace(/\/\/.*$/, "").replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
  return VALUE_ID.test(code) && SALES_ID.test(code) && SUM.test(code);
}

describe("pipeline value consumer census", () => {
  it("every module that reads a pipeline-value source is adjudicated, and no listed module vanished", () => {
    const readers = files.filter((path) => SOURCE.test(text(path))).sort();
    expect(readers).toEqual(Object.keys(CENSUS).sort());
  }, 120_000);

  it("no line adds a pipeline-value figure to a Toast or classified sales figure", () => {
    const offenders: string[] = [];
    for (const path of files) {
      text(path).split(/\r?\n/).forEach((line, i) => { if (addsValueToSales(line)) offenders.push(`${path}:${i + 1}: ${line.trim()}`); });
    }
    expect(offenders).toEqual([]);
  }, 120_000);

  it("the guard is not vacuous: it flags a sum and lets a list through", () => {
    expect(addsValueToSales("const all = d.completedCents + data.classifiedCents;")).toBe(true);
    expect(addsValueToSales("total += row.valueCents; // with toastTotal")).toBe(false);
    expect(addsValueToSales("x.toastTotal += lead.valueCents;")).toBe(true);
    expect(addsValueToSales("const money = [s.classifiedCents, s.pipeline.cents];")).toBe(false);
    expect(addsValueToSales("i++; const a = valueCents; const b = toastTotal;")).toBe(false);
  });
});
