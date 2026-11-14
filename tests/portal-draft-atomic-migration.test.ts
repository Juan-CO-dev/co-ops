/**
 * Audit W01 (B032, B144, B002) — migration 0302 pinned: the house header and gate line, the executable
 * PGlite proof, the shared row lock, the service_role-only grants, and the lib calling exactly these
 * signatures with the legacy fallback only on a missing function.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("supabase/migrations/0302_portal_draft_atomic.sql", "utf8").replace(/\r\n/g, "\n");
const lib = readFileSync("lib/portal/draft.ts", "utf8");

describe("0302_portal_draft_atomic", () => {
  it("house header and gate line — and a later APPLIED stamp under it never breaks the pin", () => {
    const ok = (sql: string) => {
      const lines = sql.split("\n");
      return lines[0] === "-- Migration 0302_portal_draft_atomic"
        && /^-- AUTHORED 2026-11-14\. NOT YET APPLIED — apply via MCP after review \(sim first, prod on Juan's word\)\.$/.test(lines[1] ?? "")
        && lines.slice(2, 8).filter((l) => /^-- APPLIED /.test(l)).every((l) => /^-- APPLIED TO (PROD|SIM) \d{4}-\d{2}-\d{2}/.test(l));
    };
    expect(ok(src)).toBe(true);
    const [first, gate, ...rest] = src.split("\n");
    expect(ok([first, gate, "-- APPLIED TO SIM 2026-11-15 (schema_migrations version 20261115000001, name 'portal_draft_atomic')", ...rest].join("\n"))).toBe(true);
  });

  it("the executable proof (PGlite: the REAL parent DDL + 0302 on synthetic rows) runs green in CI", () => {
    const out = execFileSync(process.execPath, ["scripts/sql-harness-0302.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(out).not.toContain("FAIL ");
    expect(out).toContain("PASS 0302:");
  }, 260_000);

  it("one transaction, both writers take the quote row FOR UPDATE, definer + pinned search_path", () => {
    expect(src.startsWith("-- Migration 0302_portal_draft_atomic")).toBe(true);
    expect(src).toMatch(/\nbegin;\n/);
    expect(src.trimEnd().endsWith("commit;")).toBe(true);
    expect(src.match(/from public\.catering_quotes where id = p_quote_id for update;/g)).toHaveLength(2);
    expect(src.match(/security definer set search_path = pg_catalog, public as \$\$/g)).toHaveLength(2);
    expect(src).toContain("raise exception 'cart_changed'");
    expect(src).toContain("on conflict (quote_id, kind) where status = 'due' do nothing");
  });

  it("execute is service_role only, asserted in the migration; no table grant is touched", () => {
    expect(src).toContain("execute format('revoke all on function %s from public, anon, authenticated, service_role', f);");
    expect(src).toContain("execute format('grant execute on function %s to service_role', f);");
    expect(src).not.toMatch(/grant (select|insert|update|delete|all) on (table )?public\./i);
    expect(src).not.toMatch(/\n\s*(drop|alter) table/i);
  });

  it("the lib calls exactly these writers and falls back ONLY when the function is missing", () => {
    expect(lib).toContain('sb.rpc("portal_draft_set_lines", {');
    expect(lib).toContain('sb.rpc("portal_draft_submit", {');
    expect(lib).toContain('error.code === "PGRST202" || error.code === "42883"');
    for (const arg of ["p_customer_id", "p_quote_id", "p_lines", "p_snapshot", "p_expected_lines", "p_napkins", "p_expires_at", "p_set_dietary_notes", "p_dietary_notes"]) {
      expect(lib).toContain(`${arg}:`);
      expect(src).toContain(arg);
    }
  });
});
