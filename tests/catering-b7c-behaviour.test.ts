/**
 * B7c · Catering owner decisions (Juan, 2026-10-13) — BEHAVIOUR through the libs and routes,
 * over an in-memory Supabase fake (same shape as tests/catering-b5-review.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

type Row = Record<string, unknown>;
const { db, reads, writes, audit, session } = vi.hoisted(() => ({
  db: {} as Record<string, Row[]>,
  reads: [] as string[],
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
    if (this.mode === "select") reads.push(this.table);
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

import { loadCateringPrepDemand, resolveQuoteDemand } from "@/lib/catering/prep-demand";
import { loadPipelineBoard } from "@/lib/catering/pipeline";
import { NextRequest } from "next/server";
import { POST as createLeadRoute } from "@/app/api/catering/pipeline/route";
import { PATCH as patchLeadRoute } from "@/app/api/catering/pipeline/[id]/route";
import { showQuoteNotAccepted } from "@/lib/catering/pipeline-shared";
import { expandPackageLines, type ExpandablePackage } from "@/lib/catering/quotes-shared";

// ── fixtures ─────────────────────────────────────────────────────────────────────────────
const A = "loc-a";
const gmA = { user: { id: "gm-a", role: "gm" }, role: "gm", level: 7, locations: [A] } as unknown as AuthContext;

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  writes.length = 0;
  reads.length = 0;
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
      description: l.description,
      unit_price_cents: Math.round(Number(l.unitPrice || "0") * 100),
      display_order: i,
      line_kind: l.lineKind,
      components_listed: l.componentsListed,
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

// ── review (Astra) · package components keep their identity; no double expansion ─────────
describe("review · package components keep their identity; one package counted once", () => {
  type QLine = { item_id?: string | null; menu_item_id?: string | null; package_id?: string | null; quantity: number; unit_price_cents?: number; description?: string | null; line_kind?: string | null; components_listed?: boolean | null };
  const comps: Row[] = [
    { id: "fix-chips", package_id: "pkg-fix", slot_type: "fixed", item_id: "i-chips", menu_item_id: null, quantity: 1, active: true },
    { id: "mix-chips", package_id: "pkg-mix", slot_type: "fixed", item_id: "i-chips", menu_item_id: null, quantity: 1, active: true },
    { id: "mix-slot", package_id: "pkg-mix", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 1, active: true },
    { id: "plat-slot", package_id: "pkg-plat", slot_type: "choice", item_id: null, menu_item_id: null, quantity: 16, active: true },
  ];
  const resolve = async (lines: QLine[], options: Row[] = []) => {
    db.catering_package_items = comps.map((c) => ({ ...c }));
    db.catering_quote_item_options = options;
    db.catering_quote_items = lines.map((l, i) => ({
      id: `qi-${i}`, quote_id: "q-r", item_id: null, menu_item_id: null, package_id: null, portion: null, unit_price_cents: 0, display_order: i, ...l,
    }));
    const d = await resolveQuoteDemand(sbFake as never, "q-r");
    const sum = (f: (x: (typeof d)[number]) => boolean) => d.filter(f).reduce((s, x) => s + x.qty, 0);
    return { chips: sum((x) => x.itemId === "i-chips"), picks: sum((x) => x.choicePackageItemId != null), subs: sum((x) => x.menuItemId === "m-sub") };
  };
  const fixedPkg: ExpandablePackage = {
    id: "pkg-fix", labelEn: "Snack pack", pricingMode: "fixed", priceCents: 1500,
    items: [{ itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 0 }],
  };
  const asRows = (pkg: ExpandablePackage, headcount: string): QLine[] =>
    expandPackageLines(pkg, headcount).map((l) => ({
      item_id: l.itemId, menu_item_id: l.menuItemId, package_id: l.packageId,
      quantity: Number(l.quantity), unit_price_cents: Math.round(Number(l.unitPrice || "0") * 100),
      description: l.description, line_kind: l.lineKind, components_listed: l.componentsListed,
    }));

  it("$15 fixed package with an unpriced concrete item: demand is the item's own Qty, once", async () => {
    const rows = asRows(fixedPkg, "");
    expect(await resolve(rows)).toMatchObject({ chips: 1, picks: 0 });
    rows[1]!.quantity = 2; // the manager edits the component's Qty
    expect(await resolve(rows)).toMatchObject({ chips: 2, picks: 0 });
  });

  it("removing the header keeps the components counting", async () => {
    const rows = asRows(fixedPkg, "");
    rows[1]!.quantity = 2;
    rows[1]!.unit_price_cents = 1500; // the manager prices the remaining component
    expect(await resolve(rows.slice(1))).toMatchObject({ chips: 2, picks: 0 });
  });

  it("a pick placeholder is reserved once, through the header's slot, never as a second package", async () => {
    const mixed: ExpandablePackage = {
      id: "pkg-mix", labelEn: "Mix", pricingMode: "per_head", priceCents: 1800,
      items: [
        { itemId: "i-chips", menuItemId: null, label: "Chips", quantity: 1, unitPriceCents: 0 },
        { itemId: null, menuItemId: null, label: "Choose your sub", quantity: 1, unitPriceCents: 0 },
      ],
    };
    expect(await resolve(asRows(mixed, "10"))).toMatchObject({ chips: 10, picks: 10 });
    // same package with priced components (the $0 header path)
    const priced = { ...mixed, priceCents: 0, items: [{ ...mixed.items[0]!, unitPriceCents: 200 }, mixed.items[1]!] };
    expect(await resolve(asRows(priced, "10"))).toMatchObject({ chips: 10, picks: 10 });
  });

  it("OLD saved quotes (placeholders carrying the package id) resolve without double counting", async () => {
    // old platter: header $115 x1 + pick line $0 x16 with the package id
    expect(await resolve([
      { package_id: "pkg-plat", quantity: 1, unit_price_cents: 11500 },
      { package_id: "pkg-plat", quantity: 16, unit_price_cents: 0 },
    ])).toMatchObject({ picks: 16 });
    // old mixed: header + concrete component with the package id + pick line with the package id
    expect(await resolve([
      { package_id: "pkg-mix", quantity: 5, unit_price_cents: 1800 },
      { package_id: "pkg-mix", item_id: "i-chips", quantity: 5 },
      { package_id: "pkg-mix", quantity: 5, unit_price_cents: 0 },
    ])).toMatchObject({ chips: 5, picks: 5 });
  });

  it("a portal package line (no component lines) still expands the whole package, picks included", async () => {
    expect(await resolve([{ package_id: "pkg-mix", quantity: 3, unit_price_cents: 1800 }])).toMatchObject({ chips: 3, picks: 3 });
    expect(await resolve(
      [{ package_id: "pkg-mix", quantity: 3, unit_price_cents: 1800 }],
      [{ quote_item_id: "qi-0", package_item_id: "mix-slot", item_id: null, menu_item_id: "m-sub", quantity: 1 }],
    )).toMatchObject({ chips: 3, picks: 0, subs: 3 });
  });

  it("an unpriced bare package line with nothing priced beside it still counts (a free package)", async () => {
    expect(await resolve([{ package_id: "pkg-fix", quantity: 2, unit_price_cents: 0 }])).toMatchObject({ chips: 2 });
  });
});

// ── D-46 · "quote not accepted" chip on Confirmed cards ─────────────────────────────────
describe("D-46 · the board knows which Confirmed leads have an unaccepted quote", () => {
  const lead = (id: string, stage: string, location_id: string | null = A): Row => ({
    id, stage, location_id, customer_id: null, contact_name: `Contact ${id}`, company: null, created_at: `2026-10-0${id.length}`,
  });
  const quote = (pipeline_id: string, status: string, created_at: string, superseded_at: string | null = null): Row => ({
    id: `q-${pipeline_id}-${created_at}`, pipeline_id, status, created_at, superseded_at,
  });
  beforeEach(() => {
    db.locations = [{ id: A, name: "Shop A" }];
    db.catering_pipeline = [
      lead("c-draft", "confirmed"),
      lead("c-sent", "confirmed"),
      lead("c-acc", "confirmed"),
      lead("c-none", "confirmed"),
      lead("c-revised", "confirmed"),
      lead("c-declined", "confirmed"),
      lead("i-draft", "inquiry"),
      lead("other-shop", "confirmed", "loc-b"),
    ];
    db.catering_quotes = [
      quote("c-draft", "draft", "2026-10-02"),
      quote("c-sent", "sent", "2026-10-02"),
      quote("c-acc", "accepted", "2026-10-02"),
      // revised: v1 accepted then superseded; the current v2 is only a draft
      quote("c-revised", "accepted", "2026-10-01", "2026-10-03"),
      quote("c-revised", "draft", "2026-10-03"),
      quote("c-declined", "declined", "2026-10-02"),
      quote("i-draft", "draft", "2026-10-02"),
      quote("other-shop", "draft", "2026-10-02"),
    ];
  });

  it("returns the CURRENT quote status for Confirmed leads only, scoped to the actor's shops", async () => {
    const board = await loadPipelineBoard(gmA);
    const byId = Object.fromEntries(board.map((l) => [l.id, l.quoteStatus]));
    expect(byId).toEqual({
      "c-draft": "draft",
      "c-sent": "sent",
      "c-acc": "accepted",
      "c-none": null,
      "c-revised": "draft",
      "c-declined": "declined",
      "i-draft": null, // not Confirmed → not loaded
    });
  });

  it("the chip shows on Confirmed + draft/sent only", async () => {
    const board = await loadPipelineBoard(gmA);
    expect(board.filter((l) => showQuoteNotAccepted(l.stage, l.quoteStatus)).map((l) => l.id).sort())
      .toEqual(["c-draft", "c-revised", "c-sent"]);
  });

  it("a board with no Confirmed lead makes no quote read", async () => {
    db.catering_pipeline = [lead("i-draft", "inquiry")];
    expect((await loadPipelineBoard(gmA)).map((l) => l.quoteStatus)).toEqual([null]);
    expect(reads).not.toContain("catering_quotes");
  });
});

// ── D-47 · Prep Demand lines name their lead ────────────────────────────────────────────
describe("D-47 · Prep Demand names the lead behind each line", () => {
  const B = "loc-b";
  const demand = (pipeline_id: string, qty: number, extra: Row = {}): Row => ({
    pipeline_id, location_id: A, status: "reserved", need_date: "2026-10-20",
    item_id: null, menu_item_id: null, choice_package_item_id: "slot-1", portion: null, qty, ...extra,
  });
  beforeEach(() => {
    db.catering_package_items = [{ id: "slot-1", description: "Choose your sub" }];
    db.menu_items = [{ id: "m-1", name: "Crunchy Boi" }];
    db.catering_pipeline = [
      { id: "l-ana", contact_name: "Ana Diaz", company: "Acme", location_id: A },
      { id: "l-bob", contact_name: "Bob Ray", company: null, location_id: A },
      { id: "l-moved", contact_name: "Zed Hidden", company: "Secret Co", location_id: B },
    ];
    db.catering_prep_demand = [
      demand("l-ana", 20),
      demand("l-bob", 8),
      demand("l-moved", 4),
      demand("l-ana", 3, { choice_package_item_id: null, menu_item_id: "m-1" }),
      demand("l-bob", 99, { status: "released" }), // not reserved → not on the overlay
    ];
  });
  const load = () => loadCateringPrepDemand(gmA, { locationId: A, from: "2026-10-14", to: "2026-10-28" });

  it("a NEEDS PICK line lists every lead it is for, most first, with contact · company", async () => {
    const [day] = await load();
    const pick = day!.lines.find((l) => l.needsPick)!;
    expect(pick.qty).toBe(32);
    expect(pick.leads).toEqual([
      { id: "l-ana", label: "Ana Diaz · Acme", qty: 20 },
      { id: "l-bob", label: "Bob Ray", qty: 8 },
      { id: "l-moved", label: null, qty: 4 },
    ]);
    const sub = day!.lines.find((l) => l.refKind === "menu_item")!;
    expect(sub.leads).toEqual([{ id: "l-ana", label: "Ana Diaz · Acme", qty: 3 }]);
  });

  it("a lead now at a shop the viewer cannot read is counted but never named", async () => {
    const days = await load();
    expect(JSON.stringify(days)).not.toMatch(/Zed|Secret/);
  });

  it("fails closed: no readable membership → no names at all", async () => {
    db.users = [{ id: "gm-a", role: "gm", active: false }];
    const [day] = await load();
    for (const line of day!.lines) for (const l of line.leads) expect(l.label).toBeNull();
    expect(JSON.stringify(day)).not.toMatch(/Ana|Bob/);
  });

  it("names are never written to the audit log", async () => {
    await load();
    expect(JSON.stringify(audit.mock.calls)).not.toMatch(/Ana|Bob|Zed/);
  });
});

// ── D-48 · phone on Add lead and on Edit details ────────────────────────────────────────
describe("D-48 · lead phone through the pipeline routes", () => {
  const PHONE = "(202) 555-0147";
  const req = (url: string, method: "POST" | "PATCH", body: unknown) =>
    new NextRequest(`http://localhost${url}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const create = (body: Record<string, unknown>) => createLeadRoute(req("/api/catering/pipeline", "POST", { contactName: "Ana", locationId: A, ...body }));
  const patch = (id: string, body: Record<string, unknown>) =>
    patchLeadRoute(req(`/api/catering/pipeline/${id}`, "PATCH", body), { params: Promise.resolve({ id }) });
  const leadWrites = () => writes.filter((w) => w.table === "catering_pipeline");
  const noPhoneLeak = (x: unknown) => expect(JSON.stringify(x)).not.toContain("555-0147");

  beforeEach(() => {
    db.catering_pipeline = [
      { id: "l-a", location_id: A, contact_name: "Ana", contact_phone: null, assigned_to: null, stage: "inquiry" },
      { id: "l-b", location_id: "loc-b", contact_name: "Bea", contact_phone: null, assigned_to: null, stage: "inquiry" },
    ];
    db.catering_pipeline_events = [];
  });

  it("Add lead stores the phone trimmed, and the audit row never carries it", async () => {
    const res = await create({ contactPhone: `  ${PHONE}  ` });
    expect(res.status).toBe(201);
    const { id } = await res.json();
    expect(db.catering_pipeline!.find((l) => l.id === id)).toMatchObject({ contact_phone: PHONE, location_id: A });
    noPhoneLeak(audit.mock.calls);
  });

  it("Add lead with a blank phone stores null", async () => {
    const res = await create({ contactPhone: "   " });
    const { id } = await res.json();
    expect(db.catering_pipeline!.find((l) => l.id === id)!.contact_phone).toBeNull();
  });

  it("a phone that is too long or not text is refused, nothing written, value never echoed", async () => {
    const long = `${PHONE} ${"9".repeat(40)}`;
    const r1 = await create({ contactPhone: long });
    expect(r1.status).toBe(400);
    const b1 = await r1.json();
    expect(b1.code).toBe("invalid_payload");
    noPhoneLeak(b1);
    const r2 = await create({ contactPhone: 2025550147 });
    expect(r2.status).toBe(400);
    expect((await r2.json()).field).toBe("contactPhone");
    expect(leadWrites()).toEqual([]);
    noPhoneLeak(audit.mock.calls);
  });

  it("Edit details sets and clears the phone; the audit names the field, never the value", async () => {
    expect((await patch("l-a", { contactPhone: PHONE })).status).toBe(200);
    expect(db.catering_pipeline!.find((l) => l.id === "l-a")!.contact_phone).toBe(PHONE);
    const editAudit = audit.mock.calls.map((c) => c[0]).find((a) => a.action === "catering.pipeline.edit");
    expect(editAudit.metadata.fields).toEqual(["contact_phone"]);
    noPhoneLeak(audit.mock.calls);
    expect((await patch("l-a", { contactPhone: "" })).status).toBe(200);
    expect(db.catering_pipeline!.find((l) => l.id === "l-a")!.contact_phone).toBeNull();
  });

  it("a GM cannot set the phone on another shop's lead", async () => {
    const res = await patch("l-b", { contactPhone: PHONE });
    expect(res.status).toBe(403);
    expect(db.catering_pipeline!.find((l) => l.id === "l-b")!.contact_phone).toBeNull();
    expect(leadWrites()).toEqual([]);
  });

  it("a stage move and a phone edit in one PATCH are still refused as mixed concerns", async () => {
    const res = await patch("l-a", { stage: "lost", contactPhone: PHONE });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("mixed_concerns");
  });
});
