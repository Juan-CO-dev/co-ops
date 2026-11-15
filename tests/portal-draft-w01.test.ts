// Audit wave W01 (online catering order: price, allergens, confirmation) — lib/portal/draft.ts.
// Runs the real draft lib against an in-memory fake of the service-role client
// (tests/fixtures/portal/draft-fake-db.ts). An rpc with no fake answers PGRST202, i.e. the
// database BEFORE migration 0302 — so every test without an rpc fake exercises the legacy path.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { draftFakeDb, type DraftFakeDb, type FakeRpc, type Row } from "./fixtures/portal/draft-fake-db";

const h = vi.hoisted(() => ({
  db: null as unknown as { client: unknown },
  menu: [] as unknown[],
  packages: [] as unknown[],
  zones: [] as unknown[],
  rates: { taxRateBps: 0, gratuityBps: 0, serviceChargeBps: 0, depositPctBps: 2500, taxOnDelivery: false, taxOnGratuity: false },
  sendEmail: vi.fn(),
  audit: vi.fn(),
  createPaymentDue: vi.fn(),
}));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => h.db.client }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
vi.mock("@/lib/email", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/portal/origin-shared", () => ({ portalOrigin: () => "https://order.example.test" }));
vi.mock("@/lib/catering/payments", () => ({ createPaymentDue: h.createPaymentDue }));
vi.mock("@/lib/portal/menu", () => ({
  loadPublicCateringMenu: async () => h.menu,
  loadPublicCateringPackages: async () => h.packages,
  loadPublicPricingContext: async () => ({ rates: h.rates, hasPricingRule: true, zones: h.zones }),
}));
import { previewDraft, setDraftLines, submitDraft, loadDraft, PortalDraftError } from "@/lib/portal/draft";

const LOC = "11111111-1111-4111-8111-111111111111";
const QUOTE = "22222222-2222-4222-8222-222222222222";
const PIPE = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";
const ZONE = "55555555-5555-4555-8555-555555555555";
const CUST = "customer-1";

function chips(price = 1000) {
  return { kind: "item", id: ITEM, name: "Chips", nameEs: null, section: "Sides", cateringOnly: false, portionable: false, regularPriceCents: price, rateBps: 10000, unitPriceCents: price, portionPricesCents: null, sizes: null, serves: 1 };
}
function seed(quote: Partial<Row> = {}): Record<string, Row[]> {
  return {
    catering_quotes: [{
      id: QUOTE, customer_id: CUST, location_id: LOC, status: "draft", superseded_at: null, is_delivery: false,
      delivery_zone_id: null, pipeline_id: PIPE, event_date: "2027-01-02", subtotal_cents: 10000, delivery_fee_cents: 0,
      service_charge_cents: 0, gratuity_cents: 0, tax_cents: 0, total_cents: 10000, deposit_cents: 2500, ...quote,
    }],
    catering_quote_items: [{
      id: "line-1", quote_id: QUOTE, item_id: ITEM, menu_item_id: null, package_id: null, size_id: null, portion: null,
      description: "Chips", quantity: 10, unit_price_cents: 1000, line_total_cents: 10000, display_order: 0,
    }],
    catering_quote_item_options: [],
    catering_customers: [{ id: CUST, name: "Buyer", email: "buyer@acme.test" }],
    catering_pipeline: [{ id: PIPE, customer_id: CUST, contact_name: "Buyer", dietary_notes: null }],
    catering_payments: [],
  };
}
function useDb(tables = seed(), rpcs: Record<string, FakeRpc> = {}): DraftFakeDb {
  const db = draftFakeDb(tables, rpcs);
  h.db = db as unknown as { client: unknown };
  return db;
}
const quoteRow = (db: DraftFakeDb) => db.tables.catering_quotes![0]!;

beforeEach(() => {
  h.menu = [chips()];
  h.packages = [];
  h.zones = [];
  h.sendEmail.mockReset();
  h.audit.mockReset();
  h.createPaymentDue.mockReset().mockResolvedValue({ id: "payment-1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("B003 — the order confirmation email under the go-live allowlist '*'", () => {
  it("'*' sends the confirmation to any customer (the magic-link matcher's semantics)", async () => {
    vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", "*");
    useDb();
    await submitDraft(CUST, QUOTE, {});
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.sendEmail.mock.calls[0]![0]).toMatchObject({ to: "buyer@acme.test" });
  });
  it("an exact list still gates (case-insensitive), and an empty list sends nothing", async () => {
    vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", " BUYER@acme.test , other@x.test");
    useDb();
    await submitDraft(CUST, QUOTE, {});
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    h.sendEmail.mockReset();
    vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", "");
    useDb();
    await submitDraft(CUST, QUOTE, {});
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

const zone = (id: string, feeCents: number) => ({ id, slug: id.slice(0, 4), labelEn: "Zone", labelEs: null, feeCents, minOrderCents: null });

describe("B001 — the delivery fee of a self-serve delivery order is decided by the server", () => {
  it("one active zone at the shop: preview, save and submit all charge its fee and record the zone", async () => {
    h.zones = [zone(ZONE, 2500)];
    const db = useDb(seed({ is_delivery: true }));
    expect((await previewDraft(CUST, QUOTE, {})).deliveryFeeCents).toBe(2500);
    const view = await setDraftLines(CUST, QUOTE, [{ itemId: ITEM, quantity: 10 }]);
    expect(view.stack.deliveryFeeCents).toBe(2500);
    expect(view.deliveryZoneId).toBe(ZONE);
    const res = await submitDraft(CUST, QUOTE, {});
    expect(res.totalCents).toBe(12500);
    expect(quoteRow(db)).toMatchObject({ status: "submitted", is_delivery: true, delivery_zone_id: ZONE, delivery_fee_cents: 2500, total_cents: 12500, deposit_cents: 3125 });
  });
  it("what the browser sends cannot change it: a null zone, another zone id, or isDelivery:false are ignored", async () => {
    h.zones = [zone(ZONE, 2500)];
    const db = useDb(seed({ is_delivery: true }));
    const forged = { isDelivery: false, deliveryZoneId: null } as unknown as Parameters<typeof submitDraft>[2];
    expect((await previewDraft(CUST, QUOTE, forged)).deliveryFeeCents).toBe(2500);
    await submitDraft(CUST, QUOTE, forged);
    expect(quoteRow(db)).toMatchObject({ is_delivery: true, delivery_zone_id: ZONE, delivery_fee_cents: 2500 });
  });
  it("pickup is never charged a delivery fee", async () => {
    h.zones = [zone(ZONE, 2500)];
    const db = useDb(seed({ is_delivery: false }));
    const forged = { isDelivery: true, deliveryZoneId: ZONE } as unknown as Parameters<typeof submitDraft>[2];
    await submitDraft(CUST, QUOTE, forged);
    expect(quoteRow(db)).toMatchObject({ is_delivery: false, delivery_zone_id: null, delivery_fee_cents: 0 });
  });
  it("no zones configured, or several fee tiers the server cannot place an address in: no fee, no zone (staff set it on confirm)", async () => {
    useDb(seed({ is_delivery: true }));
    expect((await previewDraft(CUST, QUOTE, {})).deliveryFeeCents).toBe(0);
    h.zones = [zone(ZONE, 2500), zone("66666666-6666-4666-8666-666666666666", 4000)];
    const db = useDb(seed({ is_delivery: true }));
    await submitDraft(CUST, QUOTE, {});
    expect(quoteRow(db)).toMatchObject({ delivery_zone_id: null, delivery_fee_cents: 0 });
  });
});

describe("B031 — a draft is submitted at TODAY's menu prices, never the price saved weeks ago", () => {
  it("a price raised since the line was saved: preview and submit refuse 409 cart_changed; nothing is written", async () => {
    const db = useDb();
    h.menu = [chips(1200)];
    await expect(previewDraft(CUST, QUOTE, {})).rejects.toMatchObject({ status: 409, code: "cart_changed" });
    await expect(submitDraft(CUST, QUOTE, {})).rejects.toMatchObject({ status: 409, code: "cart_changed" });
    expect(quoteRow(db).status).toBe("draft");
    expect(h.createPaymentDue).not.toHaveBeenCalled();
    expect(db.writes.filter((w) => w.table === "catering_quotes")).toEqual([]);
  });
  it("an item no longer on the menu (deactivated) is cart_changed too, never submitted", async () => {
    const db = useDb();
    h.menu = [];
    await expect(previewDraft(CUST, QUOTE, {})).rejects.toMatchObject({ status: 409, code: "cart_changed" });
    await expect(submitDraft(CUST, QUOTE, {})).rejects.toMatchObject({ status: 409, code: "cart_changed" });
    expect(quoteRow(db).status).toBe("draft");
  });
  it("after the cart is saved again (the build page re-saves a stale cart), submit goes through at the new price", async () => {
    const db = useDb();
    h.menu = [chips(1200)];
    await setDraftLines(CUST, QUOTE, [{ itemId: ITEM, quantity: 10 }]);
    const res = await submitDraft(CUST, QUOTE, {});
    expect(res.totalCents).toBe(12000);
    expect(quoteRow(db)).toMatchObject({ status: "submitted", subtotal_cents: 12000 });
  });
  it("unchanged prices submit exactly as before", async () => {
    const db = useDb();
    expect((await previewDraft(CUST, QUOTE, {})).subtotalCents).toBe(10000);
    await submitDraft(CUST, QUOTE, {});
    expect(quoteRow(db)).toMatchObject({ status: "submitted", subtotal_cents: 10000, deposit_cents: 2500 });
  });
});

// A JS stand-in for 0302's writers (the SQL itself is proven by scripts/sql-harness-0302.mjs): it
// records the call and answers like PostgREST. `refuse` makes it raise that refusal code.
function rpcOk(data: unknown = { quote_id: QUOTE }): FakeRpc { return () => ({ data, error: null }); }
function rpcRefuse(code: string): FakeRpc { return () => ({ data: null, error: { code: "P0001", message: code } }); }
const directWrites = (db: DraftFakeDb) => db.writes.filter((w) => ["catering_quotes", "catering_quote_items", "catering_quote_item_options", "catering_payments"].includes(w.table));

describe("B032 — a cart save can never replace the lines of an order already submitted", () => {
  it("with 0302: the save is ONE call to portal_draft_set_lines (lines + picks + snapshot), no direct writes", async () => {
    const db = useDb(seed(), { portal_draft_set_lines: rpcOk() });
    const view = await setDraftLines(CUST, QUOTE, [{ itemId: ITEM, quantity: 3 }], { tipBps: 1500 });
    expect(view.stack.subtotalCents).toBe(3000);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0]).toEqual({ name: "portal_draft_set_lines", args: {
      p_customer_id: CUST, p_quote_id: QUOTE,
      p_lines: [{ item_id: ITEM, menu_item_id: null, package_id: null, size_id: null, portion: null, description: "Chips", quantity: 3, unit_price_cents: 1000, line_total_cents: 3000, display_order: 0, line_kind: null, components_listed: null, options: [] }],
      p_snapshot: expect.objectContaining({ subtotal_cents: 3000, gratuity_bps: 1500, gratuity_cents: 450, is_delivery: false, delivery_zone_id: null }),
    } });
    expect(Object.keys(db.rpcCalls[0]!.args.p_snapshot as object)).toHaveLength(15);
    expect(directWrites(db)).toEqual([]);
  });
  it("with 0302: the writer's not_draft (a submit won the row lock) is a 409, and nothing else runs", async () => {
    const db = useDb(seed(), { portal_draft_set_lines: rpcRefuse("not_draft") });
    await expect(setDraftLines(CUST, QUOTE, [{ itemId: ITEM, quantity: 3 }])).rejects.toMatchObject({ status: 409, code: "not_draft" });
    expect(directWrites(db)).toEqual([]);
  });
  it("an unknown database error is thrown, never mistaken for the missing-function fallback", async () => {
    const db = useDb(seed(), { portal_draft_set_lines: () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) });
    await expect(setDraftLines(CUST, QUOTE, [{ itemId: ITEM, quantity: 3 }])).rejects.toThrow(/setDraftLines: canceling statement/);
    expect(directWrites(db)).toEqual([]);
  });
  it("before 0302 (legacy path): a submit landing mid-save is reported as 409 not_draft, not a silent success", async () => {
    const db = useDb();
    db.beforeWrite = (w) => { if (w.table === "catering_quote_items" && w.op === "delete") quoteRow(db).status = "submitted"; };
    await expect(setDraftLines(CUST, QUOTE, [{ itemId: ITEM, quantity: 3 }])).rejects.toMatchObject({ status: 409, code: "not_draft" });
  });
});

describe("B144 — submit is all or nothing (flip + napkins line + deposit intent)", () => {
  it("with 0302: submit is ONE call to portal_draft_submit carrying the priced lines, the snapshot, napkins and expiry", async () => {
    vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", "*");
    h.menu = [chips(), { ...chips(500), id: "77777777-7777-4777-8777-777777777777", name: "Napkins", section: "Add-ons" }];
    const db = useDb(seed(), { portal_draft_submit: rpcOk({ quote_id: QUOTE, payment_id: "pay-9" }) });
    const res = await submitDraft(CUST, QUOTE, { napkins: true });
    expect(res).toEqual({ quoteId: QUOTE, depositCents: 2625, totalCents: 10500 });
    expect(db.rpcCalls).toHaveLength(1);
    const call = db.rpcCalls[0]!;
    expect(call.name).toBe("portal_draft_submit");
    expect(call.args).toMatchObject({
      p_customer_id: CUST, p_quote_id: QUOTE,
      p_expected_lines: [{ id: "line-1", quantity: 10, unit_price_cents: 1000 }],
      p_snapshot: expect.objectContaining({ subtotal_cents: 10500, total_cents: 10500, deposit_cents: 2625 }),
      p_napkins: { item_id: "77777777-7777-4777-8777-777777777777", description: "Napkins", unit_price_cents: 500 },
      p_set_dietary_notes: false, p_dietary_notes: null,
    });
    expect(Date.parse(call.args.p_expires_at as string)).toBeGreaterThan(Date.now() + 13 * 86400_000);
    expect(directWrites(db)).toEqual([]);
    expect(h.createPaymentDue).not.toHaveBeenCalled();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "catering.draft.submit", resourceId: QUOTE }));
  });
  it("with 0302: a refusal (cart_changed / not_draft) sends no email and writes no audit row", async () => {
    vi.stubEnv("PORTAL_MAGIC_LINK_ALLOWLIST", "*");
    for (const [code, status] of [["cart_changed", 409], ["not_draft", 409], ["not_found", 404]] as const) {
      useDb(seed(), { portal_draft_submit: rpcRefuse(code) });
      await expect(submitDraft(CUST, QUOTE, {})).rejects.toMatchObject({ status, code });
    }
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
  it("before 0302 (legacy path) the previous three writes still run, in order", async () => {
    const db = useDb();
    await submitDraft(CUST, QUOTE, {});
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["portal_draft_submit"]);
    expect(quoteRow(db).status).toBe("submitted");
    expect(h.createPaymentDue).toHaveBeenCalledWith(expect.anything(), { quoteId: QUOTE, customerId: CUST, kind: "deposit", amountCents: 2500, createdBy: CUST });
  });
});

describe("B002 — the customer's allergy / special-instructions note reaches staff", () => {
  it("with 0302: the note rides the submit transaction (p_set_dietary_notes + the text)", async () => {
    const db = useDb(seed(), { portal_draft_submit: rpcOk() });
    await submitDraft(CUST, QUOTE, { dietaryNotes: "No peanuts on table 3 · hold the onions" });
    expect(db.rpcCalls[0]!.args).toMatchObject({ p_set_dietary_notes: true, p_dietary_notes: "No peanuts on table 3 · hold the onions" });
  });
  it("a submit that does not send a note leaves the lead's intake note alone", async () => {
    const db = useDb(seed(), { portal_draft_submit: rpcOk() });
    await submitDraft(CUST, QUOTE, {});
    expect(db.rpcCalls[0]!.args).toMatchObject({ p_set_dietary_notes: false, p_dietary_notes: null });
  });
  it("before 0302 (legacy path): the note is written to the lead (trimmed; blank clears it), only AFTER this submit won the status flip", async () => {
    let db = useDb();
    await submitDraft(CUST, QUOTE, { dietaryNotes: "  Shellfish allergy  " });
    expect(db.tables.catering_pipeline![0]!.dietary_notes).toBe("Shellfish allergy");
    const order = db.writes.map((w) => `${w.table}:${w.op}`);
    expect(order.indexOf("catering_quotes:update")).toBeLessThan(order.indexOf("catering_pipeline:update"));
    db = useDb(seed());
    db.tables.catering_pipeline![0]!.dietary_notes = "old";
    await submitDraft(CUST, QUOTE, { dietaryNotes: "   " });
    expect(db.tables.catering_pipeline![0]!.dietary_notes).toBeNull();
  });
  it("before 0302 (legacy path): a submit that LOSES the race never overwrites the winner's note", async () => {
    // Two tabs pass the draft check. Tab A submitted "Peanut allergy" and won the flip; tab B (a stale
    // blank note box) reaches its flip second and gets 409 — the accepted order keeps A's warning.
    const db = useDb();
    db.tables.catering_pipeline![0]!.dietary_notes = "Peanut allergy";
    db.beforeWrite = (w) => { if (w.table === "catering_quotes" && w.op === "update") quoteRow(db).status = "submitted"; };
    await expect(submitDraft(CUST, QUOTE, { dietaryNotes: "" })).rejects.toMatchObject({ status: 409, code: "not_draft" });
    expect(db.tables.catering_pipeline![0]!.dietary_notes).toBe("Peanut allergy");
    expect(db.writes.filter((w) => w.table === "catering_pipeline")).toEqual([]);
    expect(h.createPaymentDue).not.toHaveBeenCalled();
  });
  it("a note over 2000 characters is a clean 400 before anything is written", async () => {
    const db = useDb(seed(), { portal_draft_submit: rpcOk() });
    await expect(submitDraft(CUST, QUOTE, { dietaryNotes: "x".repeat(2001) })).rejects.toMatchObject({ status: 400, code: "invalid_notes" });
    expect(db.rpcCalls).toEqual([]);
    expect(db.writes).toEqual([]);
  });
});

describe("B145 — a submitted or superseded order is never served as an editable cart", () => {
  it("loadDraft says whether the order can still be edited", async () => {
    useDb();
    expect((await loadDraft(CUST, QUOTE))!.editable).toBe(true);
    useDb(seed({ status: "submitted" }));
    expect((await loadDraft(CUST, QUOTE))!).toMatchObject({ status: "submitted", editable: false });
    useDb(seed({ superseded_at: "2027-01-01T00:00:00Z" }));
    expect((await loadDraft(CUST, QUOTE))!).toMatchObject({ status: "draft", editable: false });
  });
  it("another customer still gets nothing", async () => {
    useDb();
    expect(await loadDraft("someone-else", QUOTE)).toBeNull();
  });
});

describe("the build page honours it", () => {
  it("renders a read-only 'already placed' state with a link to the quote, and a 409 save locks the cart", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("app/order/build/page.tsx", "utf8");
    expect(page).toMatch(/if \(res\.status === 409\) \{ setLocked\(true\); return "not_draft"; \}/);
    expect(page).toMatch(/if \(locked \|\| draft\.editable === false\)/);
    expect(page).toContain('href={`/order/quote/${encodeURIComponent(draft.quoteId)}`}');
    expect(page).toContain('t("order.build.locked")');
  });
});

// Keep the imports referenced while later describe blocks are added bug by bug.
void PortalDraftError;
