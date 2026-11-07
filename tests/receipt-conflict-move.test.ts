import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "@/lib/session";
import { linkReceipt, moveConflictedReceipt } from "@/lib/email-receipts";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { canDoOperationalTask } from "@/lib/operational-task-access";
import { audit } from "@/lib/audit";
import { receiptAutomationAllowed } from "@/lib/receipt-attribution-shared";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));
vi.mock("@/lib/operational-task-access", () => ({ canDoOperationalTask: vi.fn(async () => true), auditOperationalTaskOverride: vi.fn(), canTriageUnattributedReceipt: vi.fn(async () => true) }));
function setup(role: string, locations = ["old", "new"], count = 1) {
  const actor = { user: { id: "actor", role }, locations } as AuthContext;
  const receipt = { id: "receipt", location_id: "old", account_location_id: "new", account_vendor_id: "account-vendor",
    vendor_guess_id: "sender-vendor", attribution_conflict: true, attributed_by: "address", linked_delivery_id: null,
    linked_po_id: null, parse_state: "parsed", inbound_message_id: "message" };
  const delivery = { id: "delivery", location_id: "new", email_receipt_id: null };
  const updates: object[] = [];
  const sb = { from: (table: string) => {
    let patch: object | null = null;
    const row = table === "email_receipts" ? receipt : delivery;
    const q = { select: () => q, eq: () => q, is: () => q,
      update: (value: object) => { patch = value; updates.push(value); return q; },
      maybeSingle: async () => ({ data: { ...row }, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (patch && count) Object.assign(row, patch);
        return Promise.resolve({ error: null, count }).then(resolve);
      },
    }; return q;
  } } as unknown as SupabaseClient;
  vi.mocked(getServiceRoleClient).mockReturnValue(sb);
  return { actor, receipt, updates };
}
describe("manual conflict resolution", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(canDoOperationalTask).mockResolvedValue(true); });
  it.each(["moo", "gm", "key_holder"])("%s authorized for both sides moves then links at the account shop", async role => {
    const { actor, receipt } = setup(role);
    await moveConflictedReceipt(actor, "receipt");
    expect(receipt).toMatchObject({ location_id: "new", vendor_guess_id: "account-vendor", attributed_by: "manual", attribution_conflict: false });
    expect(receiptAutomationAllowed(receipt)).toBe(true);
    await linkReceipt(actor, "receipt", "delivery");
    expect(receipt.linked_delivery_id).toBe("delivery");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "receipt.location_moved", metadata: {
      before: { location_id: "old", vendor_guess_id: "sender-vendor", attribution_conflict: true },
      after: { location_id: "new", vendor_guess_id: "account-vendor", attributed_by: "manual", attribution_conflict: false },
    } }));
  });
  it.each([["gm", ["old"]], ["social_media_mgr", ["old", "new"]]] as const)("refuses %s without eligible access", async (role, locations) => {
    const { actor, updates } = setup(role, [...locations]);
    await expect(moveConflictedReceipt(actor, "receipt")).rejects.toMatchObject({ status: 403 });
    expect(updates).toEqual([]);
    expect(audit).not.toHaveBeenCalled();
  });
  it("requires operational receiving access at both shops", async () => {
    const { actor, updates } = setup("gm");
    vi.mocked(canDoOperationalTask).mockImplementation(async (_actor, location) => location === "old");
    await expect(moveConflictedReceipt(actor, "receipt")).rejects.toMatchObject({ status: 403 });
    expect(updates).toEqual([]);
  });
  it("refuses a lost compare-and-set without claiming an audit success", async () => {
    const { actor } = setup("moo", [], 0);
    await expect(moveConflictedReceipt(actor, "receipt")).rejects.toMatchObject({ status: 409, code: "conflict_changed" });
    expect(audit).not.toHaveBeenCalled();
  });
});
