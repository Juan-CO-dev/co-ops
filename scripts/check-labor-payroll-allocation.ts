/** Item 2, salaried cost to the payroll shop: the RECONCILIATION + CENSUS check (plan r2 §5, Astra r2 P1). READ-ONLY.
 *   npx tsx --env-file=.env.local scripts/check-labor-payroll-allocation.ts [--allow-gaps]
 * 1. Gate: zero stale labor weeks for the current builder version (fact_labor_weeks_stale; the fingerprint holds
 *    the version AND every payroll-shop row, so zero stale proves every built week is current). Exit 3 otherwise.
 * 2. Census: EVERY 7shifts account in the mirror (lib/facts/labor-payroll-read.ts, the card's own read). An
 *    account with no wage and no decision, a salaried account with no payroll shop, an assignee with no salary, a
 *    shop not linked any more, and a payroll-roster manager with no 7shifts account are printed, by account id.
 * 3. Every built week: re-read its source, re-run allocateSalaried, compare with labor_week_salaried (exit 1 on
 *    any difference) and print every account behind a stored gap.
 * Exit 4 when any gap remains, unless --allow-gaps. Exit 2 on a usage or read failure. Script-local client; never
 * imports lib/supabase-server. Writes nothing. */
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { LABOR_BUILDER_VERSION } from "../lib/facts/labor-config-shared";
import { laborWeekSourceFromJson } from "../lib/facts/labor-week-shared";
import { allocateSalaried, type LaborSalariedRow } from "../lib/facts/labor-payroll-shared";
import { readPayrollCensus } from "../lib/facts/labor-payroll-read";

export function parseArgs(argv: readonly string[]): { allowGaps: boolean } | null {
  if (argv.some((a) => a !== "--allow-gaps")) return null;
  return { allowGaps: argv.includes("--allow-gaps") };
}

type StoredRow = { location_id: string; salaried_cents: number | string | null; salaried_people: number; unplaced_people: number; missing_wage_people: number };
/** The stored rows against a fresh allocation, as printable differences (empty = equal). */
export function compareSalaried(stored: readonly StoredRow[], fresh: readonly LaborSalariedRow[]): string[] {
  const key = (r: { location_id: string; salaried_cents: number | string | null; salaried_people: number; unplaced_people: number; missing_wage_people: number }) =>
    `${r.location_id} cents=${r.salaried_cents === null ? "null" : Number(r.salaried_cents)} people=${Number(r.salaried_people)} unplaced=${Number(r.unplaced_people)} missing=${Number(r.missing_wage_people)}`;
  const a = stored.map(key).sort(), b = fresh.map(key).sort();
  const out: string[] = [];
  for (const s of a) if (!b.includes(s)) out.push(`stored ${s}`);
  for (const s of b) if (!a.includes(s)) out.push(`fresh  ${s}`);
  return out;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (!args) { console.error("usage: check-labor-payroll-allocation.ts [--allow-gaps]"); return 2; }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) { console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. Nothing was read."); return 2; }
  const sb: SupabaseClient = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  const stale = await sb.rpc("fact_labor_weeks_stale", { p_limit: 1000, p_builder_version: LABOR_BUILDER_VERSION });
  if (stale.error || !Array.isArray(stale.data)) { console.error("fact_labor_weeks_stale failed (is 0340 applied?)"); return 2; }
  if (stale.data.length > 0) {
    console.error(`${stale.data.length} labor week(s) stale for ${LABOR_BUILDER_VERSION}: let the fact-build passes run (or wait a pass) first.`);
    return 3;
  }

  let gaps = 0;
  let read;
  try { read = await readPayrollCensus(sb); } catch { console.error("census read failed (is 0340 applied?)"); return 2; }
  const { census, shops } = read;
  const shopName = (id: string | null) => shops.find((s) => s.id === id)?.name ?? id ?? "-";
  console.log(`census as of ${census.weekStart}: ${census.rows.length} account(s) listed, ${census.hourlyHidden} hourly account(s) with nothing to decide`);
  for (const r of census.rows) {
    const line = `  account ${r.account} (7shifts ID ${r.employeeId ?? "-"}, ${r.active ? "active" : "inactive"}): ${r.chip}${r.locationId ? ` @ ${shopName(r.locationId)}` : ""}`
      + `${r.linkedUsers.length ? ` linked: ${r.linkedUsers.map((u) => `${u.name} (${u.role})`).join(", ")}` : ""}`
      + `${r.gapWeeks.length ? ` gap weeks: ${r.gapWeeks.length} (${r.gapWeeks[0]} .. ${r.gapWeeks[r.gapWeeks.length - 1]})` : ""}`;
    if (r.gap) { gaps++; console.log(`GAP${line}`); } else console.log(`ok ${line}`);
  }
  for (const u of census.rosterNoAccount) { gaps++; console.log(`GAP  payroll-roster ${u.role} ${u.name} (${u.id}) has no linked 7shifts account`); }

  const weeks = await sb.from("labor_week_coverage").select("week_start").eq("builder_version", LABOR_BUILDER_VERSION).order("week_start");
  if (weeks.error) { console.error("labor_week_coverage read failed"); return 2; }
  let differences = 0;
  for (const { week_start } of (weeks.data ?? []) as { week_start: string }[]) {
    const week = String(week_start).slice(0, 10);
    const src = await sb.rpc("fact_labor_week_source", { p_week_start: week, p_builder_version: LABOR_BUILDER_VERSION });
    const stored = await sb.from("labor_week_salaried").select("location_id, salaried_cents, salaried_people, unplaced_people, missing_wage_people").eq("week_start", week);
    if (src.error || !src.data || stored.error) { console.error(`read failed for week ${week}`); return 2; }
    const { source } = laborWeekSourceFromJson(src.data as Record<string, unknown>);
    const storedShops = [...new Set(source.days.filter((d) => d.linked).map((d) => d.location_id))];
    const fresh = allocateSalaried({ weekStart: week, storedShops, payrollShops: source.payrollShops, wages: source.wages });
    const diff = compareSalaried((stored.data ?? []) as StoredRow[], fresh.rows);
    if (diff.length) { differences++; console.log(`DIFF week ${week}`); for (const d of diff) console.log(`  ${d}`); }
    const behind = fresh.accounts.filter((a) => a.state !== "placed" && a.state !== "excluded");
    if (behind.length) {
      gaps++;
      console.log(`GAP week ${week}: ${behind.map((a) => `account ${a.account} ${a.state}${a.location_id ? ` @ ${shopName(a.location_id)}` : ""}`).join("; ")}`);
    }
  }
  console.log(`${(weeks.data ?? []).length} built week(s) checked; ${differences} with differences; ${gaps} gap line(s).`);
  if (differences > 0) return 1;
  if (gaps > 0 && !args.allowGaps) return 4;
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); });
}
