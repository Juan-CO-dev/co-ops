/**
 * B7c round 2 — BEHAVIOUR through the libs and routes over an in-memory Supabase fake (the
 * tests/catering-b5-review.test.ts fake, which evaluates the filters the code actually sends).
 *
 *   A  What every quote writer now stores in catering_quote_items.line_kind / components_listed
 *      (staff create + revise through the lib; the portal by source pin), and that
 *      resolveQuoteDemand reads the columns the legacy rules need.
 *   C  Email on Add lead: the typed address resolves the lead's catering customer through the
 *      quote flow's own resolver (resolveOrCreateContact) — existing → linked; another shop's →
 *      attached with its contact hidden (option b); none → created; the address is never logged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const { db, hooks, writes, audit, session } = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  hooks: { afterSelect: null as null | ((table: string, rows: Row[]) => void) },
  writes: [] as Array<{ table: string; op: "update" | "insert"; patch?: Row; rows?: Row[]; count?: number }>,
  audit: vi.fn(),
  session: { ctx: null as unknown },
}));

// ── a tiny PostgREST-shaped fake ─────────────────────────────────────────────────────────
type Pred = (r: Row) => boolean;
/** SQL ILIKE: % and _ wildcards, backslash escapes (escapeLike), case-insensitive. */
function likeToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "\\" && i + 1 < pattern.length) out += pattern[++i]!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (ch === "%") out += ".*";
    else if (ch === "_") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}
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
  if (t.startsWith("and(")) {
    const parts = splitTop(t.slice(4, -1)).map(parseTerm);
    return (r) => parts.every((p) => p(r));
  }
  if (t.startsWith("or(")) {
    const parts = splitTop(t.slice(3, -1)).map(parseTerm);
    return (r) => parts.some((p) => p(r));
  }
  const [col, op, ...rest] = t.split(".");
  const val = rest.join(".");
  if (op === "eq") return (r) => String(r[col!]) === val;
  if (op === "is") return (r) => (r[col!] ?? null) === (val === "null" ? null : val === "true");
  if (op === "ilike") {
    const re = likeToRegex(val);
    return (r) => typeof r[col!] === "string" && re.test(r[col!] as string);
  }
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
  constructor(private table: string) {}
  select() { return this; }
  eq(c: string, v: unknown) { this.preds.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.preds.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.preds.push((r) => vs.includes(r[c])); return this; }
  ilike(c: string, pattern: string) {
    const re = likeToRegex(pattern);
    this.preds.push((r) => typeof r[c] === "string" && re.test(r[c] as string));
    return this;
  }
  or(expr: string) { const p = splitTop(expr).map(parseTerm); this.preds.push((r) => p.some((f) => f(r))); return this; }
  order() { return this; }
  limit() { return this; }
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
    const matched = table.filter((r) => this.preds.every((p) => p(r)));
    if (this.mode === "update") {
      for (const r of matched) Object.assign(r, this.patch);
      writes.push({ table: this.table, op: "update", patch: this.patch, count: matched.length });
      return { data: matched.map((r) => ({ ...r })), error: null, count: matched.length };
    }
    const out = matched.map((r) => ({ ...r }));
    hooks.afterSelect?.(this.table, out);
    return { data: out, error: null, count: out.length };
  }
  maybeSingle() { return this.exec().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  single() { return this.exec().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  then<A, B>(res: (v: { data: Row[] | null; error: null; count: number }) => A, rej?: (e: unknown) => B) {
    return this.exec().then(res, rej);
  }
}
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (t: string) => new Q(t) }) }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/session", () => ({ requireSession: async () => session.ctx }));


import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createQuote, reviseQuote } from "@/lib/catering/quotes";
import { resolveQuoteDemand } from "@/lib/catering/prep-demand";
import { searchPipeline } from "@/lib/catering/pipeline";
import { expandPackageLines, type ExpandablePackage } from "@/lib/catering/quotes-shared";
import { normalizeLeadEmail } from "@/lib/catering/pipeline-shared";
import { POST as createLeadRoute } from "@/app/api/catering/pipeline/route";

