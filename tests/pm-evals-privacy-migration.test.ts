import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0267_pm_evals_privacy.sql", "utf8");

describe("0267 PM privacy migration", () => {
  it("retains the provenance header, including after an applied stamp", () => {
    expect(sql).toMatch(/^-- Migration 0267_pm_evals_privacy\r?\n/);
    expect(sql).toMatch(/^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review$/m);
  });

  it.each(["pm_employee_evals", "pm_reports"])("removes direct writes and table grants on %s", (table) => {
    expect(sql).toContain(`revoke all privileges on table public.${table} from public, anon, authenticated, service_role;`);
    expect(sql).toContain(`grant select, insert, update on table public.${table} to service_role;`);
  });

  it("removes both insert policies and asserts the note and service ceiling", () => {
    expect(sql).toContain("drop policy if exists pm_evals_insert");
    expect(sql).toContain("drop policy if exists pm_reports_insert");
    expect(sql).toContain("has_column_privilege('authenticated', 'public.pm_employee_evals', 'note', 'SELECT')");
    expect(sql).toContain("has_any_column_privilege('authenticated'");
    expect(sql).toContain("has_table_privilege('service_role'");
  });
});
