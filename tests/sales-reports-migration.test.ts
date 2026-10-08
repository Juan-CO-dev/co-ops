import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync("supabase/migrations/0232_reports_sales_reads.sql", "utf8").replace(/\r\n/g, "\n");
/** The executable SQL only: comments may NAME what is excluded; the code must not READ it. */
const sql = raw.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
const fns = [...sql.matchAll(/create function public\.(sales_report_\w+)\(/g)].map((m) => m[1]!);

describe("0232 Sales reads: read-only, windowed, service-role only", () => {
  it("authors no table, column, index or write", () => {
    expect(sql).not.toMatch(/\b(create table|alter table|create (unique )?index|insert into|update public|delete from|truncate)\b/i);
    expect(raw).toMatch(/NOT YET APPLIED -- GATE CC\/JUAN/);
  });
  it("every RPC asserts the shop + <= 31-day window first", () => {
    expect(fns).toEqual(expect.arrayContaining(["sales_report_daily", "sales_report_breakdown", "sales_report_check_page", "sales_report_check_detail", "sales_report_ezcater_page", "sales_report_ezcater_summary"]));
    for (const fn of fns.filter((f) => f !== "sales_report_assert_window")) {
      const body = sql.slice(sql.indexOf(`create function public.${fn}(`));
      const firstStatement = body.slice(body.indexOf("begin"), body.indexOf("begin") + 120);
      expect(firstStatement, fn).toContain("perform public.sales_report_assert_window(");
    }
    expect(sql).toContain("p_to - p_from > 30");
    expect(sql).toMatch(/p_limit < 1 or p_limit > 101/);
  });
  it("is SECURITY DEFINER with a pinned search_path, executable by service_role only; the view by nobody", () => {
    for (const fn of fns) {
      const head = sql.slice(sql.indexOf(`create function public.${fn}(`)).split("$$")[0]!;
      expect(head, fn).toContain("security definer set search_path = pg_catalog, public");
    }
    expect(sql).toMatch(/revoke all on public\.sales_report_check_facts from public, anon, authenticated, service_role;/);
    expect(sql).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated, service_role;/);
    expect(sql).not.toMatch(/grant [^;]*to (anon|authenticated|public)\b/i);
    expect(sql).not.toMatch(/grant execute on function[^;]*sales_report_assert_window/);
  });
});

describe("0232 encodes Juan's rulings in the ONE eligible-facts relation", () => {
  const view = sql.slice(sql.indexOf("create view public.sales_report_check_facts"), sql.indexOf("create function"));
  it("E-Gift Cards (reviewed provider gift_card) are their own class, never `sale`", () => {
    expect(view).toContain("when m.reviewed_at is not null and m.provider = 'gift_card' then 'gift_card'");
  });
  it("a Toast check linked to an ezCater order is `ezcater_linked` via ezcater_current_toast_links", () => {
    expect(view).toContain("from public.ezcater_current_toast_links l");
    expect(view).toContain("when lk.check_guid is not null then 'ezcater_linked'");
  });
  it("deleted orders/checks are absent; voids and excess food are classes, not sales; unreviewed labels are `unknown`", () => {
    expect(view).toContain("where not o.deleted and not c.deleted");
    expect(view).toContain("when o.voided or c.voided then 'void'");
    expect(view).toContain("when o.excess_food then 'excess_food'");
    expect(view).toContain("when m.reviewed_at is null or m.channel = 'Unknown' then 'unknown'");
  });
  it("third-party provider prefers the order's thirdPartyProviderInfo name", () => {
    expect(view).toContain("coalesce(nullif(btrim(o.third_party_provider_name), ''), m.provider)");
  });
  it("every metric that sums money filters sale_class = 'sale' (or names the class it shows)", () => {
    const breakdown = sql.slice(sql.indexOf("create function public.sales_report_breakdown("), sql.indexOf("create function public.sales_report_check_page("));
    expect((breakdown.match(/sale_class = 'sale'/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(breakdown).toContain("sale_class in ('sale', 'gift_card', 'ezcater_linked')");
  });
  it("discounts are grouped BY NAME; there is no comp partition anywhere", () => {
    expect(sql).toContain("group by coalesce(nullif(btrim(dc.name), ''), ''), nullif(btrim(dc.name), '')");
    expect(sql).not.toMatch(/\bcomps?\b/i);
  });
  it("employee credit is the ORDER's server; the payment server is never read", () => {
    expect(sql).toContain("o.server_guid");
    expect(sql).toContain("group by coalesce(f.server_guid, '')");
    expect(sql).not.toMatch(/pm\.server_guid/);
  });
  it("ezCater revenue = ezCater orders by event date with the reconciliation eligibility", () => {
    expect(sql).toContain("e.event_date between p_from and p_to and coalesce(cp.location_id, e.location_id) = p_location_id");
    expect(sql).toContain("lower(coalesce(e.status, '')) !~ '(cancel|reject|fail)'");
  });
  it("refunds are dated by refund business date through the latest pointer", () => {
    expect(sql).toContain("pm.refund_business_date between p_from and p_to");
    expect(sql).toContain("join public.toast_order_latest_pointers p on p.snapshot_id = pm.snapshot_id");
  });
});

describe("0232 reads no PII, card data or free text", () => {
  it("never touches contacts, notes, reason text, approvers, or customer/card fields", () => {
    for (const banned of ["ezcater_order_contacts", "contact", "special_instructions", "note_to_caterer", "reason_name", "approver_guid",
      "email", "phone", "last_name", "customer", "card_number", "last4", "toast_catering_orders"]) {
      expect(sql, banned).not.toContain(banned);
    }
  });
  it("server names are Toast FIRST names only", () => {
    expect(sql).toContain("employee_first_name");
    expect(sql).not.toMatch(/employee_(last|full)_name/);
  });
});
