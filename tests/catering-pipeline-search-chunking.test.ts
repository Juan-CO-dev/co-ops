/**
 * W23/B208 — searchPipeline put EVERY matched customer id into one `.or(customer_id.in.(...))`
 * (~250 UUIDs for "gmail" → a 9+ KB request line the gateway refuses), and its email / quote
 * enrichment reads were unchunked and ignored their errors. The fake below refuses any id list
 * over 100 (the chunk size) the way the gateway refuses a long line, pages at 1,000 rows like
 * PostgREST, and can fail the quote read on demand.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ db: {} as Record<string, Row[]>, maxIds: 0, failQuotes: false }));
const MAX_IDS = 100;

function like(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
}
function splitTop(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = "";
  for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; }
  if (cur) out.push(cur);
  return out;
}
function term(t: string): (r: Row) => boolean {
  const [col, op, ...rest] = t.split("."); const val = rest.join(".");
  if (op === "ilike") { const re = like(val); return (r) => typeof r[col!] === "string" && re.test(r[col!] as string); }
  if (op === "is") return (r) => (r[col!] ?? null) === null;
  if (op === "in") {
    const ids = val.replace(/^\(|\)$/g, "").split(",");
    state.maxIds = Math.max(state.maxIds, ids.length);
    if (ids.length > MAX_IDS) throw new Error("414 request line too long");
    return (r) => ids.includes(String(r[col!]));
  }
  throw new Error(`fake: ${t}`);
}
class Q {
  private preds: Array<(r: Row) => boolean> = [];
  private orders: Array<{ col: string; asc: boolean }> = [];
  private from = 0; private to = 999;
  constructor(private table: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.preds.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) {
    state.maxIds = Math.max(state.maxIds, vs.length);
    if (vs.length > MAX_IDS) throw new Error("414 request line too long");
    this.preds.push((r) => vs.includes(r[c])); return this;
  }
  ilike(c: string, p: string) { const re = like(p); this.preds.push((r) => typeof r[c] === "string" && re.test(r[c] as string)); return this; }
  or(expr: string) { const ps = splitTop(expr).map(term); this.preds.push((r) => ps.some((f) => f(r))); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orders.push({ col, asc: o?.ascending !== false }); return this; }
  range(a: number, b: number) { this.from = a; this.to = b; return this; }
  limit() { return this; }
  returns() { return this; }
  then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
    if (this.table === "catering_quotes" && state.failQuotes) return Promise.resolve({ data: null, error: { message: "boom" } }).then(res, rej);
    let rows = (state.db[this.table] ?? []).filter((r) => this.preds.every((p) => p(r)));
    rows = [...rows].sort((a, b) => {
      for (const o of this.orders) {
        const x = String(a[o.col]), y = String(b[o.col]);
        if (x !== y) return (x < y ? -1 : 1) * (o.asc ? 1 : -1);
      }
      return 0;
    });
    rows = rows.slice(this.from, Math.min(this.to, this.from + 999) + 1);
    return Promise.resolve({ data: rows, error: null }).then(res, rej);
  }
}

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (t: string) => new Q(t) }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/catering/ezcater-detail", () => ({
  loadCateringReader: vi.fn(async () => ({ role: "gm", active: true, locations: ["shop-a"] })),
  canReadCateringLead: vi.fn(async () => true),
}));

import { searchPipeline } from "@/lib/catering/pipeline";

const gm = { user: { id: "u-gm", role: "gm" }, role: "gm", level: 7, locations: ["shop-a"] } as unknown as AuthContext;
const uuid = (p: string, i: number) => `00000000-0000-4000-${p}-${String(i).padStart(12, "0")}`;
const N = 250;

beforeEach(() => {
  state.maxIds = 0; state.failQuotes = false;
  state.db = {
    catering_customers: [
      ...Array.from({ length: N }, (_, i) => ({ id: uuid("8000", i), email: `p${i}@gmail.com`, phone: null, name: `P ${i}`, primary_location_id: "shop-a", company_id: null })),
      // another shop's customer: must neither match nor be returned
      { id: uuid("9000", 1), email: "other@gmail.com", phone: null, name: "Other", primary_location_id: "shop-b", company_id: null },
    ],
    catering_companies: [],
    catering_pipeline: [
      ...Array.from({ length: N }, (_, i) => ({ id: uuid("a000", i), customer_id: uuid("8000", i), contact_name: `Lead ${i}`, company: null,
        contact_phone: null, event_name: null, stage: "inquiry", location_id: "shop-a",
        created_at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T${String(i % 24).padStart(2, "0")}:00:00Z` })),
      { id: uuid("b000", 1), customer_id: uuid("9000", 1), contact_name: "Lead other", company: null, contact_phone: null, event_name: null,
        stage: "inquiry", location_id: "shop-a", created_at: "2026-10-05T00:00:00Z" },
    ],
    catering_quotes: [{ id: "q1", pipeline_id: uuid("a000", 0), status: "sent", total_cents: 1000, created_at: "2026-10-02T00:00:00Z", superseded_at: null }],
    locations: [{ id: "shop-a", name: "Shop A" }],
  };
});

describe("W23/B208 pipeline search chunks its id lists", () => {
  it("a broad term matching 250 customers returns all 250 leads, no filter over 100 ids, newest first", async () => {
    const results = await searchPipeline(gm, { query: "gmail" });
    expect(results).toHaveLength(N);
    expect(state.maxIds).toBeLessThanOrEqual(MAX_IDS);
    const created = results.map((r) => r.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
    expect(results.find((r) => r.id === uuid("a000", 0))).toMatchObject({ email: "p0@gmail.com", quoteStatus: "sent", quoteTotalCents: 1000 });
    // the other shop's customer did not match
    expect(results.some((r) => r.id === uuid("b000", 1))).toBe(false);
  });

  it("a failed quote enrichment read throws instead of silently dropping the status", async () => {
    state.failQuotes = true;
    await expect(searchPipeline(gm, { query: "gmail" })).rejects.toThrow();
  });
});
