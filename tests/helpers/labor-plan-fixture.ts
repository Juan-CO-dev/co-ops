// Board two views PR 1: ONE built labor database for the 0343 proofs and the board projection's end-to-end
// test. PGlite, the REAL parents + 0338 + 0339 + 0340 (0343 is applied by the caller, so the empty-plan
// identity can be read before and after). Synthetic rows only.
//
// Payroll week W = Sun 2026-10-04 .. Sat 2026-10-10 (board week Mon 2026-10-05 .. Sun 2026-10-11), every day
// covered by a 7shifts ledger run. Shop A: Alice $20/h works Mon-Thu 10 h and Fri 8 h (48 h, 8 h overtime on
// Friday); Bob $30/h works Mon 6 h; an account with no wage works Mon 1 h. Shop B: Alice's other account,
// $22/h, Tue 5 h. The GM is salaried ($1,400 a week) on shop A's payroll.
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { buildLaborWeek, laborWeekSourceFromJson } from "@/lib/facts/labor-week-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { M0338, M0339, M0340, freshLaborParents } from "./fact-0338-parents";

export const A = "00000000-0000-4000-8000-0000000000aa", B = "00000000-0000-4000-8000-0000000000bb";
export const MGR = "00000000-0000-4000-8000-0000000000f1", ALICE = "00000000-0000-4000-8000-0000000000f2";
export const BOB = "00000000-0000-4000-8000-0000000000f3", GMU = "00000000-0000-4000-8000-0000000000f4";
export const W = "2026-10-04", W2 = "2026-10-11";
/** A payroll week nothing has built or could build yet (a Sunday far in the future). */
export const FUTURE_W = "2099-01-04";

export interface LaborPlanDb {
  db: PGlite;
  q: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;
  build: (week: string) => Promise<void>;
  wage: (user: number, cents: number, type?: string, effective?: string) => Promise<void>;
  punch: (user: number, loc7: number, date: string, from: string, to: string) => Promise<void>;
}

export async function laborPlanDb(): Promise<LaborPlanDb> {
  const db = await freshLaborParents();
  await db.exec(M0338); await db.exec(M0339); await db.exec(M0340);
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
  const etIso = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-04:00`).toISOString();
  let pid = 9000;
  const punch = async (user: number, loc7: number, date: string, from: string, to: string) => {
    await q("insert into sevenshifts_time_punches(id, user_id, location_id, clocked_in, clocked_out, break_minutes) values($1,$2,$3,$4,$5,0)",
      [++pid, user, loc7, etIso(date, from), etIso(date, to)]);
  };
  const wage = async (user: number, cents: number, type = "hourly", effective = "2026-01-01") => {
    const run = randomUUID();
    await q("insert into sevenshifts_sync_run_ids(id, trigger) values($1, 'cron')", [run]);
    await q("select reconcile_sevenshifts_user_snapshot($1, $2, 'wages', true, $3::jsonb)", [run, user,
      JSON.stringify([{ user_id: String(user), wage_id: String(user * 10), upcoming: false, effective_date: effective, wage_type: type, wage_cents: cents, role_id: null }])]);
  };
  const build = async (week: string) => {
    const j = (await q<{ s: Record<string, unknown> }>("select fact_labor_week_source($1, $2) s", [week, LABOR_BUILDER_VERSION]))[0]!.s;
    const { source, fingerprint } = laborWeekSourceFromJson(j);
    const p = buildLaborWeek(source);
    await q("select fact_replace_labor_week($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb)", [week, LABOR_BUILDER_VERSION, fingerprint,
      JSON.stringify(p.quarters), JSON.stringify(p.days), JSON.stringify(p.week), JSON.stringify(p.salaried)]);
  };

  await q("insert into locations(id) values($1),($2)", [A, B]);
  await q("insert into users(id, role) values($1,'moo'),($2,'employee'),($3,'employee'),($4,'gm')", [MGR, ALICE, BOB, GMU]);
  await q("insert into sevenshifts_location_links(location_id, sevenshifts_location_id, linked_by) values($1, 501, $3), ($2, 502, $3)", [A, B, MGR]);
  for (const id of [7, 8, 9, 12, 20]) await q("insert into sevenshifts_users(id, company_id, first_name, active) values($1, 1, 'X', true)", [id]);
  await q(`insert into sevenshifts_user_links(sevenshifts_user_id, user_id, linked_at_location_id, linked_by)
           values(7, $1, $4, $6), (8, $1, $5, $6), (12, $2, $4, $6), (20, $3, $4, $6)`, [ALICE, BOB, GMU, A, B, MGR]);
  const run = randomUUID();
  await q("insert into sevenshifts_sync_run_ids(id, trigger, started_at) values($1, 'cron', '2026-10-20T12:00:00Z')", [run]);
  await q("insert into sevenshifts_sync_runs(id, trigger, started_at, finished_at, status, requests, results) values($1,'cron','2026-10-20T12:00:00Z','2026-10-20T12:00:00Z','ok',1,$2::jsonb)",
    [run, JSON.stringify({ time_punches: { rows: 1, skipped: 0, pages: 1, error_code: null } })]);
  await wage(7, 2000); await wage(8, 2200); await wage(12, 3000); await wage(20, 140000, "weekly_salary");
  await q("select save_labor_payroll_shop($1, 20, $2, 'shop', '2026-07-19', 'fixture: shop A payroll', null)", [MGR, A]);
  for (const d of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]) await punch(7, 501, d, "06:00", "16:00");
  await punch(7, 501, "2026-10-09", "06:00", "14:00");
  await punch(12, 501, "2026-10-05", "10:00", "16:00");
  await punch(9, 501, "2026-10-05", "10:00", "11:00");
  await punch(8, 502, "2026-10-06", "17:00", "22:00");
  await build(W); await build(W2);
  return { db, q, build, wage, punch };
}