// ── fixtures ─────────────────────────────────────────────────────────────────────────────
const A = "loc-a";
const B = "loc-b";
const gmA = { user: { id: "gm-a", role: "gm" }, role: "gm", level: 7, locations: [A] } as unknown as AuthContext;
const sbFake = { from: (t: string) => new Q(t) };

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  writes.length = 0;
  hooks.afterSelect = null;
  audit.mockClear();
  session.ctx = gmA;
  db.users = [{ id: "gm-a", role: "gm", active: true }];
  db.user_locations = [{ user_id: "gm-a", location_id: A, active: true }];
  db.catering_customers = [
    { id: "c-a", name: "Ana A", company: "Acme", email: "ana@a.test", phone: "555-A", active: true, primary_location_id: A, created_at: "2026-01-01" },
    { id: "c-b", name: "Bea B", company: "Beta", email: "bea@b.test", phone: "555-B", active: true, primary_location_id: B, created_at: "2026-01-01" },
    { id: "c-off-a", name: "Dormant A", company: null, email: "dormant@a.test", phone: null, active: false, primary_location_id: A, created_at: "2026-01-01" },
    { id: "c-off-b", name: "Dormant B", company: null, email: "dormant@b.test", phone: null, active: false, primary_location_id: B, created_at: "2026-01-01" },
  ];
  db.catering_company_domains = [];
  db.catering_companies = [];
  db.locations = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];
  db.catering_pipeline = [];
  db.catering_pipeline_events = [];
  db.catering_quotes = [];
  db.catering_quote_items = [];
  db.catering_quote_item_options = [];
  db.items = [{ id: "i-chips", active: true }];
  db.menu_items = [{ id: "m-sub", active: true }];
}
beforeEach(seed);

// ── A · what the writers store ─────────────────────────────────────────────────────────
describe("A · quote writers store the line kind", () => {
  const mix: ExpandablePackage = {
    id: "pkg-mix", labelEn: "Mix", pricingMode: "per_head", priceCents: 1800,
    items: [
      { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 0 },
      { itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 },
    ],
  };
  /** The builder's payload lines (QuotesClient.submit's shape). */
  const payload = (pkg: ExpandablePackage, headcount: string) =>
    expandPackageLines(pkg, headcount).map((l) => ({
      description: l.description, quantity: Number(l.quantity), unitPriceCents: Math.round(Number(l.unitPrice || "0") * 100),
      itemId: l.itemId, menuItemId: l.menuItemId, packageId: l.packageId, lineKind: l.lineKind, componentsListed: l.componentsListed,
    }));
  const stored = (quoteId: string) =>
    db.catering_quote_items!.filter((r) => r.quote_id === quoteId).map((r) => [r.description, r.package_id, r.line_kind, r.components_listed]);

  it("a NEW builder quote stores a kind on every package line, components_listed on the header", async () => {
    const { id } = await createQuote(gmA, { locationId: A, lines: [...payload(mix, "10"), { description: "Delivery setup", quantity: 1, unitPriceCents: 500 }] });
    expect(stored(id)).toEqual([
      ["Mix", "pkg-mix", "package_header", true],
      ["Chips", "pkg-mix", "package_component", null],
      ["Choose your sub", "pkg-mix", "package_pick", null],
      ["Delivery setup", null, null, null], // not a package line
    ]);
  });

  it("a revise carries the kinds forward", async () => {
    const { id } = await createQuote(gmA, { locationId: A, lines: payload(mix, "10") });
    const lines = db.catering_quote_items!.filter((r) => r.quote_id === id).map((r) => ({
      description: r.description as string, quantity: r.quantity as number, unitPriceCents: r.unit_price_cents as number,
      itemId: r.item_id as string | null, menuItemId: r.menu_item_id as string | null, packageId: r.package_id as string | null,
      lineKind: r.line_kind, componentsListed: r.components_listed,
    }));
    const { id: v2 } = await reviseQuote(gmA, id, { lines });
    expect(stored(v2)).toEqual(stored(id));
  });

  it("a kind that contradicts the line is a named 400 before anything is written", async () => {
    await expect(createQuote(gmA, { locationId: A, lines: [{ description: "Mix", quantity: 1, unitPriceCents: 0, itemId: "i-chips", packageId: "pkg-mix", lineKind: "package_header" }] }))
      .rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    await expect(createQuote(gmA, { locationId: A, lines: [{ description: "Mix", quantity: 1, unitPriceCents: 0, packageId: "pkg-mix", lineKind: "whole" }] }))
      .rejects.toMatchObject({ status: 400, code: "invalid_payload" });
    expect(writes.filter((w) => w.op === "insert")).toEqual([]);
  });

  it("a client without kinds (a pre-0251 tab): referenced package lines become components, bare ones stay legacy", async () => {
    const { id } = await createQuote(gmA, { locationId: A, lines: [
      { description: "Mix", quantity: 2, unitPriceCents: 1800, packageId: "pkg-mix" },
      { description: "Chips", quantity: 2, unitPriceCents: 0, itemId: "i-chips", packageId: "pkg-mix" },
    ] });
    expect(stored(id)).toEqual([["Mix", "pkg-mix", null, null], ["Chips", "pkg-mix", "package_component", null]]);
  });

  it("the portal writes its package line as a whole-package header (source pin; pricing path unchanged)", () => {
    const draft = readFileSync("lib/portal/draft.ts", "utf8");
    expect(draft).toContain(`options, lineKind: "package_header", componentsListed: false };`);
    expect(draft).toContain("line_kind: l.lineKind, components_listed: l.componentsListed,");
    expect(draft.match(/options: \[\], lineKind: null, componentsListed: null \}/g)).toHaveLength(3);
  });

  it("resolveQuoteDemand reads description, order and package labels for an OLD quote (zeroed header + placeholder → 16)", async () => {
    db.catering_packages = [{ id: "pkg-plat", label_en: "16 pc platter", label_es: null }];
    db.catering_package_items = [{ id: "plat-slot", package_id: "pkg-plat", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 16, description: "Choose your subs", display_order: 0, active: true }];
    db.catering_quote_items = [
      { id: "o1", quote_id: "q-old", package_id: "pkg-plat", item_id: null, menu_item_id: null, description: "16 pc platter", quantity: 1, unit_price_cents: 0, display_order: 0, portion: null, line_kind: null, components_listed: null },
      { id: "o2", quote_id: "q-old", package_id: "pkg-plat", item_id: null, menu_item_id: null, description: "Choose your subs", quantity: 16, unit_price_cents: 0, display_order: 1, portion: null, line_kind: null, components_listed: null },
    ];
    const d = await resolveQuoteDemand(sbFake as never, "q-old");
    expect(d).toEqual([{ itemId: null, menuItemId: null, choicePackageItemId: "plat-slot", portion: null, qty: 16 }]);
  });
});

