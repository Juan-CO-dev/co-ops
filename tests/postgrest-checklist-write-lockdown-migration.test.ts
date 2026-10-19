import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0277_postgrest_checklist_write_lockdown.sql", "utf8").replace(/\r\n/g, "\n");
const expected = {
  checklist_instances: ["checklist_instances_insert", "checklist_instances_insert_closing_staff", "checklist_instances_update"],
  checklist_completions: ["checklist_completions_insert", "checklist_completions_insert_closing_staff"],
  checklist_submissions: ["checklist_submissions_insert"],
  checklist_incomplete_reasons: ["checklist_incomplete_reasons_insert"],
  written_reports: ["written_reports_insert", "written_reports_update_self"],
};

describe("0277 PostgREST checklist write lockdown", () => {
  it("is file-only and pins the five tables and nine live permissive policies", () => {
    expect(sql).toContain("FILE ONLY; NOT APPLIED");
    expect(sql).toContain("No service_role ceiling (R4)");
    const manifest = Object.fromEntries([...sql.matchAll(/^  \('([a-z_]+)', array\[([^\]]+)\]\)[,;]$/gm)]
      .map(([, table, policies]) => [table, [...(policies ?? "").matchAll(/'([^']+)'/g)].map(m => m[1])]));
    expect(manifest).toEqual(expected);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toContain("'security.grants_change', table_name, null, true");
    expect(sql).toContain("'actor_context', 'migration_apply', 'migration', '0277_postgrest_checklist_write_lockdown'");
    expect(sql).toContain("'security.grants_change', 'schema_migrations', null, true");
    expect(sql).toContain("'scope', 'checklist PostgREST direct-write lockdown'");
    expect(sql).toContain("'affected_tables', jsonb_agg(table_name order by table_name)");
  });

  it("pins real-Postgres column revokes which PGlite table revokes cannot prove", () => {
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger on table public.%I from public, anon, authenticated");
    expect(sql).toContain("revoke insert (%1$I), update (%1$I), references (%1$I) on table public.%2$I from public, anon, authenticated");
    expect(sql).toContain("has_table_privilege(role_name, obj, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')");
    expect(sql).toContain("has_any_column_privilege(role_name, obj, 'INSERT, UPDATE, REFERENCES')");
    expect(sql).toContain("p.cmd in ('INSERT','UPDATE','DELETE','ALL')");
  });

  it("guards every exact 0276 signature and compares full SELECT ACL and policy snapshots", () => {
    const prerequisite = readFileSync("supabase/migrations/0276_checklist_guarded_writers.sql", "utf8");
    const signatures = [...sql.matchAll(/^    '(public\.[^']+)'[,\n]/gm)].map(m => m[1]);
    expect(signatures).toHaveLength(5);
    for (const signature of signatures) expect(prerequisite).toContain(signature);
    expect(sql).toContain("to_regprocedure(signature)");
    expect(sql).toContain("has_function_privilege('service_role', f, 'EXECUTE')");
    expect(sql).toContain("aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))");
    expect(sql).toContain("aclexplode(col.attacl)");
    expect(sql).toContain("jsonb_agg(to_jsonb(p) order by p.policyname)");
    expect(sql).toContain("p.cmd in ('SELECT','ALL')");
    expect(sql).toContain("is distinct from\n      (select snapshot from lockdown_0277_read_surface");
  });

  it("runs role-denial, read-parity and fail-closed mutation proofs locally", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0277.mjs"], {
      encoding: "utf8", timeout: 240_000,
    });
    expect(output).not.toContain("FAIL ");
    expect(output).toContain("PASS 0277:");
    expect(output).toContain("real sim verification required");
  }, 260_000);
});
