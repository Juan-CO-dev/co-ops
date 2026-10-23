import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/0284_schedule_crew_gaps.sql");
const prior = read("supabase/migrations/0275_schedule_weeks.sql");
function body(source: string, name: string): string {
  const start = source.indexOf(`function public.${name}(`);
  return source.slice(start, source.indexOf("end $$;", start) + 7);
}

describe("0284 crew gap migration", () => {
  it("replays all unchanged 0275 assertions and crew shape/admission/inheritance/approval cases", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0284.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toContain("PASS 0284: 171 checks (including unchanged 0275 assertions)");
  }, 250_000);
  it("retains every legacy certificate branch verbatim", () => {
    const actual = body(sql, "valid_gap_certificate")
      .replace("declare k text; v jsonb; r jsonb; v_ids text[]; v_types text[]; v_from numeric;", "declare k text; v jsonb;")
      .replace(/    when 'crew_shortfall' then[\s\S]*?(?=    when 'budget_limited' then)/, "")
      .replace("\nexception when invalid_parameter_value then return false;", "");
    expect(actual).toBe(body(prior, "valid_gap_certificate"));
  });
  it("retains the complete writer except the bounded gap admission additions", () => {
    const actual = body(sql, "commit_schedule_revision")
      .replace("'closing_manager_missing', 'open_shift'", "'closing_manager_missing'")
      .replace("'unresolved_search', 'crew_shortfall'", "'unresolved_search'")
      .replace(/    -- 0284 crew admission:[\s\S]*?(?=    begin v_date := \(v_e ->> 'date'\)::date;)/, "");
    expect(actual).toBe(body(prior, "commit_schedule_revision"));
    expect(sql).not.toMatch(/(?:create|replace) function public\.approve_schedule_week/);
  });
  it("documents rollout, guards and append-only rollback, preserves grants and signatures", () => {
    for (const text of ["NOT YET APPLIED", "ROLLOUT:", "VERIFY AFTER APPLY:", "ROLLBACK:",
      "0284: already applied", "0284: 0275 and 0283 must be applied first",
      "revoke all on function public.valid_gap_certificate(text,jsonb) from public, anon, authenticated;",
      "grant execute on function public.valid_gap_certificate(text,jsonb) to service_role;"])
      expect(sql).toContain(text);
    expect(sql.replace(body(sql, "commit_schedule_revision"), "")).not.toMatch(/(?:update|delete from) public\.schedule_/i);
    expect(sql).not.toContain("create table");
  });
});
