/**
 * Audit W20/B196: migration 0326 re-emits vendor_mail_mutate so a human vendor-mail action no
 * longer deadlocks with the receipt-event trigger. The fix is ONE lock clause; everything else in
 * the function is 0299's, byte for byte. FILE ONLY: never applied from here.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const m0299 = read("supabase/migrations/0299_vendor_mail_b2.sql");
const m0326 = read("supabase/migrations/0326_vendor_mail_mutate_lock_order.sql");
const functionOf = (sql: string) => {
  const start = sql.indexOf("create or replace function public.vendor_mail_mutate(");
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("end $$;", start) + "end $$;".length);
};

describe("0326 vendor_mail_mutate lock order (B196)", () => {
  it("is 0299's body with exactly one difference: the inbound message is locked FOR NO KEY UPDATE", () => {
    const before = functionOf(m0299);
    const after = functionOf(m0326);
    const OLD = "select * into m from public.inbound_messages where id=p_message_id and lane='vendor_receipt' for update;";
    const NEW = "select * into m from public.inbound_messages where id=p_message_id and lane='vendor_receipt' for no key update;";
    expect(before.split(OLD)).toHaveLength(2);
    expect(after).toBe(before.replace(OLD, NEW));
    // The receipt row keeps its FOR UPDATE, and is still taken second.
    expect(after).toContain("select * into r from public.email_receipts where id=m.email_receipt_id for update;");
    expect(after.indexOf(NEW)).toBeLessThan(after.indexOf("where id=m.email_receipt_id for update;"));
  });

  it("never changes a key column of the message it locks (what makes the weaker lock safe)", () => {
    const body = functionOf(m0326);
    const sets = [...body.matchAll(/update public\.inbound_messages set ([^;]+?) where id=m\.id;/g)].map((m) => m[1]!);
    expect(sets.length).toBeGreaterThanOrEqual(4);
    for (const assignment of sets) expect(assignment).not.toMatch(/(^|,)\s*id\s*=/);
  });

  it("carries the house header, the refusal guard and the privilege ceiling, and stays file-only", () => {
    expect(m0326.startsWith("-- Migration 0326_vendor_mail_mutate_lock_order\n")).toBe(true);
    expect(m0326).toContain("NOT YET APPLIED");
    expect(m0326).not.toMatch(/APPLIED TO PROD/);
    expect(m0326).toContain("bug B196");
    for (const part of ["-- PRE-FLIGHT", "-- VERIFY AFTER APPLY", "-- ROLLBACK", "-- EXISTING ROWS", "-- LOCK ORDER"]) expect(m0326).toContain(part);
    expect(m0326).toContain("raise exception '0326: 0299 (vendor mail body hash) must be applied first'");
    expect(m0326).toContain("revoke all on function public.vendor_mail_mutate(uuid,integer,uuid,uuid,uuid,text,jsonb) from public, anon, authenticated, service_role;");
    expect(m0326).toContain("'0326: vendor_mail_mutate must stay private'");
    expect(m0326.trimEnd().endsWith("commit;")).toBe(true);
    // No table, column, trigger, policy or data statement.
    const statements = m0326.split("\n").filter((line) => !line.startsWith("--")).join("\n");
    expect(statements).not.toMatch(/\b(create|alter|drop)\s+(table|index|trigger|policy|view|sequence)\b/i);
    expect(statements).not.toMatch(/\b(delete\s+from|truncate)\b/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
  });

  it("applied files are not edited: 0297 and 0299 keep their own text", () => {
    expect(m0299).toContain("for update;");
    expect(m0299).not.toContain("for no key update");
    expect(read("supabase/migrations/0297_vendor_mail.sql")).not.toContain("for no key update");
  });

  it("the runbook states the corrected lock order", () => {
    const runbook = read("docs/runbooks/vendor-mail.md");
    expect(runbook).toContain("## Lock order");
    expect(runbook).toContain("FOR NO KEY UPDATE");
    expect(runbook).toContain("0326");
  });

  it("real DDL: every 0299 scenario on the new body, the guard, the ceiling, idempotency", () => {
    const output = execFileSync(process.execPath, ["scripts/sql-harness-0326.mjs"], { encoding: "utf8", timeout: 400_000 });
    for (const pin of [
      "every 0299 scenario passes on the 0326 body", "refuses over the 0297 body and leaves it untouched",
      "installed body = 0299 with exactly one lock clause changed", "lock order: message, then receipt",
      "re-applying 0326 is a no-op", "the engine stays private", "the three wrappers keep service_role-only execute",
      "a variant that opens the engine fails its own assertion and rolls back", "PASS 0326:",
    ]) expect(output).toContain(pin);
  }, 420_000);
});
