import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ingestInboundReceipt, type InboundReceiptInput } from "@/lib/email-receipts";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/purchase-orders", () => ({ autoPlaceOnEmailEvidence: vi.fn() }));

function storageService(uploadFailure = false) {
  const objects = new Map<string, Uint8Array>();
  const rows: Record<string, unknown>[] = [];
  const tables: string[] = [];
  const upload = vi.fn(async (path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }) => {
    expect(options.upsert).toBe(false);
    if (uploadFailure) return { error: { message: "storage unavailable" } };
    objects.set(path, new Uint8Array(bytes));
    return { error: null };
  });
  const bucket = vi.fn((name: string) => {
    expect(name).toBe("receipts");
    return { upload };
  });
  const sb = {
    storage: { from: bucket },
    from: (table: string) => {
      tables.push(table);
      // A routed ingest must not touch deliveries or purchase orders before parsing.
      if (!["email_receipts", "vendor_contacts", "vendor_ordering_details"].includes(table)) throw new Error(`Unexpected ingest table: ${table}`);
      let pending: Record<string, unknown> | undefined;
      let externalId: unknown;
      const q = {
        select: () => q,
        eq: (column: string, value: unknown) => { if (column === "external_id") externalId = value; return q; },
        ilike: () => q,
        insert: (row: Record<string, unknown>) => { pending = row; return q; },
        returns: async () => ({ error: null, data: table === "vendor_contacts" ? [{ vendor_id: "vendor", email: "billing@example.test" }] : [] }),
        maybeSingle: async () => {
          if (pending) { rows.push(pending); return { error: null, data: { id: "stored-receipt" } }; }
          // Only the idempotency lookup is permitted; an automatic link's receipt read
          // (no external_id condition) makes this test fail even before a target lookup.
          if (!externalId) throw new Error("Unexpected post-ingest receipt read");
          return { error: null, data: rows.some((r) => r.external_id === externalId) ? { id: "stored-receipt" } : null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  vi.mocked(getServiceRoleClient).mockReturnValue(sb);
  return { objects, rows, tables, upload, bucket };
}

const body = new TextEncoder().encode("Fetched invoice body with customer account 001");
const attachment = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]);
function input(): InboundReceiptInput {
  return { inboundMessageId: "inbound-message", addressLocationId: "shop", externalId: "resend-email-id",
    receivedAt: "2026-11-07T12:00:00Z", toAddress: "shop@example.test", fromAddress: "billing@example.test", subject: "Invoice",
    rawEml: { bytes: body, contentType: "text/plain" },
    attachments: [{ filename: "invoice.pdf", contentType: "application/pdf", bytes: attachment }],
  };
}

describe("actual inbound receipt storage writer", () => {
  beforeEach(() => vi.clearAllMocks());
  it("stores fetched body and attachment bytes unchanged and links the routed receipt without early effects", async () => {
    const state = storageService();
    await expect(ingestInboundReceipt(input())).resolves.toEqual({ receiptId: "stored-receipt" });
    expect(state.rows).toHaveLength(1);
    const row = state.rows[0]!;
    expect(row).toMatchObject({ inbound_message_id: "inbound-message", attributed_by: "address", location_id: "shop", source: "inbound", vendor_guess_id: "vendor" });
    const path = row.raw_storage_path as string;
    const paths = row.attachment_paths as Array<{ path: string }>;
    expect(path).toMatch(/^shop\/.+\/message\.eml$/);
    expect(state.objects.get(path)).toEqual(body);
    expect(state.objects.get(paths[0]!.path)).toEqual(attachment);
    expect(state.upload).toHaveBeenCalledTimes(2);
    expect(state.upload.mock.calls.map((call) => call[2].contentType)).toEqual(["text/plain", "application/pdf"]);
    expect(state.tables).toEqual(["email_receipts", "vendor_contacts", "vendor_ordering_details", "email_receipts"]);
  });
  it("records supplied omissions, disallowed content and oversized attachments without storing them", async () => {
    const state = storageService();
    const receipt = input();
    receipt.attachments.push(
      { filename: "large.pdf", contentType: "application/pdf", bytes: new Uint8Array(), omitted: true, omissionReason: "size" },
      { filename: "payload.js", contentType: "application/javascript", bytes: new Uint8Array([1]) },
      { filename: "oversize.pdf", contentType: "application/pdf", bytes: new Uint8Array(15 * 1024 * 1024 + 1) },
    );
    await ingestInboundReceipt(receipt);
    expect(state.upload).toHaveBeenCalledTimes(2);
    expect(state.rows[0]!.attachment_paths).toEqual([
      expect.objectContaining({ filename: "invoice.pdf", path: expect.any(String) }),
      { filename: "large.pdf", contentType: "application/pdf", path: null, omitted: true, omissionReason: "size" },
      { filename: "payload.js", contentType: "application/javascript", path: null, omitted: true, omissionReason: "content_type" },
      { filename: "oversize.pdf", contentType: "application/pdf", path: null, omitted: true, omissionReason: "size" },
    ]);
  });
  it("replays a stored email without another upload or receipt insert", async () => {
    const state = storageService();
    await ingestInboundReceipt(input());
    state.upload.mockClear();
    state.tables.length = 0;
    await expect(ingestInboundReceipt(input())).resolves.toEqual({ receiptId: "stored-receipt" });
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.rows).toHaveLength(1);
    expect(state.tables).toEqual(["email_receipts"]);
  });
  it("a failed bucket write fails ingest before a receipt promises missing bytes", async () => {
    const state = storageService(true);
    await expect(ingestInboundReceipt(input())).rejects.toThrow("storage unavailable");
    expect(state.rows).toHaveLength(0);
    expect(state.objects.size).toBe(0);
  });
});
