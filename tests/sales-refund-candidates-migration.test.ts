import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");
const old = read("supabase/migrations/0239_sales_true_net.sql");
const migration = read("supabase/migrations/0247_sales_refund_candidates.sql");
const harness = read("docs/seed/check-0247-equivalence.sql");
const body = (sql: string) => sql.slice(sql.indexOf("create or replace function public.sales_report_daily("), sql.indexOf("\nrevoke all"));
const refund = (sql: string) => sql.slice(sql.indexOf("  ), refund_facts as materialized ("), sql.indexOf("  ), undated as ("));
const uncomment = (sql: string) => sql.replace(/--[^\n]*/g, "");

describe("0247 preserves 0239 outside the refund candidate scan", () => {
  it("keeps every byte outside refund_facts and the exact grants", () => {
    expect(body(migration).replace(refund(migration), "")).toBe(body(old).replace(refund(old), ""));
    expect(migration.slice(migration.indexOf("\nrevoke all"))).toBe(old.slice(old.indexOf("\nrevoke all")));
    expect(migration.match(/create or replace function /g)).toHaveLength(1);
    expect(uncomment(migration)).not.toMatch(/\b(?:update|insert|delete|alter|drop)\b/i);
  });
  it("retains latest pointer, deletion and classification predicates verbatim", () => {
    const oldRefund = refund(old);
    expect(refund(migration)).toContain(oldRefund.slice(oldRefund.indexOf("    join public.toast_order_latest_pointers"), oldRefund.indexOf("    where (")));
    expect(refund(migration)).toContain(oldRefund.slice(oldRefund.indexOf("      and not o.deleted")));
    expect(refund(migration)).toContain("where (pm.refund_business_date is not null or p.business_date <= p_to)");
  });
  it("bounds A by date, B by evidence, C by accounting; excludes B from C with NULL-safe logic", () => {
    const sql = uncomment(refund(migration));
    const branches = sql.slice(sql.indexOf("with candidates as materialized (")).split("union all");
    expect(branches).toHaveLength(3);
    expect(branches[0]).toContain("where pm.refund_business_date between p_from and p_to");
    expect(branches[1]).toContain("where pm.refund_business_date is null and pm.sales_refund_cents is distinct from 0");
    expect(branches[1]).toContain("and (pm.refund_amount_cents is not null or pm.refund_status in ('PARTIAL', 'FULL'))");
    expect(branches[2]).toContain("where c.accounting is not null");
    expect(branches[2]).toContain("cross join lateral (");
    expect(branches[2]).toContain("where pm.snapshot_id = c.snapshot_id and pm.check_guid = c.check_guid");
    expect(branches[2]).toContain("offset 0");
    expect(branches[2]).toContain("and pm.refund_business_date is null and pm.sales_refund_cents is null");
    expect(branches[2]).toContain("and (pm.refund_amount_cents is not null or pm.refund_status in ('PARTIAL', 'FULL')) is not true");
    expect(migration).toContain("on public.toast_payments(snapshot_id, check_guid)\n  where refund_business_date is null and sales_refund_cents is distinct from 0\n    and (refund_amount_cents is not null or refund_status in ('PARTIAL', 'FULL'));");
    expect(migration).toContain("on public.toast_order_checks(snapshot_id, check_guid)\n  where accounting is not null;");
  });
  it("embeds the exact migration body without a COMMIT and compares all 14 outputs in one snapshot", () => {
    const embedded = harness.split("-- BEGIN EXACT 0247 TRANSACTION BODY (no transaction control)\n")[1]!.split("-- END EXACT 0247 TRANSACTION BODY")[0];
    expect(embedded).toBe(migration.split("begin;\n")[1]!.split("commit;")[0]);
    expect(uncomment(harness)).not.toMatch(/^\s*commit\s*;/im);
    expect(harness).toContain("begin isolation level repeatable read;");
    expect(harness).toContain("generate_series(1, 3)");
    for (const window of ["today", "yesterday", "last7", "last31"]) expect(harness).toContain(`'${window}'`);
    expect(harness).toContain("if actual is distinct from r.result then");
    expect(harness).toContain("if compared <> 14 then raise exception");
    expect(harness).toContain("raise exception 'PASS:");
    expect(harness.trimEnd()).toMatch(/rollback;$/);
  });
});
