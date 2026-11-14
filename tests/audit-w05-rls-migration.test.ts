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
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0305.mjs"], { encoding: "utf8", timeout: 420_000 });
    expect(output).toContain("PASS 0305:");
    expect(output).not.toContain("FAIL");
    for (const line of [
      // B009
      "A0 before 0305: a key holder removed from shop A still reads shop A's cash reports (the bug)",
      "A1 after 0305: the removed shop is closed, the kept shop still reads",
      "A1 an untouched member of both shops still reads both",
      "A2 EXECUTE: authenticated + service_role, never anon",
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
      // B150
      "C0 before 0305: a key holder removed from the shop (inactive membership) still marks a completion not done (the bug)",
      "C1 mark-not-done key_holder/inactive refuses not_authorized",
      "C1 revoke-with-reason key_holder/inactive: not_authorized",
      "C1 quick revoke gm/missing: not_authorized",
      "C1 mark-not-done moo/missing: allowed",
      "C1 mark-not-done employee/active: role_level_insufficient",
      "C2 checklist_mark_not_done is 0287's body with one changed statement (and its comment)",
      "C2 checklist_revoke_completion is 0287's body with one changed statement (and its comment)",
      "C2 checklist_revoke_with_reason is 0287's body with one changed statement (and its comment)",
      "C3 authenticated cannot call checklist_mark_not_done",
      "C4 refuses when a correction RPC is not 0287's body (a later re-emission)",
      // B152
      "D0 before 0305: the anon key alone reads every opening_setup_items row (the bug)",
      "D1 after 0305: anon is refused (no grant)",
      "D2 a signed-in employee still reads the setup items",
      "D2 a revoked session reads nothing",
      "D3 a signed-in GM still cannot insert",
      "D4 one read policy: TO authenticated, live session",
      "D4 anon holds nothing; authenticated holds SELECT only",
      "D5 refuses when another read policy would keep the table open",
      // the whole file
      "Z  audit rows: B009 x1, B010 x3, B150 x1, B152 x1, all migration_apply",
      "Z  a second apply of the whole file refuses",
      "Z  the refused second apply wrote nothing",
      "Z  after every refusal the untouched schema still takes the real 0305",
    ]) expect(output).toContain(`ok   ${line}`);
  }, 430_000);

  it("is one transaction, file-only, and stamps an audit row for every change", () => {
    expect(sql).toMatch(/^-- Migration 0305_rls_membership_and_read_floors\n-- AUTHORED 2026-11-14\. NOT YET APPLIED/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
    for (const bug of ["B009", "B010", "B150", "B152"]) expect(sql).toContain(`'bug', '${bug}'`);
    // Never a destructive statement: this wave changes predicates, function bodies and grants only.
    const statements = sql.replace(/^\s*--.*$/gm, "");
    expect(statements).not.toMatch(/\b(drop table|truncate table|delete from|drop column|drop policy|drop function|create table)\b/i);
    // Every guard names the migration, so a refusal at apply time is attributable to this file.
    const guards = (statements.match(/raise exception '0305: /g) ?? []).length;
    expect(guards).toBeGreaterThanOrEqual(20);
  });

  it("re-emits the three correction RPCs from 0287 with exactly one changed statement each", () => {
    const m0287 = readFileSync("supabase/migrations/0287_checklist_corrections_serialized.sql", "utf8").replace(/\r\n/g, "\n");
    const normalized = sql.replace(/\r\n/g, "\n");
    for (const name of ["checklist_revoke_completion", "checklist_revoke_with_reason", "checklist_mark_not_done"]) {
      const original = m0287.match(new RegExp(`create function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`))?.[0];
      const reemitted = normalized.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nend \\$\\$;`))?.[0];
      expect(original, name).toBeTruthy();
      expect(reemitted, name).toBeTruthy();
      const a = original!.split("\n");
      const b = reemitted!.split("\n");
      expect(b).toHaveLength(a.length);
      const changed = a.map((line, i) => [line, b[i]!] as const).filter(([x, y]) => x !== y);
      // The header (create → create or replace), the comment, and the membership check: nothing else.
      expect(changed).toHaveLength(3);
      expect(changed[0]![1]).toBe(changed[0]![0].replace("create function", "create or replace function"));
      expect(changed[1]![1].trim()).toMatch(/^-- 0305 \(B150\): an ACTIVE membership only\./);
      expect(changed[2]![1]).toBe(changed[2]![0].replace("v_instance.location_id for share", "v_instance.location_id and active for share"));
    }
  });
});
