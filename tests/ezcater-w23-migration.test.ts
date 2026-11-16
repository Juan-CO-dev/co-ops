/**
 * 0330 (audit wave W23): the offline PGlite proof, plus a pin that the re-emitted
 * reconcile_ezcater_toast keeps every 0229 line except the one lock-everything statement (B209),
 * and that the guarded W23-4 b switch-off and its listing stay the same query.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (n: string) => readFileSync(`supabase/migrations/${n}`, "utf8").replace(/\r\n/g, "\n");
const sql = read("0330_ezcater_catering_records_fixes.sql");

function body(text: string, replace: boolean): string[] {
  const m = text.match(new RegExp(`create ${replace ? "or replace " : ""}function public\\.reconcile_ezcater_toast\\([\\s\\S]*?\\nend \\$\\$;`));
  if (!m) throw new Error("no reconcile body");
  return m[0].split("\n").map((l) => l.trim()).filter(Boolean).slice(1);
}
function changedLines(): string[] {
  const src = body(read("0229_ezcater_toast_reconcile.sql"), false), dst = body(sql, true);
  const missing: string[] = [];
  let j = 0;
  for (const line of src) {
    const k = dst.indexOf(line, j);
    if (k < 0) missing.push(line); else j = k + 1;
  }
  return missing;
}

describe("0330 header and shape", () => {
  it("house header, one transaction, file only", () => {
    const lines = sql.split("\n");
    expect(lines[0]).toBe("-- Migration 0330_ezcater_catering_records_fixes");
    expect(lines[1]).toMatch(/^-- AUTHORED 2026-11-15\. NOT YET APPLIED/);
    expect(sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });
  it("the W23-4 b switch-off is acknowledged by exact count and never deletes", () => {
    expect(sql).toContain("current_setting('co_ops.w23_company_switchoff', true)");
    expect(sql).toContain("if v_done <> v_expected then");
    expect(sql).not.toMatch(/delete\s+from\s+public\.catering_companies/i);
    expect(sql).not.toMatch(/delete\s+from\s+public\.customer_orders/i);
  });
  it("the header listing, the pre-flight count and the switch-off read the same predicate", () => {
    const predicate = [
      "c.active and c.claimed_by_customer_id is null",
      "not exists (select 1 from public.catering_company_domains d where d.company_id = c.id)",
      "not exists (select 1 from public.catering_customers u where u.company_id = c.id)",
      "lower(btrim(k.name)) = lower(btrim(c.name)) and (k.created_at, k.id) > (c.created_at, c.id)",
    ];
    for (const p of predicate) expect(sql.split(p).length - 1, p).toBe(3);
  });
});

describe("B209: reconcile_ezcater_toast changes only its provider locking", () => {
  it("drops the lock-every-order statement and keeps every other 0229 line in order", () => {
    expect(changedLines()).toEqual([
      "-- Acquire the same provider locks as snapshot/transfer/publisher before row locks.",
      "perform pg_advisory_xact_lock(hashtext(provider_uuid)) from public.ezcater_orders order by provider_uuid;",
    ]);
    const dst = body(sql, true).join("\n");
    expect(dst).not.toContain("from public.ezcater_orders order by provider_uuid");
    expect(dst).toContain("perform pg_advisory_xact_lock(hashtext(p)) from unnest(v_need) p order by p;");
    expect(dst).toContain("insert into pg_temp.ezcater_reconcile_plan select * from public.plan_ezcater_toast();");
  });
});

it("0330 offline proof: B209 red before, every W23 SQL fix green after; guard, refusals and ceilings", () => {
  const output = execFileSync(process.execPath, ["scripts/sql-harness-0330.mjs"], { encoding: "utf8", timeout: 400_000 });
  expect(output).toMatch(/EXPECTED FAIL 0330 broken variant: 0229 reconcile held 301 advisory locks/);
  expect(output).toMatch(/^PASS 0330: \d+ checks/m);
}, 400_000);
