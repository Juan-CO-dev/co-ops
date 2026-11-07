import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyReceiptPoEffects, attemptAutoLink, matchReceiptToPo } from "@/lib/email-receipts";
import { getServiceRoleClient } from "@/lib/supabase-server";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));

describe("receipt automation checks persisted attribution", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    { inbound_message_id: "message", parse_state: "parsed", attribution_conflict: true, location_id: "shop" },
    { inbound_message_id: "message", parse_state: "unparsed", attribution_conflict: false, location_id: "shop" },
    { inbound_message_id: "message", parse_state: "parsed", attribution_conflict: false, location_id: null },
  ])("blocks every automatic effect for %j", async (state) => {
    const writes = vi.fn();
    const tables: string[] = [];
    const sb = { from: (table: string) => {
      tables.push(table);
      const q = { select: () => q, eq: () => q, update: writes, maybeSingle: async () => ({ error: null, data: {
        ...state, id: "receipt", vendor_guess_id: "vendor", linked_delivery_id: null,
        linked_po_id: "order", doc_kind: "invoice", received_at: "2026-11-07T12:00:00Z",
      } }) };
      return q;
    } } as unknown as SupabaseClient;
    vi.mocked(getServiceRoleClient).mockReturnValue(sb);
    await attemptAutoLink("receipt");
    await expect(matchReceiptToPo(sb, { id: "receipt", subject: "AA-20261107-VENDOR", locationId: "shop", vendorGuessId: "vendor", receivedAt: "2026-11-07T12:00:00Z" })).resolves.toBeNull();
    await applyReceiptPoEffects(sb, "receipt", "po_code");
    expect(writes).not.toHaveBeenCalled();
    expect(tables).toEqual(["email_receipts", "email_receipts", "email_receipts"]);
  });
});
