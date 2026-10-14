/**
 * B7c · Catering owner decisions (Juan, 2026-10-13) — BEHAVIOUR through the libs and routes,
 * over an in-memory Supabase fake (same shape as tests/catering-b5-review.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const { db, writes, audit, session } = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: "update" | "insert"; patch?: Row; rows?: Row[]; count?: number }>,
  audit: vi.fn(),
  session: { ctx: null as unknown },
}));

// ── a tiny PostgREST-shaped fake ─────────────────────────────────────────────────────────
type Pred = (r: Row) => boolean;
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function parseTerm(t: string): Pred {
  const [col, op, ...rest] = t.split(".");
  const val = rest.join(".");
  if (op === "eq") return (r) => String(r[col!]) === val;
  if (op === "is") return (r) => (r[col!] ?? null) === (val === "null" ? null : val === "true");
  if (op === "in") {
    const ids = val.replace(/^\(|\)$/g, "").split(",");
    return (r) => ids.includes(String(r[col!]));
  }
  throw new Error(`fake: unsupported filter ${t}`);
}
let seq = 0;
class Q {
  private preds: Pred[] = [];
  private mode: "select" | "update" | "insert" = "select";
  private patch: Row = {};
  private toInsert: Row[] = [];
  private sortCol: string | null = null;
  private sortAsc = true;
  private max: number | null = null;
  constructor(private table: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.preds.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[c])); return this; }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.preds.push((r) => (r[c] ?? null) !== null);
    else if (op === "in") {
      const ids = String(v).replace(/^\(|\)$/g, "").split(",");
      this.preds.push((r) => !ids.includes(String(r[c])));
    } else throw new Error(`fake: unsupported not ${op}`);
    return this;
  }
  gte(c: string, v: unknown) { this.preds.push((r) => String(r[c]) >= String(v)); return this; }
  lte(c: string, v: unknown) { this.preds.push((r) => String(r[c]) <= String(v)); return this; }
  or(expr: string) { const p = splitTop(expr).map(parseTerm); this.preds.push((r) => p.some((f) => f(r))); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.sortCol = c; this.sortAsc = o?.ascending ?? true; return this; }
  limit(n: number) { this.max = n; return this; }
  returns() { return this; }
  update(patch: Row) { this.mode = "update"; this.patch = patch; return this; }
  insert(rows: Row | Row[]) { this.mode = "insert"; this.toInsert = Array.isArray(rows) ? rows : [rows]; return this; }
  private async exec(): Promise<{ data: Row[] | null; error: null; count: number }> {
    const table = (db[this.table] ??= []);
    if (this.mode === "insert") {
      const rows = this.toInsert.map((r) => ({ id: `${this.table}-${++seq}`, ...r }));
      table.push(...rows);
      writes.push({ table: this.table, op: "insert", rows });
      return { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
    }
    let matched = table.filter((r) => this.preds.every((p) => p(r)));
    if (this.mode === "update") {
      for (const r of matched) Object.assign(r, this.patch);
      writes.push({ table: this.table, op: "update", patch: this.patch, count: matched.length });
      return { data: matched.map((r) => ({ ...r })), error: null, count: matched.length };
    }
    if (this.sortCol) {
      const c = this.sortCol;
      matched = [...matched].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (this.sortAsc ? 1 : -1));
    }
    if (this.max != null) matched = matched.slice(0, this.max);
    const out = matched.map((r) => ({ ...r }));
    return { data: out, error: null, count: out.length };
  }
  maybeSingle() { return this.exec().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  single() { return this.exec().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  then<A, B>(res: (v: { data: Row[] | null; error: null; count: number }) => A, rej?: (e: unknown) => B) {
    return this.exec().then(res, rej);
  }
}
const sbFake = { from: (t: string) => new Q(t) };
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => sbFake }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/session", () => ({ requireSession: async () => session.ctx }));

import { resolveQuoteDemand } from "@/lib/catering/prep-demand";
import { expandPackageLines, type ExpandablePackage } from "@/lib/catering/quotes-shared";

// ── fixtures ─────────────────────────────────────────────────────────────────────────────
const A = "loc-a";
const gmA = { user: { id: "gm-a", role: "gm" }, role: "gm", level: 7, locations: [A] } as unknown as AuthContext;

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  writes.length = 0;
  audit.mockClear();
  session.ctx = gmA;
  db.users = [{ id: "gm-a", role: "gm", active: true }];
  db.user_locations = [{ user_id: "gm-a", location_id: A, active: true }];
}
beforeEach(seed);

// ── D-45 · the builder's package lines reserve the right number of picks ────────────────
describe("D-45 · package lines → Prep Demand", () => {
  const slotPackage = (id: string, pricingMode: string, slotQty: number): ExpandablePackage => ({
    id,
    labelEn: id,
    pricingMode,
    priceCents: 1200,
    items: [{ itemId: null, menuItemId: null, label: "Choose your sub", quantity: slotQty, unitPriceCents: 0 }],
  });
  const reserveFor = async (pkg: ExpandablePackage, headcount: string) => {
    db.catering_package_items = [
      { id: `${pkg.id}-slot`, package_id: pkg.id, slot_type: "choice", item_id: null, menu_item_id: null, quantity: pkg.items[0]!.quantity, active: true },
    ];
    db.catering_quote_item_options = [];
    db.catering_quote_items = expandPackageLines(pkg, headcount).map((l, i) => ({
      id: `qi-${i}`,
      quote_id: "q-1",
      item_id: l.itemId,
      menu_item_id: l.menuItemId,
      package_id: l.packageId,
      quantity: Number(l.quantity),
      portion: null,
    }));
    const demand = await resolveQuoteDemand(sbFake as never, "q-1");
    return demand.filter((d) => d.choicePackageItemId).reduce((s, d) => s + d.qty, 0);
  };

  it("Light Lunch for 20 reserves 20 subs to pick — not 2, and not 40", async () => {
    expect(await reserveFor(slotPackage("light-lunch", "per_head", 1), "20")).toBe(20);
  });
  it("a 16 pc platter reserves 16 subs to pick — not 16 + 256", async () => {
    expect(await reserveFor(slotPackage("platter-16", "per_platter", 16), "20")).toBe(16);
  });
});