// ── C · email on Add lead ──────────────────────────────────────────────────────────────
describe("C · Add lead takes an optional email and links the lead's customer", () => {
  const req = (body: unknown) =>
    new NextRequest("http://localhost/api/catering/pipeline", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const add = async (body: Record<string, unknown>) => {
    const res = await createLeadRoute(req({ contactName: "Typed Name", company: "Typed Co", locationId: A, ...body }));
    const json = await res.json();
    return { status: res.status, json, lead: json.id ? db.catering_pipeline!.find((l) => l.id === json.id) : undefined };
  };
  const customerWrites = () => writes.filter((w) => w.table === "catering_customers");
  let logs: string[] = [];
  beforeEach(() => {
    logs = [];
    for (const m of ["log", "warn", "error", "info"] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
    }
  });
  afterEach(() => vi.restoreAllMocks());
  /** Nothing the request produced — audit rows, console, the response — carries the address. */
  const noLeak = (email: string, ...extra: unknown[]) => {
    const all = JSON.stringify([audit.mock.calls, logs, ...extra]).toLowerCase();
    expect(all).not.toContain(email.toLowerCase());
  };
  const auditOf = (action: string) => audit.mock.calls.map((c) => c[0]).find((a) => a.action === action);

  it("matches an existing own-shop customer case-insensitively, links it, and creates nothing", async () => {
    const r = await add({ contactEmail: "  ANA@A.test " });
    expect(r.status).toBe(201);
    expect(r.lead).toMatchObject({ customer_id: "c-a", location_id: A });
    expect(customerWrites()).toEqual([]);
    expect(auditOf("catering.pipeline.create").metadata).toMatchObject({ customer_id: "c-a", customer_via: "email_existing" });
    noLeak("ana@a.test", r.json);
  });

  it("no match → creates the customer as the quote flow does (lowercased, homed at the lead's shop) and links it", async () => {
    const r = await add({ contactEmail: "New.Person@Example.test" });
    expect(r.status).toBe(201);
    const made = db.catering_customers!.find((c) => c.email === "new.person@example.test");
    expect(made).toMatchObject({ name: "Typed Name", company: "Typed Co", primary_location_id: A, active: true });
    expect(r.lead!.customer_id).toBe(made!.id);
    expect(auditOf("catering.customer.create").metadata).toEqual({ via: "lead_capture", auto_company_id: null });
    expect(auditOf("catering.pipeline.create").metadata).toMatchObject({ customer_id: made!.id, customer_via: "email_created" });
    noLeak("new.person@example.test", r.json);
  });

  it("another shop's customer is ATTACHED (option b): no duplicate, no write to it, its contact stays hidden", async () => {
    const r = await add({ contactEmail: "bea@b.test" });
    expect(r.status).toBe(201);
    expect(r.lead!.customer_id).toBe("c-b");
    expect(customerWrites()).toEqual([]);
    const found = await searchPipeline(gmA, { query: "Typed" });
    expect(found.map((x) => [x.id, x.email])).toEqual([[r.lead!.id, null]]);
    noLeak("bea@b.test", r.json, found);
  });

  it("another shop's DEACTIVATED customer is attached without reviving it", async () => {
    const r = await add({ contactEmail: "dormant@b.test" });
    expect(r.lead!.customer_id).toBe("c-off-b");
    expect(customerWrites()).toEqual([]);
    expect(db.catering_customers!.find((c) => c.id === "c-off-b")!.active).toBe(false);
  });

  it("an own-shop deactivated customer is revived and linked (one person, one row); no address in the audit", async () => {
    const r = await add({ contactEmail: "dormant@a.test" });
    expect(r.lead!.customer_id).toBe("c-off-a");
    expect(db.catering_customers!.find((c) => c.id === "c-off-a")!.active).toBe(true);
    expect(auditOf("catering.customer.activate").metadata).toEqual({ via: "lead_capture", reason: "revived_instead_of_forking_identity" });
    noLeak("dormant@a.test");
  });

  it("a blank email links nothing; a bad one is a 400 that writes nothing and never echoes the value", async () => {
    expect((await add({ contactEmail: "   " })).lead!.customer_id).toBeNull();
    writes.length = 0;
    for (const bad of ["not-an-email", `${"x".repeat(250)}@a.test`, 42]) {
      const r = await add({ contactEmail: bad });
      expect(r.status).toBe(400);
      expect(r.json.code).toBe(typeof bad === "number" ? "invalid_payload" : "invalid_email");
      noLeak(String(bad).slice(0, 40), r.json);
    }
    expect(writes).toEqual([]);
  });

  it("an explicit customerId wins over the email (no resolve, no customer write)", async () => {
    const r = await add({ customerId: "c-a", contactEmail: "someone@else.test" });
    expect(r.lead!.customer_id).toBe("c-a");
    expect(db.catering_customers!.some((c) => c.email === "someone@else.test")).toBe(false);
  });

  it("a GM cannot add a lead (or a customer) at another shop by email", async () => {
    const r = await add({ locationId: B, contactEmail: "fresh@b.test" });
    expect(r.status).toBe(403);
    expect(writes).toEqual([]);
  });

  it("normalizeLeadEmail lowercases and trims, empty → null, rejects non-addresses and > 254", () => {
    expect(normalizeLeadEmail(" A@B.Co ")).toEqual({ ok: true, value: "a@b.co" });
    expect(normalizeLeadEmail("")).toEqual({ ok: true, value: null });
    expect(normalizeLeadEmail(null)).toEqual({ ok: true, value: null });
    expect(normalizeLeadEmail("a@b")).toEqual({ ok: false });
    expect(normalizeLeadEmail("a b@c.co")).toEqual({ ok: false });
    expect(normalizeLeadEmail(`${"a".repeat(250)}@b.co`)).toEqual({ ok: false });
  });

  it("the Add lead form sends the email box, with en + es strings", () => {
    const client = readFileSync("components/catering/pipeline/PipelineClient.tsx", "utf8");
    expect(client).toContain(`contactEmail: str("contactEmail"),`);
    expect(client).toContain(`name="contactEmail" type="email"`);
    const en = JSON.parse(readFileSync("lib/i18n/en.json", "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    for (const k of ["catering.pipeline.field.email", "catering.pipeline.field.email_hint", "catering.pipeline.error.invalid_email", "catering.pipeline.error.invalid_customer"]) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(es[k]).not.toBe(en[k]);
    }
  });
});
