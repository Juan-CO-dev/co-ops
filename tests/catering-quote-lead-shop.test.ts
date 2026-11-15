/**
 * Audit W05 / B011 — a quote made for a lead is priced and authorized at the LEAD'S shop.
 *
 * 0225's `catering_quotes_bind_location` trigger rebinds a new quote's `location_id` to its lead's current
 * shop. createQuote authorized and priced at the body's `locationId` and never read the lead, so a catering
 * manager who holds only shop A could pick a shop-B lead (their lead board is all shops), keep the shop
 * selector on A, and save a quote that was approved and priced under A's rules and then filed at B.
 *
 * BEHAVIOUR tests over an in-memory Supabase fake (the grammar of tests/catering-b5-review.test.ts). The fake
 * runs the trigger's rebind on insert, so "where did the quote land" is observable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const { db, writes, audit, session } = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; op: "update" | "insert"; rows?: Row[] }>,
  audit: vi.fn(),
  session: { ctx: null as unknown },
}));

// ── a tiny PostgREST-shaped fake ─────────────────────────────────────────────────────────
type Pred = (r: Row) => boolean;
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
      const rows = this.toInsert.map((r) => {
        const row: Row = { id: `${this.table}-${++seq}`, ...r };
        // 0225 `catering_quotes_bind_location`: a quote with a lead is filed under the lead's CURRENT shop.
        if (this.table === "catering_quotes" && row.pipeline_id != null) {
          const lead = (db.catering_pipeline ?? []).find((l) => l.id === row.pipeline_id);
          if (lead && lead.location_id != null) row.location_id = lead.location_id;
        }
        return row;
      });
      table.push(...rows);
      writes.push({ table: this.table, op: "insert", rows });
      return { data: rows.map((r) => ({ ...r })), error: null, count: rows.length };
    }
    const matched = table.filter((r) => this.preds.every((p) => p(r)));
    if (this.mode === "update") {
      for (const r of matched) Object.assign(r, this.patch);
      writes.push({ table: this.table, op: "update" });
      return { data: matched.map((r) => ({ ...r })), error: null, count: matched.length };
    }
    return { data: matched.map((r) => ({ ...r })), error: null, count: matched.length };
  }
  maybeSingle() { return this.exec().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  single() { return this.exec().then((r) => ({ data: r.data?.[0] ?? null, error: null })); }
  then<A, B>(res: (v: { data: Row[] | null; error: null; count: number }) => A, rej?: (e: unknown) => B) {
    return this.exec().then(res, rej);
  }
}
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (t: string) => new Q(t) }) }));
vi.mock("@/lib/audit", () => ({ audit }));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: async () => session.ctx }));

import { NextRequest } from "next/server";
import { createQuote, preflightQuoteLead } from "@/lib/catering/quotes";
import { POST as createQuoteRoute } from "@/app/api/catering/quotes/route";

// ── fixtures ─────────────────────────────────────────────────────────────────────────────
const A = "loc-a";
const B = "loc-b";
/** The audit's actor: a catering manager (level 6) who holds shop A only. Their lead board is every shop. */
const cateringMgrA = { user: { id: "cm-a", role: "catering_mgr" }, role: "catering_mgr", level: 6, locations: [A] } as unknown as AuthContext;
/** A GM who holds BOTH shops: allowed to write either, still may not price at one and file at the other. */
const gmBoth = { user: { id: "gm-ab", role: "gm" }, role: "gm", level: 7, locations: [A, B] } as unknown as AuthContext;

