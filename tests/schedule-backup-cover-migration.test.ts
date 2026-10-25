import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/0285_schedule_backup_cover.sql");
function body(source: string, name: string): string {
  const start = source.indexOf(`function public.${name}(`);
  return source.slice(start, source.indexOf("end $$;", start) + 7);
}

describe("0285 Backup cover migration", () => {
  it("executes the migration chain, optional cap cases, gap admission and legacy assertions", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0285.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toMatch(/PASS 0285: \d+ checks \(including unchanged 0275 assertions\)/);
  }, 250_000);
  it("preserves 0283 except the optional bounded roster cap", () => {
    const actual = body(sql, "valid_schedule_structure")
      .replace("schedule_json_exact_keys(case when jsonb_typeof(p -> 'roster') = 'object' then (p -> 'roster') - 'backupCoverPerDay' else p -> 'roster' end, array['excludedRoles'])", "schedule_json_exact_keys(p -> 'roster', array['excludedRoles'])")
      .replace(/  -- 0285 backup cover:[\s\S]*?(?=  -- r3 wave bounds)/, "");
    expect(actual).toBe(body(read("supabase/migrations/0283_schedule_crew_structure.sql"), "valid_schedule_structure"));
  });
  it("preserves 0284 except admitting the backup_cover_cap rejection reason", () => {
    expect(body(sql, "valid_gap_certificate").replace(", 'backup_cover_cap'", ""))
      .toBe(body(read("supabase/migrations/0284_schedule_crew_gaps.sql"), "valid_gap_certificate"));
    expect(sql).not.toContain("function public.commit_schedule_revision(");
  });
  it("documents rollout, markers, append-only rollback and service-role-only grants", () => {
    for (const part of ["AUTHORED 2026-10-24. NOT YET APPLIED", "AFTER 0284.", "Provenance:", "ROLLOUT:", "VERIFY AFTER APPLY:", "ROLLBACK:",
      "0285 backup cover", "0285: already applied", "0285: 0283 and 0284 must be applied first",
      "count(*) from public.schedule_structures where not public.valid_schedule_structure(structure)"])
      expect(sql).toContain(part);
    for (const signature of ["valid_schedule_structure(jsonb)", "valid_gap_certificate(text,jsonb)"]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(sql).not.toMatch(/(?:update|delete from|insert into) public\.schedule_/i);
  });
});
