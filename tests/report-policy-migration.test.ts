import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/0217_assignments_stations.sql", "utf8");
const baseline = readFileSync("supabase/migrations/0058_role_model_renumber.sql", "utf8");
const normalize = (sql: string) => sql.toLowerCase().replace(/public\./g, "").replace(/\s/g, "");
function policy(sql: string, name: string): string {
  const expression = sql.match(new RegExp(`alter policy ${name} on public\\.\\w+\\s+using ([\\s\\S]*?);`, "i"))?.[1];
  if (!expression) throw new Error(`Missing explicit policy: ${name}`);
  return expression;
}

describe("0217 report read scope (authored SQL, not live integration)", () => {
  it("changes exactly the approved report policy manifest, never config/admin or unused report tables", () => {
    const names = [...migration.matchAll(/alter policy (\w+) on public\./gi)].map(match => match[1]).sort();
    expect(names).toEqual([
      "cash_reports_read", "checklist_completions_read", "checklist_incomplete_reasons_read",
      "checklist_instances_read", "checklist_submissions_read", "pm_evals_read_mgr",
      "pm_reports_read", "written_reports_read",
    ].sort());
    // No dynamic SQL and no regex REWRITE of policy text. The single regexp_replace allowed is the
    // read-only "(8)::numeric" cast normalization inside the final-expression assertion
    // (sim probe 2026-10-07: Postgres stores the level literals with a ::numeric cast).
    expect(migration).not.toMatch(/execute\s+format/i);
    expect(migration.match(/regexp_replace/gi) ?? []).toHaveLength(1);
  });

  it.each([
    "checklist_completions_read", "checklist_incomplete_reasons_read",
    "checklist_instances_read", "checklist_submissions_read", "written_reports_read",
  ])("preserves every 0058 qualifier and grouping for %s except the approved 9-to-8 floor", name => {
    const expected = policy(baseline, name).replace(/>= 9/g, ">= 8");
    expect(normalize(policy(migration, name))).toBe(normalize(expected));
  });

  it.each(["cash_reports_read", "pm_reports_read", "pm_evals_read_mgr"])(
    "%s keeps KH minimum outside the expanded location branch", name => {
      expect(normalize(policy(migration, name))).toBe(normalize(`(
        current_user_role_level() >= 4 and
        (location_id = any(current_user_locations()) or current_user_role_level() >= 8))`));
    },
  );

  it("fails on missing SELECT policies or full final expression drift instead of skipping them", () => {
    expect(migration).toContain("expected report SELECT policy missing:");
    expect(migration).toContain("report policy expression mismatch:");
    expect(migration).toContain("and policyname=r.policy_name and cmd='SELECT'");
    expect(migration).toContain("set local search_path = pg_catalog, public");
    // Whitespace only: stripping parentheses would fail to detect precedence drift.
    expect(migration).toContain("::numeric', '\\1', 'g')), E' \\t\\n\\r', '')");
    expect(migration).toContain("is distinct from translate(lower(r.expression), E' \\t\\n\\r', '')");
  });
});
