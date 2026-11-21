/**
 * Nav PR 6 (plan r3, 8.8): migration 0353_station_day_flags, FILE ONLY. The header, the pre-flight, the read-only
 * pre-check and verify queries, the grants, the one audit row and the final commit are pinned here; the offline PGlite
 * harness (scripts/sql-harness-0353.mjs) runs the real file and prints both broken variants as EXPECTED FAIL.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const m0353 = readFileSync("supabase/migrations/0353_station_day_flags.sql", "utf8").replace(/\r\n/g, "\n");
const body = (name: string) => {
  const start = m0353.indexOf(`create function public.${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  return m0353.slice(start, m0353.indexOf("end $$;", start));
};

describe("0353 station day flags", () => {
  it("header, pre-flight, pre-check and verify queries", () => {
    expect(m0353).toContain("-- AUTHORED 2026-11-21. NOT YET APPLIED - sim first, prod on Juan's word.");
    for (const section of ["-- WHAT:", "-- DATA:", "-- LOCK ORDER:", "-- ROLLOUT:", "-- VERIFY AFTER APPLY:"]) expect(m0353).toContain(section);
    expect(m0353).toContain("raise exception '0353: expected public.stations'");
    expect(m0353).toContain("raise exception '0353: stations.starts_mid_day already exists'");
    expect(m0353).toContain("raise exception '0353: stations.not_phase_station already exists'");
    expect(m0353).toContain("raise exception '0353: a station flag function already exists'");
    // The read-only pre-check is the backfill's own `exists`, as a select; the verify lists the marked stations.
    expect(m0353).toContain("--      where exists (select 1 from public.checklist_template_items ti where ti.template_id = eff.id and ti.active");
    expect(m0353).toContain("--                     and btrim(ti.station) = s.name and ti.report_reference_type is not null)");
    expect(m0353).toContain("--    where s.not_phase_station order by 1, 2;");
    expect(m0353).toContain("create unique index stations_one_mid_day_trigger on public.stations (location_id) where starts_mid_day;");
    expect(m0353).toContain("add column starts_mid_day boolean not null default false,\n  add column not_phase_station boolean not null default false;");
  });

  it("the backfill is the 'at least one active report reference' rule over the effective closing template", () => {
    expect(m0353).toContain("order by t.location_id, t.effective_from desc nulls last, t.created_at desc");
    expect(m0353).toContain("where t.type = 'closing' and t.active\n       and (t.effective_from is null or t.effective_from <= (now() at time zone 'America/New_York')::date)");
    expect(m0353).toContain("and ti.active and btrim(ti.station) = s.name\n                      and ti.report_reference_type is not null)");
  });

  it("E (1): in both writers the shop's locations row is locked before the first update of stations", () => {
    for (const fn of ["set_station_mid_day_trigger", "set_station_not_phase"]) {
      const b = body(fn);
      const lock = b.indexOf("perform 1 from public.locations where id = p_location_id and active for update;");
      expect(lock, fn).toBeGreaterThan(0);
      expect(lock, fn).toBeLessThan(b.indexOf("update public.stations"));
      expect(b.indexOf("public.station_setup_actor_ok(p_actor_id, p_location_id)"), fn).toBeGreaterThan(lock);
    }
    const mid = body("set_station_mid_day_trigger");
    expect(mid.indexOf("set starts_mid_day = false where location_id = p_location_id")).toBeLessThan(mid.indexOf("set starts_mid_day = true"));
    expect(mid).toContain("exception when unique_violation then\n  raise exception 'mid_day_trigger_conflict';");
  });

  it("grants: the writers for service_role only; the helper for nobody; one audit row; commit at the end", () => {
    expect(m0353).toContain("revoke all on function public.station_setup_actor_ok(uuid,uuid) from public, anon, authenticated, service_role;");
    expect(m0353).toContain("revoke all on function public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean) from public, anon, authenticated;");
    expect(m0353).toContain("revoke all on function public.set_station_not_phase(uuid,uuid,uuid,boolean) from public, anon, authenticated;");
    expect(m0353).toContain("grant execute on function public.set_station_mid_day_trigger(uuid,uuid,uuid,boolean) to service_role;");
    expect(m0353).toContain("grant execute on function public.set_station_not_phase(uuid,uuid,uuid,boolean) to service_role;");
    expect(m0353.match(/INSERT INTO public\.audit_log/g)).toHaveLength(1);
    expect(m0353).toContain("jsonb_build_object('actor_context', 'migration_apply', 'migration', '0353_station_day_flags',");
    expect(m0353).toContain("'backfill_station_ids', to_jsonb(v_marked)");
    expect(m0353.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("runs the real file in PGlite: every case passes and both broken variants fail", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0353.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toContain("EXPECTED FAIL 0353 broken variant: the mid-day writer without its clear step fails case C (mid_day_trigger_conflict)");
    expect(output).toContain("EXPECTED FAIL 0353 broken variant: the \"all items are references\" backfill leaves Closing Manager a phase station");
    expect(output).toContain("REQUIRED (not run here): the two-session proof scripts/sim/stations-0353-two-sessions.mjs");
    expect(output).toMatch(/PASS 0353: \d+ checks/);
  }, 250_000);
});