const lead = (id: string, location_id: string | null): Row => ({ id, customer_id: null, location_id, contact_name: `Contact ${id}`, stage: "inquiry" });
const line = [{ description: "Box lunch", quantity: 10, unitPriceCents: 1200 }];
const quotes = () => db.catering_quotes ?? [];
const post = (body: Record<string, unknown>) =>
  createQuoteRoute(new NextRequest("http://localhost/api/catering/quotes", {
    method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ locationId: A, lines: line, ...body }),
  }));

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  writes.length = 0;
  audit.mockClear();
  session.ctx = cateringMgrA;
  db.users = [{ id: "cm-a", role: "catering_mgr", active: true }, { id: "gm-ab", role: "gm", active: true }];
  db.user_locations = [
    { user_id: "cm-a", location_id: A, active: true },
    { user_id: "gm-ab", location_id: A, active: true }, { user_id: "gm-ab", location_id: B, active: true },
  ];
  db.catering_customers = [];
  db.catering_pipeline = [lead("l-a", A), lead("l-b", B), lead("l-none", null)];
  db.catering_quotes = [];
  db.catering_quote_items = [];
});

describe("B011 — createQuote binds the quote to its lead's shop before pricing or writing", () => {
  it("refuses a shop-B lead on a shop-A quote: nothing is priced, nothing is written", async () => {
    await expect(createQuote(cateringMgrA, { locationId: A, pipelineId: "l-b", lines: line }))
      .rejects.toMatchObject({ status: 409, code: "lead_location_mismatch" });
    expect(writes).toEqual([]);
    expect(quotes()).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses the same mismatch for someone who holds BOTH shops (the rule is the shop, not the role)", async () => {
    await expect(createQuote(gmBoth, { locationId: A, pipelineId: "l-b", lines: line }))
      .rejects.toMatchObject({ status: 409, code: "lead_location_mismatch" });
    expect(quotes()).toEqual([]);
  });

  it("no quote ever lands at a shop other than the one it was priced for", async () => {
    const attempts: Array<[AuthContext, string, string | null]> = [
      [cateringMgrA, A, "l-a"], [cateringMgrA, A, "l-b"], [cateringMgrA, A, "l-none"], [cateringMgrA, A, null],
      [gmBoth, A, "l-b"], [gmBoth, B, "l-b"], [gmBoth, B, "l-a"], [gmBoth, B, "l-none"],
    ];
    for (const [actor, locationId, pipelineId] of attempts) {
      const made = await createQuote(actor, { locationId, pipelineId, lines: line }).catch(() => null);
      if (made) expect(quotes().find((q) => q.id === made.id)).toMatchObject({ location_id: locationId });
    }
    // Exactly the matching and unassigned-lead saves went through.
    expect(quotes().map((q) => [q.location_id, q.pipeline_id])).toEqual([[A, "l-a"], [A, "l-none"], [A, null], [B, "l-b"], [B, "l-none"]]);
  });

  it("still creates a quote for a lead at the same shop, and for a lead with no shop yet", async () => {
    const same = await createQuote(cateringMgrA, { locationId: A, pipelineId: "l-a", lines: line });
    expect(quotes().find((q) => q.id === same.id)).toMatchObject({ location_id: A, pipeline_id: "l-a", version: 1 });
    const unassigned = await createQuote(cateringMgrA, { locationId: A, pipelineId: "l-none", lines: line });
    expect(quotes().find((q) => q.id === unassigned.id)).toMatchObject({ location_id: A, pipeline_id: "l-none" });
  });

  it("gives a lead id that names nothing the SAME answer (no existence oracle), before any write", async () => {
    await expect(createQuote(cateringMgrA, { locationId: A, pipelineId: "nope", lines: line }))
      .rejects.toMatchObject({ status: 409, code: "lead_location_mismatch" });
    expect(writes).toEqual([]);
  });

  it("the location gate still comes first: a shop the actor does not hold is 403, lead or not", async () => {
    await expect(createQuote(cateringMgrA, { locationId: B, pipelineId: "l-b", lines: line }))
      .rejects.toMatchObject({ status: 403, code: "location_access_denied" });
    await expect(preflightQuoteLead(cateringMgrA, { locationId: B, pipelineId: "l-b" }))
      .rejects.toMatchObject({ status: 403, code: "location_access_denied" });
    expect(writes).toEqual([]);
  });

  it("preflightQuoteLead is read-only and passes when there is no lead", async () => {
    await expect(preflightQuoteLead(cateringMgrA, { locationId: A, pipelineId: null })).resolves.toBeUndefined();
    await expect(preflightQuoteLead(cateringMgrA, { locationId: A, pipelineId: "l-a" })).resolves.toBeUndefined();
    expect(writes).toEqual([]);
  });
});

