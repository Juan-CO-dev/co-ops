/**
 * Migration 0305 (bug audit 2026-11-14, wave W05). The executable proof is scripts/sql-harness-0305.mjs:
 * the REAL helpers and policies plus the real 0305 in ephemeral PGlite, every request run as PostgREST
 * runs it (role + JWT claims). This pin runs it in CI and names what it must have proven.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/0305_rls_membership_and_read_floors.sql", "utf8");

describe("0305 RLS membership and read floors", () => {
  it("runs the offline SQL harness clean", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0305.mjs"], { encoding: "utf8", timeout: 240_000 });
    expect(output).toContain("PASS 0305:");
    expect(output).not.toContain("FAIL");
    for (const line of [
      // B009
      "A0 before 0305: a key holder removed from shop A still reads shop A's cash reports (the bug)",
      "A1 after 0305: the removed shop is closed, the kept shop still reads",
      "A1 an untouched member of both shops still reads both",
      "A2 EXECUTE: authenticated + service_role, never anon",
      "A3 a second apply refuses",
      "A3 a refused apply changes nothing (one transaction)",
    ]) expect(output).toContain(`ok   ${line}`);
  }, 250_000);

  it("is one transaction, file-only, and stamps one audit row per section", () => {
    expect(sql).toMatch(/^-- Migration 0305_rls_membership_and_read_floors\n-- AUTHORED 2026-11-14\. NOT YET APPLIED/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    for (const bug of ["B009"]) expect(sql).toContain(`'bug', '${bug}'`);
    // Never a destructive statement: this wave changes predicates and grants only.
    expect(sql).not.toMatch(/\b(drop table|truncate|delete from|drop column)\b/i);
  });
});
