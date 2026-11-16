import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";

const mocks = vi.hoisted(() => ({ client: vi.fn(), audit: vi.fn(), allowed: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.client }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: mocks.allowed, auditOperationalTaskOverride: vi.fn(), canTriageUnattributedReceipt: vi.fn() }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));
import { attemptReceivingAutoLink, attemptAutoLink, loadReceivingReceiptCandidates } from "@/lib/email-receipts";

type Row = Record<string, unknown>;
let deliveries: Row[];
let receipts: Row[];
let beforeClaim: (() => void) | undefined;
let loseDelivery: boolean;
function query(table: string) {
  const rows = table === "vendor_deliveries" ? deliveries : receipts;
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | undefined;
  let single = false;
  const q = {
    select: () => q, order: () => q, range: () => q, returns: () => q,
    eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    is: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
    gte: (k: string, v: string) => { filters.push(r => String(r[k]) >= v); return q; },
    lte: (k: string, v: string) => { filters.push(r => String(r[k]) <= v); return q; },
    lt: (k: string, v: string) => { filters.push(r => String(r[k]) < v); return q; },
    update: (v: Row) => { patch = v; return q; },
    maybeSingle: () => { single = true; return q; },
    then: (resolve: (v: unknown) => void) => {
      if (patch?.linked_delivery_id && beforeClaim) { beforeClaim(); beforeClaim = undefined; }
      const matched = patch && table === "vendor_deliveries" && loseDelivery ? [] : rows.filter(r => filters.every(f => f(r)));
      if (patch) matched.forEach(r => Object.assign(r, patch));
      resolve({ data: single ? matched[0] ? { ...matched[0] } : null : matched.map(r => ({ ...r })), error: null, count: matched.length });
    },
  };
  return q;
}
const receipt = (extra: Row = {}): Row => ({ id: "r1", location_id: "shop", vendor_guess_id: "vendor", received_at: "2026-11-11T12:00:00.000Z", linked_delivery_id: null, inbound_message_id: "m1", parse_state: "parsed", attribution_conflict: false, doc_kind: "invoice", ...extra });
const actor = { user: { id: "u", role: "key_holder" }, locations: ["shop"] } as unknown as AuthContext;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.allowed.mockResolvedValue(true);
  deliveries = [{ id: "d1", location_id: "shop", vendor_id: "vendor", delivery_date: "2026-11-11", email_receipt_id: null }];
  receipts = []; beforeClaim = undefined; loseDelivery = false;
  mocks.client.mockReturnValue({ from: query });
});
describe("receiving reverse invoice match", () => {
  it("links exactly one and audits as system; retries do not relink or audit", async () => {
    receipts = [receipt()];
    await attemptReceivingAutoLink("d1");
    await attemptReceivingAutoLink("d1");
    expect(receipts[0]?.linked_delivery_id).toBe("d1");
    expect(deliveries[0]?.email_receipt_id).toBe("r1");
    expect(mocks.audit).toHaveBeenCalledTimes(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ actorId: null, metadata: expect.objectContaining({ source: "auto", direction: "receiving" }) }));
  });
  it("leaves several candidates for a level-4 pick prompt", async () => {
    receipts = [receipt(), receipt({ id: "r2" })];
    await attemptReceivingAutoLink("d1");
    expect(deliveries[0]?.email_receipt_id).toBeNull();
    expect((await loadReceivingReceiptCandidates(actor, "d1")).map(r => r.id)).toEqual(["r1", "r2"]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("does nothing with no candidates", async () => {
    await attemptReceivingAutoLink("d1");
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([
    ["already linked receipt", { linked_delivery_id: "other" }],
    ["different shop", { location_id: "other" }],
    ["different vendor", { vendor_guess_id: "other" }],
    ["before ET window", { received_at: "2026-11-09T04:59:59.999Z" }],
    ["after ET window", { received_at: "2026-11-14T05:00:00.000Z" }],
    ["conflict", { attribution_conflict: true }],
    ["automation awaiting parse", { parse_state: "unparsed" }],
  ])("refuses %s", async (_, extra) => {
    receipts = [receipt(extra)];
    await attemptReceivingAutoLink("d1");
    expect(deliveries[0]?.email_receipt_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["2026-11-09T05:00:00.000Z", "2026-11-14T04:59:59.999Z"])("includes the ET boundary %s", async received_at => {
    receipts = [receipt({ received_at })];
    await attemptReceivingAutoLink("d1");
    expect(deliveries[0]?.email_receipt_id).toBe("r1");
  });
  it("uses a manually assigned vendor stored in vendor_guess_id", async () => {
    receipts = [receipt({ attributed_by: "manual" })];
    await attemptReceivingAutoLink("d1");
    expect(deliveries[0]?.email_receipt_id).toBe("r1");
  });
  it("never replaces a delivery link", async () => {
    deliveries[0]!.email_receipt_id = "existing"; receipts = [receipt()];
    await attemptReceivingAutoLink("d1");
    expect(receipts[0]?.linked_delivery_id).toBeNull();
    expect(deliveries[0]?.email_receipt_id).toBe("existing");
  });
  it("CAS refuses a vendor reassignment after the read", async () => {
    receipts = [receipt()]; beforeClaim = () => { receipts[0]!.vendor_guess_id = "other"; };
    await attemptReceivingAutoLink("d1");
    expect(deliveries[0]?.email_receipt_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("CAS refuses a changed delivery date", async () => {
    receipts = [receipt()]; beforeClaim = () => { deliveries[0]!.delivery_date = "2026-12-01"; };
    await attemptReceivingAutoLink("d1");
    expect(receipts[0]?.linked_delivery_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("compensates the receipt claim when the delivery race is lost", async () => {
    receipts = [receipt()]; loseDelivery = true;
    await attemptReceivingAutoLink("d1");
    expect(receipts[0]?.linked_delivery_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("forward matching uses the same ET date and writer", async () => {
    // UTC Nov 14 is still Nov 13 ET, within two days of Nov 11.
    receipts = [receipt({ received_at: "2026-11-14T04:59:59.999Z" })];
    await attemptAutoLink("r1");
    expect(deliveries[0]?.email_receipt_id).toBe("r1");
  });
  it("receiving authorization still refuses out-of-shop prompt reads", async () => {
    deliveries[0]!.location_id = "other";
    await expect(loadReceivingReceiptCandidates(actor, "d1")).rejects.toMatchObject({ status: 404 });
  });
});

// W20/B112: a delivery has ONE receipt slot. Only an invoice may take it automatically, and only
// an invoice is offered as "the invoice". Manual linking is untouched.
describe("only an invoice takes the delivery's receipt slot (B112)", () => {
  it.each(["confirmation", "statement", "other", null])("a %s never links from the delivery side and is never suggested", async doc_kind => {
    receipts = [receipt({ doc_kind })];
    await attemptReceivingAutoLink("d1");
    expect(deliveries[0]?.email_receipt_id).toBeNull();
    expect(receipts[0]?.linked_delivery_id).toBeNull();
    expect(await loadReceivingReceiptCandidates(actor, "d1")).toEqual([]);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(["confirmation", "statement", "other", null])("a %s never links from the receipt side", async doc_kind => {
    receipts = [receipt({ doc_kind })];
    await attemptAutoLink("r1");
    expect(deliveries[0]?.email_receipt_id).toBeNull();
    expect(receipts[0]?.linked_delivery_id).toBeNull();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it("the invoice still links when a confirmation for the same order is waiting too", async () => {
    receipts = [receipt({ id: "conf", doc_kind: "confirmation", received_at: "2026-11-10T12:00:00.000Z" }), receipt({ id: "inv" })];
    await attemptReceivingAutoLink("d1");
    expect(deliveries[0]?.email_receipt_id).toBe("inv");
    expect(receipts.find(r => r.id === "conf")?.linked_delivery_id).toBeNull();
  });
  it("positive control: the same receipt as an invoice links from the receipt side", async () => {
    receipts = [receipt()];
    await attemptAutoLink("r1");
    expect(deliveries[0]?.email_receipt_id).toBe("r1");
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ source: "auto", direction: "receipt" }) }));
  });
});

it("two deliveries plus one receipt leave B unlinked with a single candidate to confirm", async () => {
  deliveries.push({ ...deliveries[0], id: "d2" });
  receipts = [receipt({ parsed_json: { extraction: { invoiceNumber: "INV-42", totalCents: 12345 } } })];
  await attemptReceivingAutoLink("d2");
  expect(deliveries.every(d => d.email_receipt_id === null)).toBe(true);
  expect(receipts[0]?.linked_delivery_id).toBeNull();
  expect(await loadReceivingReceiptCandidates(actor, "d2")).toEqual([expect.objectContaining({ id: "r1", invoiceNumber: "INV-42", totalCents: 12345 })]);
  expect(mocks.audit).not.toHaveBeenCalled();
});
