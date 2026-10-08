import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync("supabase/migrations/0232_reports_sales_reads.sql", "utf8").replace(/\r\n/g, "\n");
/** The executable SQL only: comments may NAME what is excluded; the code must not READ it. */
const sql = raw.split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
const body = (fn: string) => {
  const start = sql.indexOf(`create function public.${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  const end = sql.indexOf("create function", start + 10);
  return sql.slice(start, end === -1 ? sql.indexOf("revoke all on function") : end);
};
const RPCS = ["sales_report_daily", "sales_report_breakdown", "sales_report_check_page", "sales_report_check_detail",
  "sales_report_ezcater_page", "sales_report_ezcater_summary", "sales_report_catering_values"];
const HELPERS = ["sales_report_class", "sales_report_discount_counts", "sales_report_facts"];

describe("0232 Sales reads: read-only, windowed, service-role only", () => {
  it("authors no table, column, index, view or write", () => {
    expect(sql).not.toMatch(/\b(create table|alter table|create (unique )?index|insert into|update public|delete from|truncate|create view)\b/i);
    expect(raw).toMatch(/NOT YET APPLIED -- GATE CC\/JUAN/);
  });
  it("every RPC asserts the shop + <= 31-day window first", () => {
    for (const fn of RPCS) {
      const b = body(fn);
      expect(b.slice(b.indexOf("begin"), b.indexOf("begin") + 120), fn).toContain("perform public.sales_report_assert_window(");
    }
    expect(sql).toContain("p_to - p_from > 30");
    expect(sql).toMatch(/p_limit < 1 or p_limit > 101/);
  });
  it("RPCs are SECURITY DEFINER with a pinned search_path, executable by service_role only; helpers by nobody", () => {
    for (const fn of [...RPCS, "sales_report_assert_window"]) expect(body(fn).split("$$")[0], fn).toContain("security definer set search_path = pg_catalog, public");
    // Helpers stay inlinable: plain sql, no definer, no SET; every table reference schema-qualified.
    for (const fn of HELPERS) {
      const b = body(fn);
      expect(b.split("$$")[0], fn).toMatch(/language sql (stable|immutable) as $/m);
      expect(b, fn).not.toMatch(/security definer|\bset search_path/);
      expect(b.match(/\b(from|join)\s+(?!public\.|lateral\b|jsonb_array_elements\(|\()\w+/g), fn).toBeNull();
    }
    expect(sql).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated, service_role;/);
    const grant = sql.slice(sql.indexOf("grant execute on function"), sql.indexOf("to service_role;"));
    for (const fn of RPCS) expect(grant).toContain(fn);
    for (const fn of [...HELPERS, "sales_report_assert_window"]) expect(grant).not.toContain(`${fn}(`);
    expect(sql).not.toMatch(/grant [^;]*to (anon|authenticated|public)\b/i);
  });
});

describe("Astra P2-5/P2-6: every internal read is bounded by the caller's shop + window", () => {
  it("the facts relation reads pointers AND the ezCater link set for this shop + window only", () => {
    const f = body("sales_report_facts");
    expect(f).toContain("where p.location_id = p_location_id and p.business_date between p_from and p_to");
    expect(f).toContain("where l.location_id = p_location_id and l.business_date between p_from and p_to");
  });
  it("every RPC reads facts through the bounded function, never an unparameterised view", () => {
    for (const fn of ["sales_report_daily", "sales_report_breakdown", "sales_report_check_page", "sales_report_check_detail"]) {
      expect(body(fn), fn).toContain("public.sales_report_facts(p_location_id, p_");
    }
    expect(sql).not.toContain("sales_report_check_facts");
  });
  it("labor names come from this window's time entries (+-1 day), never the whole history", () => {
    const names = sql.match(/from public\.toast_time_entries t[\s\S]*?(order by|limit)/g) ?? [];
    expect(names.length).toBe(3);
    for (const n of names) expect(n).toMatch(/t\.business_date between p_(from|business_date) - 1 and p_(to|business_date) \+ 1/);
  });
  it("catering values are read per window from the pipeline (not catering_insights_window over all history)", () => {
    const c = body("sales_report_catering_values");
    expect(c).toContain("where p.location_id = p_location_id and p.event_date between p_from and p_to");
    expect(c).toContain("'completed_unvalued', count(*) filter (where stage = 'completed' and value_cents is null)");
    expect(sql).not.toContain("catering_insights_window");
  });
  it("detail link lookups are bounded to the shop + business date", () => {
    expect(body("sales_report_check_detail")).toContain("where l.location_id = p_location_id and l.business_date = p_business_date");
  });
});

describe("0232 encodes Juan's rulings and one classifier", () => {
  it("the classifier: void, excess food, E-Gift Card, ezCater-linked, else sale", () => {
    const c = body("sales_report_class");
    expect(c.indexOf("'void'")).toBeLessThan(c.indexOf("'excess_food'"));
    expect(c).toContain("when p_reviewed and p_provider = 'gift_card' then 'gift_card'");
    expect(c).toContain("when p_ezcater_linked then 'ezcater_linked'");
  });
  it("facts AND refunds both classify through sales_report_class (Astra P2-3)", () => {
    expect(body("sales_report_facts")).toContain("public.sales_report_class(o.voided or c.voided, o.excess_food, m.reviewed_at is not null, m.provider, lk.check_guid is not null)");
    const daily = body("sales_report_daily");
    const refunds = daily.slice(daily.indexOf("'refunds'"), daily.indexOf("'captured_days'"));
    expect(refunds).toContain("public.sales_report_class(o.voided or c.voided, o.excess_food, m.reviewed_at is not null, m.provider,");
    expect(refunds).toContain("= 'sale'");
    expect(refunds).toContain("pm.refund_business_date between p_from and p_to");
    expect(refunds).toContain("l.business_date = p.business_date");
  });
  it("discounts on voided/deleted lines never count (Astra P2-4), everywhere a discount is summed or filtered", () => {
    const d = body("sales_report_discount_counts");
    expect(d).toContain("p_selection_guid is null or exists");
    expect(d).toContain("not coalesce((s->>'voided')::boolean, false) and not coalesce((s->>'deleted')::boolean, false)");
    for (const fn of ["sales_report_daily", "sales_report_breakdown", "sales_report_check_page", "sales_report_check_detail"]) {
      expect(body(fn), fn).toContain("public.sales_report_discount_counts(f.selection_units, f.check_guid, dc.selection_guid)");
    }
  });
  it("unknown tax / tip / discount amounts are counted (Astra P2-10)", () => {
    const daily = body("sales_report_daily");
    expect(daily).toContain("'tax_missing', count(*) filter (where tax_cents is null)");
    expect(daily).toContain("'tip_missing', count(*) filter (where pm.tip_cents is null)");
    expect(daily).toContain("'amount_missing', count(*) filter (where dc.amount_cents is null)");
  });
  it("third-party provider prefers the order's thirdPartyProviderInfo name; unreviewed labels are unknown", () => {
    const f = body("sales_report_facts");
    expect(f).toContain("coalesce(nullif(btrim(o.third_party_provider_name), ''), m.provider)");
    expect(f).toContain("when m.reviewed_at is null or m.channel = 'Unknown' then 'unknown'");
    expect(f).toContain("not o.deleted and not c.deleted");
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
  it("ezCater revenue = ezCater subtotal AS REPORTED by event date; discounts never subtracted", () => {
    expect(sql).toContain("e.event_date between p_from and p_to and coalesce(cp.location_id, e.location_id) = p_location_id");
    expect(sql).not.toMatch(/subtotal_cents\s*-/);
    expect(raw).toMatch(/unverified \(no discounted ezCater order exists yet\)/);
  });
  it("the header says plainly this is NOT reconciled net sales", () => {
    expect(raw).toMatch(/does NOT compute reconciled net sales/);
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