describe("B011 — the quotes route refuses before it creates the customer", () => {
  it("409 lead_location_mismatch with a typed new email: no customer row, no quote", async () => {
    const res = await post({ pipelineId: "l-b", contactEmail: "new.person@client.test", contactName: "New Person" });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "lead_location_mismatch" });
    expect(db.catering_customers).toEqual([]);
    expect(quotes()).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("201 for the same body once the quote's shop is the lead's shop", async () => {
    const res = await post({ pipelineId: "l-a", contactEmail: "new.person@client.test", contactName: "New Person" });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(quotes().find((q) => q.id === id)).toMatchObject({ location_id: A, pipeline_id: "l-a" });
    expect(db.catering_customers).toHaveLength(1);
  });
});

// ── the builder: it does not offer what the server refuses ──────────────────────────────────
import { readFileSync } from "node:fs";
import { leadLockedLocationId, prefillFromLead, quotableLeads } from "@/lib/catering/quotes-shared";
import { resolveErrorKey } from "@/components/catering/quotes/shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

describe("B011 — the quote builder follows the lead's shop", () => {
  const leads = [
    { id: "l-a", locationId: A }, { id: "l-b", locationId: B }, { id: "l-none", locationId: null },
  ];
  it("offers only leads at a shop the builder offers, plus leads with no shop yet", () => {
    expect(quotableLeads(leads, [A]).map((l) => l.id)).toEqual(["l-a", "l-none"]);
    expect(quotableLeads(leads, [A, B]).map((l) => l.id)).toEqual(["l-a", "l-b", "l-none"]);
    expect(quotableLeads(leads, []).map((l) => l.id)).toEqual(["l-none"]);
  });
  it("a picked lead with a shop fixes the quote's shop; no lead or a shop-less lead does not", () => {
    expect(leadLockedLocationId(leads[1])).toBe(B);
    expect(leadLockedLocationId(leads[2])).toBeNull();
    expect(leadLockedLocationId(undefined)).toBeNull();
  });
  it("every offered lead with a shop moves the builder to that shop (so the locked shop IS the lead's)", () => {
    const form = { contactName: "", contactCompany: "", eventDate: "", headcount: "", locationId: A };
    for (const l of quotableLeads(leads, [A, B])) {
      const full = { ...l, contactName: "Ana", company: null, eventDate: null, headcount: null };
      expect(prefillFromLead(form, full, [A, B]).locationId).toBe(l.locationId ?? A);
    }
  });
  it("the builder is wired to both rules, and the refusal has its own en + es message", () => {
    const src = readFileSync("components/catering/quotes/QuotesClient.tsx", "utf8");
    expect(src).toContain("const leadOptions = editing ? leads : quotableLeads(leads, locations.map((l) => l.id));");
    expect(src).toContain("{leadOptions.map((l) => (");
    expect(src).not.toContain("{leads.map((l) => (");
    expect(src).toContain("disabled={!!editing || shopLockedByLead}");
    expect(resolveErrorKey("lead_location_mismatch")).toBe("catering.quotes.error.lead_location_mismatch");
    for (const key of ["catering.quotes.error.lead_location_mismatch", "catering.quotes.location_follows_lead"] as const) {
      expect(en[key].length).toBeGreaterThan(10);
      expect(es[key].length).toBeGreaterThan(10);
      expect(es[key]).not.toBe(en[key]);
    }
  });
});
