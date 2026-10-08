/**
 * The package loader against a fake PostgREST that enforces the 1,000-row response cap (Astra P1):
 * every child read (delivery lines, credits, quotes, payments) must page with a total order, or
 * lines and dollars vanish silently. 100 deliveries × 11 lines = 1,100 lines in ONE id chunk.
 */
import { describe, expect, it } from "vitest";
import { loadPackageInput } from "@/lib/report-package";
import { purchasesSection } from "@/lib/report-package-shared";

type Row = Record<string, unknown>;
const CAP = 1000;

/** A minimal PostgREST query builder over in-memory tables: filters, order, range, and the row cap. */
function fakeDb(tables: Record<string, Row[]>) {
  const calls: Array<{ table: string; ranged: boolean; ordered: boolean }> = [];
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let orderBy: string | null = null;
    let range: [number, number] | null = null;
    const q = {
      select: () => q,
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return q; },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return q; },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return q; },
      not: (c: string, _op: string, v: unknown) => { filters.push((r) => (r[c] ?? null) !== v); return q; },
      gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return q; },
      gt: (c: string, v: number) => { filters.push((r) => Number(r[c]) > v); return q; },
      lte: (c: string, v: string) => { filters.push((r) => String(r[c]) <= v); return q; },
      lt: (c: string, v: string) => { filters.push((r) => String(r[c]) < v); return q; },
      order: (c: string) => { orderBy = c; return q; },
      range: (a: number, b: number) => { range = [a, b]; return q; },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
        calls.push({ table, ranged: !!range, ordered: !!orderBy });
        let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!])));
        if (range) rows = rows.slice(range[0], range[1] + 1);
        return resolve({ data: rows.slice(0, CAP), error: null }); // PostgREST never returns more than the cap
      },
    };
    return q;
  };
  return { db: { from } as never, calls };
}

const SHOP = "aaaaaaaa-0000-4000-8000-000000000001";
const pad = (n: number) => String(n).padStart(5, "0");

describe("child reads are paginated past the 1,000-row cap", () => {
  it("100 deliveries × 11 lines (1,100 in one chunk): every line and every cent arrives", async () => {
    const deliveries = Array.from({ length: 100 }, (_, i) => ({
      id: `d-${pad(i)}`, location_id: SHOP, vendor_id: "v1", delivery_date: "2026-10-06", invoice_number: null, invoice_total: null,
      match_state: "counted_only", delivery_status: "complete", receipt_url: null, received_by: null, purchase_order_id: null,
    }));
    const lines = deliveries.flatMap((d) => Array.from({ length: 11 }, (_, j) => ({
      id: `${d.id}-l${pad(j)}`, delivery_id: d.id, vendor_item_id: "s1", qty_received: 1, unit_price: 2, received_level_label: "each",
    })));
    const credits = Array.from({ length: 1205 }, (_, i) => ({
      id: `c-${pad(i)}`, location_id: SHOP, vendor_id: "v1", delivery_id: null, reason: "short", amount_cents: 1, status: "open", created_at: "2026-10-06T15:00:00Z",
    }));
    const { db, calls } = fakeDb({
      locations: [{ id: SHOP, code: "MEP", name: "Capitol Hill" }],
      vendor_deliveries: deliveries, vendor_delivery_items: lines, vendor_credits: credits,
      vendors: [{ id: "v1", name: "Baldor", source_kind: "vendor" }], vendor_items: [{ id: "s1", name: "Ham" }],
    });
    const input = await loadPackageInput(db, { locationIds: [SHOP], includeUnassignedLeads: false, from: "2026-10-06", to: "2026-10-06", sections: ["purchases"], baseUrl: "https://ops.example.com" });
    expect(input.deliveryLines).toHaveLength(1100);
    expect(new Set(input.deliveryLines.map((l) => l.id)).size).toBe(1100);
    expect(input.credits).toHaveLength(1205);
    const rows = purchasesSection(input);
    const linesTotal = rows.filter((r) => r.row_type === "delivery").reduce((a, r) => a + (r.lines_total as number), 0);
    expect(linesTotal).toBe(1100 * 200);
    expect(calls.filter((c) => c.table === "vendor_delivery_items").every((c) => c.ranged && c.ordered)).toBe(true);
    expect(input.loaded).toEqual(["purchases"]);
  });

  it("payments: > 1,000 for the quotes of one chunk all arrive (no understated paid / overstated outstanding)", async () => {
    const leads = Array.from({ length: 10 }, (_, i) => ({
      id: `L-${pad(i)}`, location_id: SHOP, event_date: "2026-10-06", stage: "completed", lead_source: "web", external_ref: null,
      contact_name: "x", company: null, headcount: 1, estimated_revenue_cents: 0,
    }));
    const quotes = leads.map((l, i) => ({
      id: `q-${pad(i)}`, pipeline_id: l.id, version: 1, status: "accepted", superseded_at: null, subtotal_cents: 0, delivery_fee_cents: 0,
      service_charge_cents: 0, gratuity_cents: 0, tax_cents: 0, total_cents: 200_000, deposit_cents: 0,
    }));
    const payments = quotes.flatMap((q) => Array.from({ length: 150 }, (_, j) => ({ id: `${q.id}-p${pad(j)}`, quote_id: q.id, status: "paid", provider: "stripe", amount_cents: 100 })));
    const { db } = fakeDb({ locations: [{ id: SHOP, code: "MEP", name: "Capitol Hill" }], catering_pipeline: leads, catering_quotes: quotes, catering_payments: payments });
    const input = await loadPackageInput(db, { locationIds: [SHOP], includeUnassignedLeads: false, from: "2026-10-06", to: "2026-10-06", sections: ["catering"], baseUrl: "" });
    expect(input.payments).toHaveLength(1500);
    expect(input.loaded).toEqual(["catering"]);
  });
});
