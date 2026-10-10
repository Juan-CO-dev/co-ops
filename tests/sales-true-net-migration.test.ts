import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/0239_sales_true_net.sql");
const originalCapture = read("supabase/migrations/0221_toast_order_capture.sql");
const originalReads = read("supabase/migrations/0232_reports_sales_reads.sql");
const modified = read("supabase/migrations/0237_toast_modified_capture.sql");
const harness = read("scripts/test-sales-true-net.sql");
const executable = (text: string) => text.replace(/--[^\n]*/g, "");
const compact = (text: string) => executable(text).replace(/\s+/g, " ").trim();
const body = (text: string, name: string) => {
  const match = text.match(new RegExp(`create (?:or replace )?function public\\.${name}\\([\\s\\S]*?end \\$\\$;`));
  if (!match) throw new Error(`Missing SQL body ${name}`);
  return match[0].replace("create or replace function", "create function");
};

describe("0239 additive immutable capture contract", () => {
  it("reproduces the entire 0221 writer with only the two additive insert fields", () => {
    const restored = body(migration, "toast_capture_page")
      .replace("deleted,accounting)", "deleted)")
      .replace("deleted boolean,accounting jsonb)", "deleted boolean)")
      .replace("server_guid,sales_refund_cents)", "server_guid)")
      .replace("server_guid text,sales_refund_cents bigint)", "server_guid text)");
    expect(compact(restored)).toBe(compact(body(originalCapture, "toast_capture_page")));
  });
  it("adds nullable columns without updating history, defaults, tables, policies or indexes", () => {
    const sql = executable(migration);
    expect(sql).toContain("add column accounting jsonb");
    expect(sql).toContain("add column sales_refund_cents bigint");
    expect(sql).not.toMatch(/add column[^;]*(?:not null|default)/i);
    expect(sql).not.toMatch(/update public\.(toast_order_checks|toast_payments)|create (?:table|policy|index)|delete from|truncate/i);
    expect(migration).toContain("APPLIED TO PROD");
  });
  it("preserves 0237 dynamic nullable payment-row comparison and leaves it unreplaced", () => {
    expect(modified).toContain("jsonb_populate_recordset(null::public.toast_payments,entry->'payments')");
    expect(modified).toContain("to_jsonb(p)-'snapshot_id' order by p.payment_guid");
    expect(modified).toContain("if incoming=previous then continue; end if;");
    expect(executable(migration)).not.toContain("function public.toast_modified_save");
  });
});

describe("0239 bounded daily reads", () => {
  it("retains daily eligibility predicates except admitting dated and undated unknown refunds", () => {
    const old = body(originalReads, "sales_report_daily");
    const next = compact(body(migration, "sales_report_daily"));
    const predicates = executable(old).split("\n").map((line) => line.trim())
      .filter((line) => /^(where |and )/.test(line));
    expect(predicates.length).toBe(10);
    for (const predicate of predicates) {
      if (predicate.startsWith("where pm.refund_business_date")) continue;
      expect(next).toContain(compact(predicate.replace(" and pm.refund_amount_cents is not null", "")));
    }
    expect(next).not.toContain("and pm.refund_amount_cents is not null");
  });
  it("retains undated refund evidence and emits uncertainty without assigning refund money", () => {
    const daily = compact(body(migration, "sales_report_daily"));
    expect(daily).toContain("or (pm.refund_business_date is null and p.business_date <= p_to");
    expect(daily).toContain("pm.sales_refund_cents is distinct from 0");
    expect(daily).toContain("pm.refund_amount_cents is not null");
    expect(daily).toContain("pm.refund_status in ('PARTIAL', 'FULL')");
    expect(daily).toContain("pm.sales_refund_cents is null and c.accounting is not null");
    expect(daily).toContain("greatest(order_business_date, p_from) as first_possible_day");
    expect(daily).toContain("generate_series(0, p_to - p_from)");
    expect(daily).toContain("u.first_possible_day <= p_from + days.offset_days");
    expect(daily).toContain("'count', 0, 'refund_cents', 0, 'refund_tip_cents', 0, 'sales_refund_cents', null, 'sales_refund_missing', sum(u.missing)");
  });
  it("keeps the 31-day guard, latest pointers and refund-date bounds with exact shop joins", () => {
    const daily = body(migration, "sales_report_daily");
    expect(daily).toContain("perform public.sales_report_assert_window(p_location_id, p_from, p_to)");
    expect(originalReads).toContain("p_to - p_from > 30");
    expect(daily).toContain("public.sales_report_facts(p_location_id, p_from, p_to)");
    expect(daily).toContain("c.snapshot_id = facts.snapshot_id and c.check_guid = facts.check_guid");
    expect(daily).toContain("p.snapshot_id = pm.snapshot_id and p.location_id = p_location_id");
    expect(daily).toContain("pm.refund_business_date between p_from and p_to");
    expect(daily).toContain("l.business_date = p.business_date");
  });
  it("keeps unknown components null and provides missing counters", () => {
    for (const field of ["gross_cents", "discounts_comps_cents", "voids_cents", "service_charges_cents"]) {
      expect(migration).toContain(`where accounting->>'${field}' is null) > 0 then null`);
    }
    expect(migration).toContain("'accounting_missing', count(*) filter");
    expect(migration).toContain("where pm.sales_refund_cents is null) > 0 then null");
    expect(migration).toContain("'sales_refund_missing', count(*) filter");
  });
  it("grants only service-role execution with security definer and pinned search path", () => {
    for (const name of ["toast_capture_page", "sales_report_daily"]) {
      expect(compact(body(migration, name)).split("$$")[0]).toMatch(/security definer set search_path\s*=\s*pg_catalog,\s*public/);
    }
    expect(migration).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/grant execute on function[\s\S]*to service_role;/);
    expect(executable(migration)).not.toMatch(/grant [^;]*to (?:anon|authenticated|public)\b/);
  });
});

describe("0239 sim integration harness", () => {
  it("is guarded, rollback-only, timeout bounded and contains actual modified-save dedup assertions", () => {
    expect(harness).toContain("email='maya@sim.co-ops'");
    expect(harness.trim()).toMatch(/rollback;$/);
    expect(executable(harness)).not.toMatch(/\bcommit\s*;/i);
    expect(harness).toContain("set local statement_timeout='8s'");
    for (const assertion of [
      "missing versus explicit null duplicated capture", "null-to-amount enrichment not captured",
      "enrichment retry duplicated capture", "payment reorder duplicated capture",
      "historical snapshot rewritten", "check-only correction changed modified lane",
      "full-day recapture did not publish exact accounting", "refund dated to original sale",
      "refund date or tax/tip separation incorrect", "shop isolation failed", "sale exclusions failed",
      "refund exclusions failed", "unsafe RPC grants", "unsafe snapshot grants", "32-day window accepted",
      "31-day read exceeded 8-second gate", "dated missing refund silently dropped", "ezCater fixture not linked",
      "undated refund did not poison possible days without inventing money", "undated older-sale refund silently dropped",
      "undated refund crossed shops", "stale undated snapshot poisoned exactness", "repaired refund date did not restore exact allocation",
    ]) expect(harness).toContain(`raise exception '${assertion}`);
    expect(harness.match(/public\.toast_modified_save\(loc,/g)?.length).toBe(5);
    expect(harness).toContain("perform public.sales_report_daily(loc,refund_day,refund_day+30)");
    expect(harness).toContain("elapsed:=clock_timestamp()-started");
  });
});
