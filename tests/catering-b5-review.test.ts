/**
 * B5 review (Astra, 2026-10-13) — BEHAVIOUR tests over an in-memory Supabase fake.
 *
 *   P1a  loadQuoteParties authorizes the customer and the lead on their own: a quote at shop A
 *        that names shop B's customer (or a lead since moved to B) does not disclose it.
 *   P1b  createQuote / reviseQuote refuse a customer outside the actor's readable shops
 *        (the create gap pre-existed on main: any body `customerId` was accepted).
 *   P1c  loadCustomer lists a customer's leads by relationship but drops any lead whose own
 *        shop the actor cannot read — on BOTH branches of the relationship filter.
 *   P2   linkLeadToCustomer binds its UPDATE to the location it authorized: a transfer racing
 *        the write leaves the lead untouched and writes no audit row.
 *
 * Review 2 (Astra, 2026-10-14) as amended by JUAN'S OPTION B (2026-10-14), driven through the
 * real ROUTES:
 *   - A typed email that resolves to another shop's customer ATTACHES it (no duplicate row),
 *     a deactivated one WITHOUT reviving it (no write to shop B's book), and every read path
 *     hides its saved contact data: quote detail (clientHidden), Send (recipient null,
 *     recipientHidden), the customer page, the lead link.
 *   - A raw `customerId` the actor cannot read (a crafted body) is still refused.
 *
 * The fake evaluates the filters the code actually sends (eq / is / in / the `.or()` grammar
 * used by customerLeadsFilter), so a dropped scope predicate shows up as a wrong row set.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const { db, hooks, writes, audit, sendEmail, session } = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  hooks: { afterSelect: null as null | ((table: string, rows: Row[]) => void) },
  writes: [] as Array<{ table: string; op: "update" | "insert"; patch?: Row; rows?: Row[]; count?: number }>,
  audit: vi.fn(),
  sendEmail: vi.fn(),
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
vi.mock("@/lib/email", () => ({ sendEmail }));
vi.mock("@/lib/session", () => ({ requireSession: async () => session.ctx }));
vi.mock("@/lib/admin/step-up", () => ({ assertStepUp: () => ({ ok: true }) }));

import { NextRequest } from "next/server";
import { createQuote, linkLeadToCustomer, loadQuoteParties, reviseQuote, sendQuote } from "@/lib/catering/quotes";
import { loadCustomer } from "@/lib/catering/customers";
import { searchPipeline } from "@/lib/catering/pipeline";
import { POST as createQuoteRoute } from "@/app/api/catering/quotes/route";
import { POST as sendQuoteRoute } from "@/app/api/catering/quotes/[id]/send/route";
import { GET as getQuoteRoute } from "@/app/api/catering/quotes/[id]/route";

// ── fixtures ─────────────────────────────────────────────────────────────────────────────
const A = "loc-a";
const B = "loc-b";
const gmA = { user: { id: "gm-a", role: "gm" }, role: "gm", level: 7, locations: [A] } as unknown as AuthContext;

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  writes.length = 0;
  hooks.afterSelect = null;
  audit.mockClear();
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ id: "email-1" });
  session.ctx = gmA;
  db.users = [{ id: "gm-a", role: "gm", active: true }];
  db.user_locations = [{ user_id: "gm-a", location_id: A, active: true }];
  db.catering_customers = [
    { id: "c-a", name: "Ana A", company: "Acme", email: "ana@a.test", phone: "555-A", active: true, primary_location_id: A },
    { id: "c-b", name: "Bea B", company: "Beta", email: "bea@b.test", phone: "555-B", active: true, primary_location_id: B },
    { id: "c-g", name: "Gus G", company: null, email: "gus@g.test", phone: null, active: true, primary_location_id: null },
    { id: "c-off", name: "Old A", company: null, email: null, phone: null, active: false, primary_location_id: A },
    { id: "c-off-a", name: "Dormant A", company: null, email: "dormant@a.test", phone: null, active: false, primary_location_id: A },
    { id: "c-off-b", name: "Dormant B", company: null, email: "dormant@b.test", phone: null, active: false, primary_location_id: B },
  ];
  db.catering_pipeline = [];
  db.catering_quotes = [];
  db.catering_quote_items = [];
  db.catering_orders = [];
}
const lead = (id: string, customer_id: string | null, location_id: string | null): Row => ({
  id, customer_id, location_id, contact_name: `Contact ${id}`, company: null, event_date: "2026-10-30", headcount: 10, stage: "inquiry", created_at: "2026-10-01",
});
const line = [{ description: "Box lunch", quantity: 10, unitPriceCents: 1200 }];
const quoteWrites = () => writes.filter((w) => w.table === "catering_quotes");

beforeEach(seed);

describe("P1a — quote parties are authorized per side", () => {
  it("a shop-A quote naming shop B's customer does not disclose that customer", async () => {
    const parties = await loadQuoteParties(gmA, { id: "q", customerId: "c-b", pipelineId: null });
    expect(parties.client).toBeNull();
    expect(JSON.stringify(parties)).not.toMatch(/Bea|bea@b\.test|Beta/);
  });
  it("shows a global customer and an own-shop customer (whitelisted fields only)", async () => {
    expect((await loadQuoteParties(gmA, { id: "q", customerId: "c-g", pipelineId: null })).client).toEqual({ id: "c-g", name: "Gus G", company: null, email: "gus@g.test" });
    expect((await loadQuoteParties(gmA, { id: "q", customerId: "c-a", pipelineId: null })).client).toEqual({ id: "c-a", name: "Ana A", company: "Acme", email: "ana@a.test" });
  });
  it("omits a lead that now lives at another shop, shows one at the actor's shop", async () => {
    db.catering_pipeline!.push(lead("l-b", null, B), lead("l-a", null, A));
    expect((await loadQuoteParties(gmA, { id: "q", customerId: null, pipelineId: "l-b" })).lead).toBeNull();
    expect((await loadQuoteParties(gmA, { id: "q", customerId: null, pipelineId: "l-a" })).lead).toMatchObject({ id: "l-a", contactName: "Contact l-a" });
  });
  it("fails closed when the reader cannot be loaded (deactivated actor)", async () => {
    db.users![0]!.active = false;
    db.catering_pipeline!.push(lead("l-a", null, A));
    expect(await loadQuoteParties(gmA, { id: "q", customerId: "c-a", pipelineId: "l-a" })).toEqual({ client: null, lead: null, clientHidden: true });
  });
});

describe("P1b — a quote may only name a customer the actor can read", () => {
  it("create refuses shop B's customer before any write (pre-existing gap on main)", async () => {
    await expect(createQuote(gmA, { locationId: A, pipelineId: null, customerId: "c-b", lines: line }))
      .rejects.toMatchObject({ status: 400, code: "invalid_customer" });
    expect(quoteWrites()).toEqual([]);
  });
  it("create refuses a missing or deactivated customer with the SAME answer (no existence oracle)", async () => {
    await expect(createQuote(gmA, { locationId: A, customerId: "nope", lines: line })).rejects.toMatchObject({ status: 400, code: "invalid_customer" });
    await expect(createQuote(gmA, { locationId: A, customerId: "c-off", lines: line })).rejects.toMatchObject({ status: 400, code: "invalid_customer" });
    expect(quoteWrites()).toEqual([]);
  });
  it("create accepts a global customer and links the customer-less lead", async () => {
    db.catering_pipeline!.push(lead("l-a", null, A));
    const { id } = await createQuote(gmA, { locationId: A, pipelineId: "l-a", customerId: "c-g", lines: line });
    expect(db.catering_quotes!.find((q) => q.id === id)).toMatchObject({ customer_id: "c-g", location_id: A });
    expect(db.catering_pipeline!.find((l) => l.id === "l-a")!.customer_id).toBe("c-g");
  });
  it("create still refuses shop B's customer named by a raw customerId even if it carries B's email elsewhere", async () => {
    // emailAttach is server-set; a mismatching typed email does not unlock another customer either.
    await expect(createQuote(gmA, { locationId: A, customerId: "c-b", emailAttach: { email: "someone@else.test" }, lines: line }))
      .rejects.toMatchObject({ status: 400, code: "invalid_customer" });
    expect(quoteWrites()).toEqual([]);
  });
  it("revise carries an email-attached shop-B customer forward (option b) without revealing it", async () => {
    db.catering_quotes!.push({ id: "q1", root_id: null, version: 1, location_id: A, pipeline_id: null, customer_id: "c-b", superseded_at: null });
    await expect(reviseQuote(gmA, "q1", { lines: line })).resolves.toMatchObject({ version: 2 });
    expect(db.catering_quotes!.at(-1)).toMatchObject({ customer_id: "c-b", version: 2 });
  });
  it("revise keeps a customer that was only deactivated (it is still the quote's own client)", async () => {
    db.catering_quotes!.push({ id: "q1", root_id: null, version: 1, location_id: A, pipeline_id: null, customer_id: "c-off", superseded_at: null });
    await expect(reviseQuote(gmA, "q1", { lines: line })).resolves.toMatchObject({ version: 2 });
  });
});

describe("P1c — a customer's leads are filtered by the lead's own shop", () => {
  beforeEach(() => {
    db.catering_pipeline!.push(
      lead("l1-linked-a", "c-g", A),       // linked, own shop → shown
      lead("l2-linked-b", "c-g", B),       // linked, transferred to B → hidden
      lead("l3-quote-b", null, B),         // reached via a quote, lives at B → hidden
      lead("l4-quote-a", null, A),         // reached via a quote, own shop → shown
      lead("l5-unrelated-a", null, A),     // no relationship → not listed
      lead("l6-other-customer", "c-a", A), // a quote points at it but it belongs to another customer → not listed
    );
    db.catering_quotes!.push(
      { id: "qa", customer_id: "c-g", location_id: A, pipeline_id: "l3-quote-b", superseded_at: null, version: 1, status: "draft", event_date: null, total_cents: 100 },
      { id: "qb", customer_id: "c-g", location_id: A, pipeline_id: "l4-quote-a", superseded_at: null, version: 1, status: "draft", event_date: null, total_cents: 100 },
      { id: "qc", customer_id: "c-g", location_id: A, pipeline_id: "l6-other-customer", superseded_at: null, version: 1, status: "draft", event_date: null, total_cents: 100 },
      { id: "qd", customer_id: "c-g", location_id: B, pipeline_id: null, superseded_at: null, version: 1, status: "sent", event_date: null, total_cents: 999 },
    );
  });
  it("an A-only GM sees only the leads at A (both branches of the relationship filter)", async () => {
    const detail = await loadCustomer(gmA, "c-g");
    expect(detail!.leads.map((l) => l.id).sort()).toEqual(["l1-linked-a", "l4-quote-a"]);
    expect(JSON.stringify(detail)).not.toMatch(/l2-linked-b|l3-quote-b/);
    expect(detail!.quotes.map((q) => q.id).sort()).toEqual(["qa", "qb", "qc"]); // qd is at B
  });
  it("lists no leads when the reader cannot be loaded (fail-closed)", async () => {
    db.user_locations = [];
    db.users![0]!.active = false;
    expect((await loadCustomer(gmA, "c-g"))!.leads).toEqual([]);
  });
});

describe("P2 — the lead link is bound to the location it authorized", () => {
  const args = { pipelineId: "l-a", customerId: "c-a", quoteId: "q", context: "quote_create" as const };
  it("links and audits when nothing moved", async () => {
    db.catering_pipeline!.push(lead("l-a", null, A));
    await linkLeadToCustomer(gmA, args);
    expect(db.catering_pipeline![0]!.customer_id).toBe("c-a");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.pipeline.edit", resourceId: "l-a" }));
  });
  it("a transfer to shop B between the read and the UPDATE writes nothing and audits nothing", async () => {
    db.catering_pipeline!.push(lead("l-a", null, A));
    hooks.afterSelect = (table) => {
      if (table === "catering_pipeline") db.catering_pipeline![0]!.location_id = B; // the race
    };
    await linkLeadToCustomer(gmA, args);
    expect(db.catering_pipeline![0]).toMatchObject({ location_id: B, customer_id: null });
    expect(writes.find((w) => w.table === "catering_pipeline")).toMatchObject({ op: "update", count: 0 });
    expect(audit).not.toHaveBeenCalled();
  });
  it("a global lead moved to a shop mid-flight is not written either", async () => {
    db.catering_pipeline!.push(lead("l-a", null, null));
    hooks.afterSelect = (table) => {
      if (table === "catering_pipeline") db.catering_pipeline![0]!.location_id = B;
    };
    await linkLeadToCustomer(gmA, { ...args, customerId: "c-g" });
    expect(db.catering_pipeline![0]!.customer_id).toBeNull();
    expect(audit).not.toHaveBeenCalled();
  });
});

// ── Review 2 — through the routes ────────────────────────────────────────────────────────
const json = (url: string, body: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("R2 + option b — Send on a quote whose client is another shop's customer", () => {
  beforeEach(() => {
    db.catering_quotes!.push(
      { id: "q-b", location_id: A, status: "draft", superseded_at: null, customer_id: "c-b", total_cents: 12000, expires_at: null },
      { id: "q-a", location_id: A, status: "draft", superseded_at: null, customer_id: "c-a", total_cents: 12000, expires_at: null },
    );
  });
  it("delivers to the customer but never returns or logs the address", async () => {
    const res = await sendQuoteRoute(json("/api/catering/quotes/q-b/send", {}), params("q-b"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, emailed: true, emailOutcome: "sent", recipient: null, recipientHidden: true });
    expect(JSON.stringify(body)).not.toMatch(/bea@b\.test|Bea/);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "bea@b.test" }));
    expect(db.catering_quotes!.find((q) => q.id === "q-b")).toMatchObject({ status: "sent" });
    const sendAudit = audit.mock.calls.map((c) => c[0]).find((a) => a.action === "catering.quote.send");
    expect(sendAudit.metadata).toMatchObject({ recipient: null, recipient_hidden: true });
    expect(JSON.stringify(sendAudit)).not.toMatch(/bea@b\.test/);
  });
  it("a provider error that quotes the address is scrubbed before the audit row and the result", async () => {
    sendEmail.mockResolvedValue({ error: "Invalid `to` field: Bea@B.test is on the suppression list (bea%40b.test)" });
    const r = await sendQuote(gmA, "q-b");
    expect(r.emailError).toBe("Invalid `to` field: [email] is on the suppression list ([email])");
    const sendAudit = audit.mock.calls.map((c) => c[0]).find((a) => a.action === "catering.quote.send");
    expect(JSON.stringify(sendAudit)).not.toMatch(/bea(@|%40)b\.test/i);
    expect(JSON.stringify(r)).not.toMatch(/bea(@|%40)b\.test/i);
  });
  it("a failed delivery does not leak it either", async () => {
    sendEmail.mockResolvedValue({ error: "boom" });
    const r = await sendQuote(gmA, "q-b");
    expect(r).toMatchObject({ emailed: false, emailOutcome: "send_failed", recipient: null, recipientHidden: true });
  });
  it("an own-shop customer still sends and returns its own recipient", async () => {
    const res = await sendQuoteRoute(json("/api/catering/quotes/q-a/send", {}), params("q-a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, emailed: true, emailOutcome: "sent", recipient: "ana@a.test", recipientHidden: false });
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: "ana@a.test" }));
  });
});

describe("option b — email resolution → creation through the quotes route", () => {
  const create = (body: Record<string, unknown>) =>
    createQuoteRoute(json("/api/catering/quotes", { locationId: A, contactName: "Typed", lines: line, ...body }));
  const customerWrites = () => writes.filter((w) => w.table === "catering_customers");
  const getQuote = async (id: string) => {
    const res = await getQuoteRoute(new NextRequest(`http://localhost/api/catering/quotes/${id}`), params(id));
    return { status: res.status, body: await res.json() };
  };

  it("an active shop-B customer's email ATTACHES that customer (no duplicate), hidden on the quote page", async () => {
    db.catering_pipeline!.push(lead("l-a", null, A));
    const res = await create({ contactEmail: "BEA@b.test", pipelineId: "l-a" });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(db.catering_quotes!.find((q) => q.id === id)).toMatchObject({ customer_id: "c-b", location_id: A });
    expect(db.catering_customers!.filter((c) => (c.email as string | null)?.toLowerCase() === "bea@b.test")).toHaveLength(1);
    expect(customerWrites()).toEqual([]);
    // the lead is NOT linked to an unreadable customer (that would surface B's email in pipeline search)
    expect(db.catering_pipeline!.find((l) => l.id === "l-a")!.customer_id).toBeNull();
    const detail = await getQuote(id);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ client: null, clientHidden: true });
    expect(JSON.stringify(detail.body)).not.toMatch(/bea@b\.test|Bea|Beta|555-B/);
  });
  it("a deactivated shop-B contact is attached WITHOUT reviving it; nothing in B's book is written", async () => {
    const res = await create({ contactEmail: "Dormant@B.test" });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(db.catering_quotes!.find((q) => q.id === id)).toMatchObject({ customer_id: "c-off-b" });
    expect(db.catering_customers!.find((c) => c.id === "c-off-b")!.active).toBe(false);
    expect(customerWrites()).toEqual([]);
    expect(audit.mock.calls.map((c) => c[0].action)).not.toContain("catering.customer.activate");
    expect((await getQuote(id)).body).toMatchObject({ client: null, clientHidden: true });
  });
  it("a crafted body naming shop B's customerId is refused with nothing written (email in the body or not)", async () => {
    for (const body of [{ customerId: "c-b" }, { customerId: "c-b", contactEmail: "bea@b.test" }, { customerId: "c-b", emailAttach: { email: "bea@b.test" } }]) {
      const res = await create(body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_customer");
    }
    expect(quoteWrites()).toEqual([]);
    expect(customerWrites()).toEqual([]);
  });
  it("the customer page stays closed to the A-only GM", async () => {
    await create({ contactEmail: "bea@b.test" });
    expect(await loadCustomer(gmA, "c-b")).toBeNull();
  });
  it("a deactivated own-shop contact is revived and quoted (identity kept, no fork)", async () => {
    const res = await create({ contactEmail: "dormant@a.test" });
    expect(res.status).toBe(201);
    expect(db.catering_customers!.find((c) => c.id === "c-off-a")!.active).toBe(true);
    expect(db.catering_customers!.filter((c) => c.email === "dormant@a.test")).toHaveLength(1);
    expect(db.catering_quotes!.at(-1)).toMatchObject({ customer_id: "c-off-a", location_id: A });
    expect((await getQuote(db.catering_quotes!.at(-1)!.id as string)).body).toMatchObject({ clientHidden: false, client: { id: "c-off-a" } });
  });
  it("a new email creates a contact at the quote's shop and quotes it", async () => {
    const res = await create({ contactEmail: "new@client.test" });
    expect(res.status).toBe(201);
    const created = db.catering_customers!.find((c) => c.email === "new@client.test")!;
    expect(created).toMatchObject({ primary_location_id: A, active: true });
    expect(db.catering_quotes!.at(-1)).toMatchObject({ customer_id: created.id });
  });
});

describe("review 3 — pipeline search never matches or returns another shop's customer contact", () => {
  beforeEach(() => {
    db.catering_companies = [];
    db.locations = [{ id: A, name: "Shop A" }, { id: B, name: "Shop B" }];
    db.catering_pipeline!.push(
      { ...lead("l-moved", "c-b", A), contact_name: "Zed Moved" }, // B's customer, lead transferred to A
      { ...lead("l-own", "c-a", A), contact_name: "Yan Own" },
    );
  });
  it("finds the readable lead by its own name but omits the other shop's customer email", async () => {
    const results = await searchPipeline(gmA, { query: "Zed" });
    expect(results.map((r) => r.id)).toEqual(["l-moved"]);
    expect(results[0]!.email).toBeNull();
    expect(JSON.stringify(results)).not.toMatch(/bea@b\.test|555-B/);
  });
  it("an unreadable customer's email or phone does not match (no confirmation oracle)", async () => {
    expect(await searchPipeline(gmA, { query: "bea@b.test" })).toEqual([]);
    expect(await searchPipeline(gmA, { query: "555-B" })).toEqual([]);
  });
  it("an own-shop customer still matches by email and returns it", async () => {
    const results = await searchPipeline(gmA, { query: "ana@a.test" });
    expect(results.map((r) => [r.id, r.email])).toEqual([["l-own", "ana@a.test"]]);
  });
});
