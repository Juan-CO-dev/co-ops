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
      // B010
      "B0 before 0305: an employee (level 3) reads catering_quote_items at their shops while catering_quotes returns nothing (the bug)",
      "B0 before 0305: an employee (level 3) reads catering_order_items at their shops while catering_orders returns nothing (the bug)",
      "B0 before 0305: an employee (level 3) reads catering_pipeline_events at their shops while catering_pipeline returns nothing (the bug)",
      "B1 employee (level 3, both) reads 0 located parent(s) of catering_quote_items",
      "B1 keyHolder (level 4, both) reads 0 located parent(s) of catering_order_items",
      "B1 shiftLead (level 5, both) reads 2 located parent(s) of catering_pipeline_events",
      "B1 shiftLead (level 5, b_only) reads 1 located parent(s) of catering_quote_items",
      "B1 gm (level 7, none) reads 0 located parent(s) of catering_quote_items",
      "B1 owner (level 9, none) reads 2 located parent(s) of catering_order_items",
      "B2 shiftLead (level 5, both): unassigned-lead history hidden",
      "B2 cateringMgr (level 6, none): unassigned-lead history readable",
      "B3 exactly one SELECT policy per child table, carrying the level-5 floor and the level-9 arm",
      "B4 refuses when a second read policy would OR the floor away",
    ]) expect(output).toContain(`ok   ${line}`);
  }, 250_000);

  it("is one transaction, file-only, and stamps one audit row per section", () => {
    expect(sql).toMatch(/^-- Migration 0305_rls_membership_and_read_floors\n-- AUTHORED 2026-11-14\. NOT YET APPLIED/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    for (const bug of ["B009", "B010"]) expect(sql).toContain(`'bug', '${bug}'`);
    // Never a destructive statement: this wave changes predicates and grants only.
    expect(sql).not.toMatch(/\b(drop table|truncate|delete from|drop column)\b/i);
  });
});
