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

// Keep the imports referenced while later describe blocks are added bug by bug.
void loadDraft; void PortalDraftError;
