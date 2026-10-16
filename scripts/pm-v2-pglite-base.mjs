/**
 * The PM v2 PGlite base — SYNTHETIC, in memory. Used by scripts/sql-harness-0271.mjs and the PM v2 loader
 * schema check. Applied ON TOP of tests/fixtures/scheduling-pglite-stub.sql, it builds the REAL PM tables
 * the way production has them:
 *   the real 0072 + 0073 (pm_reports, pm_employee_evals), the 0106 deny policy on pm_reports, Supabase's
 *   default grants, then (unless `with0267: false`) the REAL 0267_pm_evals_privacy;
 *   the REAL level helpers 0217 assignment_user_level, 0228 assignment_author_level, 0233
 *   toast_link_actor_level (extracted verbatim) and the REAL 0270 (0271 reuses its position helper and
 *   the station_positions (id, location_id) index).
 * Never touches a real database.
 */
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(p, "utf8");
const mig = (name) => read(`supabase/migrations/${name}`);

export function extractFunction(sql, start) {
  const i = sql.indexOf(start);
  if (i < 0) throw new Error(`extract: ${start} not found`);
  const j = sql.indexOf("end $$;", i);
  return sql.slice(i, j + "end $$;".length);
}

export const LEVEL_HELPERS_SQL = [
  extractFunction(mig("0217_assignments_stations.sql"), "create or replace function public.assignment_user_level(p_user_id uuid, p_location_id uuid)"),
  extractFunction(mig("0228_assignment_attribution.sql"), "create function public.assignment_author_level(p_user_id uuid)"),
  extractFunction(mig("0233_whos_here.sql"), "create function public.toast_link_actor_level(p_actor_id uuid,p_location_id uuid)"),
].join("\n");

/** The PM v1 tables as production had them BEFORE 0267 (0072 + 0073 + the 0106 deny policy + default grants). */
export async function applyPmV1Tables(db) {
  await db.exec(`
    create table if not exists public.audit_log (actor_id uuid, actor_role text, action text,
      resource_table text, resource_id uuid, destructive boolean, metadata jsonb);
    create or replace function public.current_user_role_level() returns integer language sql stable as 'select 4';
    create or replace function public.current_user_locations() returns uuid[] language sql stable as 'select array[]::uuid[]';
    create or replace function public.current_user_id() returns uuid language sql stable as 'select null::uuid';
  `);
  await db.exec(mig("0072_pm_report_tables.sql"));
  await db.exec(mig("0073_pm_evals_gradient_reshape.sql"));
  await db.exec(`drop policy pm_reports_update on public.pm_reports;
    create policy pm_reports_no_user_update on public.pm_reports for update using (false);`);
  await db.exec("grant all on public.pm_reports, public.pm_employee_evals to anon, authenticated, service_role;");
}

/** Everything 0271 stands on. `with0267: false` leaves the pre-0267 posture (the preflight must refuse it). */
export async function applyPmV2Base(db, { with0267 = true } = {}) {
  await applyPmV1Tables(db);
  if (with0267) await db.exec(mig("0267_pm_evals_privacy.sql"));
  await db.exec(LEVEL_HELPERS_SQL);
  await db.exec(mig("0270_people_layer.sql"));
}

export const M0271 = mig("0271_pm_reports_v2.sql");
