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

// Keep the imports referenced while later describe blocks are added bug by bug.
void previewDraft; void setDraftLines; void loadDraft; void PortalDraftError; void ZONE;
