import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0267_pm_evals_privacy.sql", "utf8");

describe("0267 PM privacy migration", () => {
  it("retains the provenance header, including after an applied stamp", () => {
    const ok = (text: string) => {
      const lines = text.split("\n");
      return lines[0] === "-- Migration 0267_pm_evals_privacy"
        && /^-- AUTHORED 2026-10-15\. NOT YET APPLIED — apply via MCP after review \(sim → prod; no code depends on it, so order is free\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter(line => /^-- APPLIED /.test(line))
          .every(line => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(line));
    };
    expect(ok(sql)).toBe(true);
    const [first, gate, ...rest] = sql.split("\n");
    expect(ok([first, gate, "-- APPLIED TO PROD 2026-10-16 (schema_migrations version 20261016000001, name 'pm_evals_privacy')", ...rest].join("\n"))).toBe(true);
  });

  it("runs the executable PGlite proof in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0267.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0267:");
  }, 260_000);

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
    expect(sql).toContain("'DELETE, TRUNCATE, REFERENCES, TRIGGER'");
    expect(sql).toContain("select rolbypassrls from pg_roles where rolname = 'service_role'");
  });

  it("leaves exactly the four deny policies and audits both tables", () => {
    for (const [table, names] of Object.entries({
      pm_employee_evals: ["pm_evals_read_self", "pm_evals_read_mgr"],
      pm_reports: ["pm_reports_read"],
    })) for (const name of names) expect(sql).toContain(`drop policy if exists ${name} on public.${table};`);
    expect(sql).toContain("from (values ('pm_employee_evals'), ('pm_reports')) as changed(t);");
    expect(sql).toContain("'security.grants_change', t, null, true");
    expect(sql).toContain("'actor_context', 'migration_apply'");
  });
});
