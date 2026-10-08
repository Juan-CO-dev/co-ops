import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { processToastCateringOrders } from "@/lib/catering/toast-catering-scan";
import { extractToastOrders, type ToastOrderClass } from "@/lib/toast/catering-orders-shared";
import { systemMoveStage } from "@/lib/catering/system-intake";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/catering/system-intake", () => ({ resolveCateringManager: vi.fn(async () => null), systemMoveStage: vi.fn() }));

let existing: Record<string, unknown> | null;
let writes: Array<{ table: string; values: Record<string, unknown> }>;
let allowLeadCreation: boolean;
beforeEach(() => {
  vi.clearAllMocks();
  writes = [];
  allowLeadCreation = false;
  existing = { id: "ledger", order_guid: "order", classification: "catering", voided: false, toast_modified_at: "2026-10-07T12:00:00Z", lead_id: "human-operated-lead", processing_result: "created_lead" };
  const from = (table: string) => {
    if (table !== "toast_catering_orders" && !allowLeadCreation) throw new Error(`Unexpected write/read of ${table}`);
    let mutation = false;
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      abortSignal: () => query,
      update: (values: Record<string, unknown>) => { mutation = true; writes.push({ table, values }); return query; },
      insert: (values: Record<string, unknown>) => { mutation = true; writes.push({ table, values }); return query; },
      returns: async () => ({ data: existing ? [existing] : [], error: null }),
      maybeSingle: async () => ({ data: mutation ? { id: "ledger" } : existing, error: null }),
      then: (resolve: (value: { data: null; error: null }) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return query;
  };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from } as unknown as ReturnType<typeof getServiceRoleClient>);
});

async function project(classification: ToastOrderClass = "ezcater") {
  const orders = extractToastOrders([{ guid: "order", businessDate: 20261007, modifiedDate: "2026-10-07T12:00:00Z", diningOption: { guid: "ez" },
    checks: [{ totalAmount: 125, customer: { firstName: "Synthetic" }, selections: [{ item: { guid: "item" }, displayName: "Platter", quantity: 2, price: 125 }] }],
  }]);
  return processToastCateringOrders("shop", orders, { names: new Map([["ez", "EZ Cater"]]), classifications: new Map([["order", classification]]) }, new AbortController().signal);
}

describe("capture catering reclassification", () => {
  it("refreshes full external projection but flags an existing house lead without changing human work", async () => {
    expect(await project()).toMatchObject({ ok: false, errors: 1, error: "capture_catering_processing_failed" });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values).toMatchObject({ classification: "ezcater", total_cents: 12500, customer_name: "Synthetic", items: [{ name: "Platter", quantity: 2, priceCents: 12500, voided: false }], processing_result: "reclassification_needs_review" });
    expect(writes[0]?.values).not.toHaveProperty("lead_id");
    expect(systemMoveStage).not.toHaveBeenCalled();
  });
  it("keeps the review marker degraded on an unchanged retry", async () => {
    existing = { ...existing, classification: "ezcater", processing_result: "reclassification_needs_review" };
    expect(await project()).toMatchObject({ ok: false, errors: 1 });
    expect(writes[0]?.values.processing_result).toBe("reclassification_needs_review");
  });
  it("refreshes a normal external order without a linked lead successfully", async () => {
    existing = { ...existing, classification: "ezcater", lead_id: null, processing_result: "attributed_to_ezcater" };
    expect(await project()).toMatchObject({ ok: true, errors: 0 });
    expect(writes[0]?.values).toMatchObject({ total_cents: 12500, classification: "ezcater", processing_result: "attributed_to_ezcater" });
  });
  it("refreshes an external-to-house map correction even with unchanged source timestamp", async () => {
    existing = { ...existing, classification: "ezcater", lead_id: null, processing_result: "attributed_to_ezcater" };
    allowLeadCreation = true;
    expect(await project("catering")).toMatchObject({ ok: true, createdLeads: 1 });
    expect(writes[0]?.values).toMatchObject({ classification: "catering", total_cents: 12500, processing_result: "refreshed_no_lead" });
    expect(writes.filter((write) => write.table === "catering_pipeline")).toHaveLength(1);
  });
  it("refreshes a house-to-retail correction and preserves human work for review", async () => {
    expect(await project("not_catering")).toMatchObject({ ok: false, errors: 1, catering: 0, attributed: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values).toMatchObject({ classification: "not_catering", total_cents: 12500, processing_result: "reclassification_needs_review" });
    expect(writes[0]?.values).not.toHaveProperty("lead_id");
    expect(systemMoveStage).not.toHaveBeenCalled();
  });
  it("does not insert unseen retail orders into the restricted ledger", async () => {
    existing = null;
    expect(await project("not_catering")).toMatchObject({ ok: true, errors: 0 });
    expect(writes).toEqual([]);
  });
  it("does not recreate a lead when a review-marked order maps back to house", async () => {
    existing = { ...existing, classification: "not_catering", lead_id: null, processing_result: "reclassification_needs_review" };
    expect(await project("catering")).toMatchObject({ ok: false, createdLeads: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values).toMatchObject({ classification: "catering", processing_result: "reclassification_needs_review" });
  });
});

it("ledgers an unknown label as flagged not-catering without failing the scan", async () => {
  existing = null;
  const orders = extractToastOrders([{ guid: "order", businessDate: 20261007, checks: [] }]);
  const result = await processToastCateringOrders("shop", orders, {
    names: new Map(), classifications: new Map([["order", "not_catering"]]),
    diagnostics: new Map([["order", "capture_catering_channel_unreviewed"]]),
  }, new AbortController().signal);
  expect(result).toMatchObject({ ok: true, errors: 0, diagnostics: { capture_catering_channel_unreviewed: 1 } });
  expect(writes[0]?.values).toMatchObject({ classification: "not_catering", processing_result: "capture_catering_channel_unreviewed" });
});
