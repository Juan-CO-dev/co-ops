/** Item 4 PR 1: the demand replay report for Juan. READ-ONLY: it reads history, replays the three baselines
 * (pars, labor, prep) and the two zero-feed candidates (trend, calendar holidays) through the replay harness,
 * and writes ONE local Markdown file. It writes nothing to the database, claims no holdout and calls no
 * outside service. Everything it scores is retrospective (E1): today's copy of old data.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/demand-replay-report.ts \
 *     --from=2026-09-01 --to=2026-11-10 --out=demand-replay-report.md [--surfaces=labor,pars,prep]
 *
 * (`--conditions=react-server` lets the lib's `server-only` imports load outside Next.) `from` / `to` are
 * DECISION dates. One night of pars is a full engine load, so a long range takes minutes: start with labor.
 * Exit 0 = the file was written; 2 = bad usage / no env / a read failed (nothing is written then). */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const SURFACES = ["labor", "pars", "prep"] as const;
type Surface = (typeof SURFACES)[number];
export const MAX_RANGE_DAYS = 120;
const isDate = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const addDays = (ymd: string, n: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function parseArgs(argv: string[]): { from: string; to: string; out: string; surfaces: Surface[] } | null {
  let from: string | null = null, to: string | null = null, out: string | null = null, surfaces: Surface[] = [...SURFACES];
  for (const a of argv) {
    const f = /^--from=(.+)$/.exec(a), t = /^--to=(.+)$/.exec(a), o = /^--out=(.+\.md)$/.exec(a), s = /^--surfaces=(.+)$/.exec(a);
    if (f) from = f[1]!; else if (t) to = t[1]!; else if (o) out = o[1]!;
    else if (s) {
      const list = s[1]!.split(",");
      if (list.length === 0 || list.some((x) => !(SURFACES as readonly string[]).includes(x)) || new Set(list).size !== list.length) return null;
      surfaces = list as Surface[];
    } else return null;
  }
  if (!from || !to || !out || !isDate(from) || !isDate(to) || to < from || daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return null;
  return { from, to, out, surfaces };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (!args) { console.error(`usage: demand-replay-report.ts --from=YYYY-MM-DD --to=YYYY-MM-DD --out=FILE.md [--surfaces=labor,pars,prep] (at most ${MAX_RANGE_DAYS} days)`); return 2; }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) { console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing was read."); return 2; }
  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { etCalendarDate } = await import("../lib/operational-day");
  const { loadLaborDay, loadLaborInputs, loadPrepInputs } = await import("../lib/demand-signals/ledger");
  const { laborTargetFromDay, parTargetFromInputs, LABOR_LEADS } = await import("../lib/demand-signals/replay");
  const { runBacktest } = await import("../lib/demand-signals/backtest");
  const { renderReplayReport } = await import("../lib/demand-signals/report-shared");
  const yesterday = addDays(etCalendarDate(new Date().toISOString()), -1);
  if (args.to > yesterday) { console.error(`--to must be ${yesterday} or earlier: a decision needs at least one realized day behind it.`); return 2; }

  const shops = await sb.from("locations").select("id, name").eq("active", true).not("toast_restaurant_guid", "is", null).order("name", { ascending: true });
  if (shops.error) { console.error("demand_report_read_failed: locations"); return 2; }
  const history: Array<import("../lib/demand-signals/backtest").ShopHistory> = [];
  try {
    for (const shop of (shops.data ?? []) as Array<{ id: string; name: string }>) {
      // ── Labor: one build day per decision date, and every realized day the candidates and the scores read.
      const laborDays: Awaited<ReturnType<typeof loadLaborInputs>>[] = [];
      const laborActual = new Map<string, ReturnType<typeof laborTargetFromDay>>();
      if (args.surfaces.includes("labor")) {
        for (let d = args.from; d <= args.to; d = addDays(d, 1)) laborDays.push(await loadLaborInputs(sb, shop.id, d));
        const last = addDays(args.to, LABOR_LEADS[LABOR_LEADS.length - 1]!);
        for (let d = addDays(args.from, -14); d <= (last < yesterday ? last : yesterday); d = addDays(d, 1)) {
          const day = await loadLaborDay(sb, shop.id, d);
          laborActual.set(d, laborTargetFromDay(shop.id, d, day.heat, day.capturedDays));
        }
        console.error(`${shop.name}: labor ${laborDays.length} build days, ${laborActual.size} realized days`);
      }
      // ── Pars: the engine's own loader, one night per decision. A date's realized ounces are read from the
      //    LATEST loaded night whose window holds it (the reading closest to today's copy).
      const parNights: Awaited<ReturnType<typeof import("../lib/dynamic-pars").loadDemandInputs>>[] = [];
      let lastNight: (typeof parNights)[number] | null = null;
      if (args.surfaces.includes("pars")) {
        const { loadDemandInputs } = await import("../lib/dynamic-pars");
        for (let d = addDays(args.from, -1); d <= addDays(args.to, -1); d = addDays(d, 1)) parNights.push(await loadDemandInputs(sb as never, shop.id, d));
        const tail = addDays(args.to, 13) < yesterday ? addDays(args.to, 13) : yesterday;
        lastNight = await loadDemandInputs(sb as never, shop.id, tail);
        console.error(`${shop.name}: pars ${parNights.length} nights`);
      }
      const prepDays = args.surfaces.includes("prep") ? [{ decisionDate: args.to, inputs: await loadPrepInputs(sb, shop.id) }] : [];
      const parSources = lastNight ? [lastNight, ...parNights.slice().reverse()] : [];
      history.push({
        shopId: shop.id, shopName: shop.name, parNights, laborDays, prepDays,
        parTargets: (date) => {
          for (const night of parSources) { const t = parTargetFromInputs(night, date); if (t !== null) return t.coverage === "covered" ? t.payload! : "not_covered"; }
          return undefined;
        },
        laborTargets: (date) => { const t = laborActual.get(date); return t === undefined ? undefined : t.coverage === "covered" ? t.payload! : "not_covered"; },
        // No reviewed reading of a prep item's use per day exists yet: prep is recorded, not scored.
        prepTargets: () => undefined,
      });
    }
  } catch { console.error("demand_report_read_failed: a history read failed (are the scheduling and sales reads installed?). Nothing was written."); return 2; }

  const report = runBacktest(history, { from: args.from, to: args.to });
  writeFileSync(args.out, renderReplayReport(report), "utf8");
  console.log(JSON.stringify({ out: args.out, evidence: report.evidenceClass, shops: report.shops.length, ...report.counts,
    baseline_scopes: report.baselines.length, candidate_scopes: report.candidates.length }, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => { process.exitCode = code; }, () => { console.error("demand-replay-report failed"); process.exitCode = 2; });
}
