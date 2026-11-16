import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no live client in tests"); } }));
import { loadCateringFacts } from "@/lib/report-digests";

// W26/B140 (review r1): the daily catering digest reports every refund EVENT on the day it
// happened, at what THAT refund gave back (catering_payment_refund_events, migration 0333) —
// partial refunds included; never the whole payment on the day it flipped to refunded.
type Row = Record<string, unknown>;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fakeSb(tables: Record<string, Row[]>, opts: { refundTableMissing?: string } = {}) {
  const selects: Array<{ table: string; columns: string; filters: string[] }> = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const record = { table, columns: "", filters: [] as string[] };
    let missing = false;
    const q: Record<string, unknown> = {
      select: (c: string) => { record.columns = c; selects.push(record); if (opts.refundTableMissing && table === "catering_payment_refund_events") missing = true; return q; },
      order: () => q,
      eq: (k: string, v: unknown) => { record.filters.push(`eq:${k}`); rows = rows.filter(r => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] !== v); return q; },
      is: (k: string, v: unknown) => { rows = rows.filter(r => (r[k] ?? null) === v); return q; },
      in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return q; },
      gte: (k: string, v: string) => { record.filters.push(`gte:${k}`); rows = rows.filter(r => r[k] != null && String(r[k]) >= v); return q; },
      lte: (k: string, v: string) => { rows = rows.filter(r => r[k] != null && String(r[k]) <= v); return q; },
      lt: (k: string, v: string) => { rows = rows.filter(r => r[k] != null && String(r[k]) < v); return q; },
      not: () => q, or: () => q, limit: () => q,
      range: (a: number, b: number) => { rows = rows.slice(a, b + 1); return q; },
      maybeSingle: () => q,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(missing ? { data: null, error: { code: opts.refundTableMissing, message: "relation catering_payment_refund_events does not exist" } } : { data: rows, error: null }).then(resolve, reject),
    };
    return q;
  };
  const rpc = () => { const r = { data: [], error: null }; const b: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(r).then(res), range: () => b, order: () => b }; return b; };
  return { selects, sb: { from, rpc } as never };
}
// One $100 payment (p1): $10 refunded Tuesday 11-10, the remaining $90 Wednesday 11-11 (the
// row flipped to refunded Wednesday). A second payment (p2, $50) refunded whole Wednesday.
// A pre-0333 refunded row (p3) has no event and is never reported.
const tables = (eventsOrder: "in_order" | "reversed" = "in_order") => {
  const events = [
    { stripe_event_id: "evt_tue", payment_id: "p1", refunded_at: "2026-11-10T16:00:00Z", cumulative_refunded_cents: 1000 },
    { stripe_event_id: "evt_wed", payment_id: "p1", refunded_at: "2026-11-11T16:00:00Z", cumulative_refunded_cents: 10000 },
    { stripe_event_id: "evt_p2", payment_id: "p2", refunded_at: "2026-11-11T18:00:00Z", cumulative_refunded_cents: 5000 },
  ];
  return {
    locations: [],
    catering_quotes: [{ id: "q1", location_id: A }],
    catering_payment_refund_events: eventsOrder === "in_order" ? events : [...events].reverse(),
    catering_payments: [
      { id: "p1", quote_id: "q1", status: "refunded", amount_cents: 10000, paid_at: "2026-11-09T16:00:00Z" },
      { id: "p2", quote_id: "q1", status: "refunded", amount_cents: 5000, paid_at: "2026-11-11T16:00:00Z" },
      { id: "p3", quote_id: "q1", status: "refunded", amount_cents: 700, paid_at: "2026-11-11T17:00:00Z" },
    ],
  };
};

describe("catering digest refunds (W26/B140)", () => {
  it("a $10 partial refund Tuesday is reported in Wednesday's digest as $10", async () => {
    const { sb } = fakeSb(tables());
    const facts = await loadCateringFacts(sb, "2026-11-11", new Date("2026-11-11T12:00:00Z"));
    expect(facts.refundsYesterday).toEqual([{ locationId: A, amountCents: 1000 }]);
  });
  it("the remaining $90 Wednesday is reported in Thursday's digest as $90 (not $100), beside a whole $50 refund", async () => {
    const { sb } = fakeSb(tables());
    const facts = await loadCateringFacts(sb, "2026-11-12", new Date("2026-11-12T12:00:00Z"));
    expect(facts.refundsYesterday).toEqual([{ locationId: A, amountCents: 9000 }, { locationId: A, amountCents: 5000 }]);
  });
  it("the per-event amount follows the events' own time, not the order the rows were stored in", async () => {
    const { sb } = fakeSb(tables("reversed"));
    const facts = await loadCateringFacts(sb, "2026-11-12", new Date("2026-11-12T12:00:00Z"));
    expect(facts.refundsYesterday).toEqual([{ locationId: A, amountCents: 9000 }, { locationId: A, amountCents: 5000 }]);
  });
  it.each(["42P01", "PGRST205"])("before 0333 is applied (%s), falls back to the pre-0333 read instead of failing the digest", async (code) => {
    const { sb, selects } = fakeSb(tables(), { refundTableMissing: code });
    const facts = await loadCateringFacts(sb, "2026-11-12", new Date("2026-11-12T12:00:00Z"));
    expect(selects.filter(s => s.table === "catering_payments").at(-1)?.filters).toContain("gte:paid_at");
    expect(facts.refundsYesterday).toEqual([{ locationId: A, amountCents: 5000 }, { locationId: A, amountCents: 700 }]);
  });
  // Review r2: a backfilled partial refund can carry a LATER (approximate, delivery) time than the
  // final refund's own event time. The amount follows the charge's cumulative figure, so the
  // final refund is still $90 — the payment's whole history is read, not only rows stamped
  // before the end of yesterday.
  it("a final refund is $90 even when the earlier $10 partial row is stamped after it (review r2)", async () => {
    const t = tables();
    t.catering_payment_refund_events = [
      { stripe_event_id: "audit:partial", payment_id: "p1", refunded_at: "2026-11-12T16:00:00Z", cumulative_refunded_cents: 1000 },
      { stripe_event_id: "evt_wed", payment_id: "p1", refunded_at: "2026-11-11T16:00:00Z", cumulative_refunded_cents: 10000 },
    ];
    const { sb } = fakeSb(t);
    const facts = await loadCateringFacts(sb, "2026-11-12", new Date("2026-11-12T12:00:00Z"));
    expect(facts.refundsYesterday).toEqual([{ locationId: A, amountCents: 9000 }]);
  });
});
