import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("no live client in tests"); } }));
import { loadCateringFacts } from "@/lib/report-digests";

// W26/B140: the daily catering digest reports yesterday's refunds by WHEN THE REFUND HAPPENED
// (refunded_at, migration 0333) at the amount refunded — not by paid_at.
type Row = Record<string, unknown>;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function fakeSb(tables: Record<string, Row[]>, opts: { refundColumnsMissing?: boolean } = {}) {
  const selects: Array<{ table: string; columns: string; filters: string[] }> = [];
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    const record = { table, columns: "", filters: [] as string[] };
    let missing = false;
    const q: Record<string, unknown> = {
      select: (c: string) => { record.columns = c; selects.push(record); if (opts.refundColumnsMissing && /refunded_/.test(c)) missing = true; return q; },
      order: () => q,
      eq: (k: string, v: unknown) => { record.filters.push(`eq:${k}`); rows = rows.filter(r => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { rows = rows.filter(r => r[k] !== v); return q; },
      is: (k: string, v: unknown) => { rows = rows.filter(r => (r[k] ?? null) === v); return q; },
      in: (k: string, vs: unknown[]) => { rows = rows.filter(r => vs.includes(r[k])); return q; },
      gte: (k: string, v: string) => { record.filters.push(`gte:${k}`); if (opts.refundColumnsMissing && k.startsWith("refunded_")) missing = true; rows = rows.filter(r => r[k] != null && String(r[k]) >= v); return q; },
      lte: (k: string, v: string) => { rows = rows.filter(r => r[k] != null && String(r[k]) <= v); return q; },
      lt: (k: string, v: string) => { rows = rows.filter(r => r[k] != null && String(r[k]) < v); return q; },
      not: () => q, or: () => q, limit: () => q,
      range: (a: number, b: number) => { rows = rows.slice(a, b + 1); return q; },
      maybeSingle: () => q,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(missing ? { data: null, error: { code: "42703", message: "column catering_payments.refunded_at does not exist" } } : { data: rows, error: null }).then(resolve, reject),
    };
    return q;
  };
  const rpc = () => { const r = { data: [], error: null }; const b: Record<string, unknown> = { then: (res: (v: unknown) => unknown) => Promise.resolve(r).then(res), range: () => b, order: () => b }; return b; };
  return { selects, sb: { from, rpc } as never };
}
const tables = () => ({
  locations: [],
  catering_quotes: [{ id: "q1", location_id: A }],
  catering_payments: [
    // Paid Monday, refunded Wednesday, $10 of a $100 payment refunded — reported on Thursday's digest.
    { id: "p1", quote_id: "q1", status: "refunded", amount_cents: 10000, paid_at: "2026-11-09T16:00:00Z", refunded_at: "2026-11-11T16:00:00Z", refunded_amount_cents: 1000 },
    // Refunded Tuesday: not yesterday.
    { id: "p2", quote_id: "q1", status: "refunded", amount_cents: 5000, paid_at: "2026-11-11T16:00:00Z", refunded_at: "2026-11-10T16:00:00Z", refunded_amount_cents: 5000 },
    // Refunded before 0333 with no audit row: refunded_at null, never reported.
    { id: "p3", quote_id: "q1", status: "refunded", amount_cents: 700, paid_at: "2026-11-11T17:00:00Z", refunded_at: null, refunded_amount_cents: null },
  ],
});

describe("catering digest refunds (W26/B140)", () => {
  it("reports a refund on the day it happened, at the amount refunded", async () => {
    const { sb } = fakeSb(tables());
    const facts = await loadCateringFacts(sb, "2026-11-12", new Date("2026-11-12T12:00:00Z"));
    expect(facts.refundsYesterday).toEqual([{ locationId: A, amountCents: 1000 }]);
  });
  it("before 0333 is applied, falls back to the pre-0333 read instead of failing the digest", async () => {
    const { sb, selects } = fakeSb(tables(), { refundColumnsMissing: true });
    const facts = await loadCateringFacts(sb, "2026-11-12", new Date("2026-11-12T12:00:00Z"));
    expect(selects.filter(s => s.table === "catering_payments").at(-1)?.filters).toContain("gte:paid_at");
    expect(facts.refundsYesterday).toEqual([{ locationId: A, amountCents: 5000 }, { locationId: A, amountCents: 700 }]);
  });
});
