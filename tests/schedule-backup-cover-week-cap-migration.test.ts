import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/0286_schedule_backup_cover_week_cap.sql");
function body(source: string, name: string): string {
  const start = source.indexOf(`function public.${name}(`);
  return source.slice(start, source.indexOf("end $$;", start) + 7);
}

describe("0286 Backup cover migration", () => {
  it("executes the migration chain, optional cap cases, gap admission and legacy assertions", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0286.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toMatch(/PASS 0286: \d+ checks \(including unchanged 0275 assertions\)/);
  }, 250_000);
  it("preserves 0285 structure body except the optional weekly cap", () => {
    const actual = body(sql, "valid_schedule_structure")
      .replace(" - 'backupCoverPerPersonWeek'", "")
      .replace(/  -- 0286 backup cover week cap:[\s\S]*?(?=  -- r3 wave bounds)/, "");
    expect(actual).toBe(body(read("supabase/migrations/0285_schedule_backup_cover.sql"), "valid_schedule_structure"));
  });
  it("preserves 0285 gap body except the weekly rejection reason", () => {
    expect(body(sql, "valid_gap_certificate").replace(", 'backup_cover_week_cap'", ""))
      .toBe(body(read("supabase/migrations/0285_schedule_backup_cover.sql"), "valid_gap_certificate"));
    expect(sql).not.toContain("function public.commit_schedule_revision(");
  });
  it("documents rollout, markers, append-only rollback and service-role-only grants", () => {
    for (const part of ["AUTHORED 2026-11-01. NOT YET APPLIED", "AFTER 0285.", "Provenance:", "ROLLOUT:", "VERIFY AFTER APPLY:", "ROLLBACK:",
      "0286 backup cover week cap", "0286: already applied", "0286: 0285 must be applied first",
      "count(*) from public.schedule_structures where not public.valid_schedule_structure(structure)"])
      expect(sql).toContain(part);
    for (const signature of ["valid_schedule_structure(jsonb)", "valid_gap_certificate(text,jsonb)"]) {
      expect(sql).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(sql).not.toMatch(/(?:update|delete from|insert into) public\.schedule_/i);
  });
});
