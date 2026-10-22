import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/0283_schedule_crew_structure.sql", "utf8").replace(/\r\n/g, "\n");
const prior = readFileSync("supabase/migrations/0274_schedule_settings.sql", "utf8").replace(/\r\n/g, "\n");
const body = (s: string) => s.slice(s.indexOf("function public.valid_schedule_structure("), s.indexOf("end $$;", s.indexOf("function public.valid_schedule_structure(")) + 7);

describe("0283 crew structure migration", () => {
  it("executes the full migration chain and legacy/crew SQL parity harness", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0283.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toContain("0283: 182/182 checks passed");
  }, 250_000);
  it("keeps every legacy rule unchanged after removing only crew additions", () => {
    const clean = body(sql)
      .replace("\n  v_types jsonb; v_type jsonb; v_crewcat jsonb; v_typeids text[] := '{}'; v_stations text[];", "")
      .replace(/\n  v_trimchars text := U&[^\n]+;/, "")
      .replace("schedule_json_exact_keys(p - 'engine' - 'shiftTypes',", "schedule_json_exact_keys(p,")
      .replace("schedule_json_exact_keys(v_cat - 'crewShift',", "schedule_json_exact_keys(v_cat,")
      .replace(/  -- 0283 crew structure:[\s\S]*?\n  return true;/, "  return true;");
    expect(clean).toBe(body(prior));
  });
  it("documents safe rollout and append-only rollback, gates repeat and prerequisites, locks grants", () => {
    for (const part of ["NOT YET APPLIED", "ROLLOUT:", "VERIFY AFTER APPLY:", "ROLLBACK:", "0283: already applied", "0283: 0282 must be applied first",
      "language plpgsql immutable set search_path = pg_catalog, public", "revoke all on function public.valid_schedule_structure(jsonb) from public, anon, authenticated;",
      "grant execute on function public.valid_schedule_structure(jsonb) to service_role;"]) expect(sql).toContain(part);
    expect(sql).not.toMatch(/(?:update|delete from|insert into) public\.schedule_structures/i);
    expect(sql).not.toContain("create or replace function public.save_schedule_structure");
  });
});
