import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReceipt } from "@/lib/receipt-parse";
import { buildThreeWayLines } from "@/lib/po-match-shared";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email-receipts", () => ({
  matchReceiptToPo: vi.fn(async () => null), applyReceiptPoEffects: vi.fn(async () => {}),
  attemptAutoLink: vi.fn(async () => {}), EmailReceiptError: Error, RECEIPT_MIN: 4,
}));

/** Audit W04/B044: invoice credits survive the parse and never take a SKU row's billed leg. */
function service() {
  const writes: Record<string, unknown>[] = [];
  const receipt = { id: "receipt", inbound_message_id: null, attributed_by: "manual", parse_state: "unparsed", source: "upload",
    location_id: "shop", vendor_guess_id: null, raw_storage_path: "message.eml", attachment_paths: [], linked_po_id: "po" };
  const sb = {
    from: () => {
      const q = {
        select: () => q, eq: () => q, is: () => q, order: () => q, range: () => q,
        update: (write: Record<string, unknown>) => { writes.push(write); return q; },
        maybeSingle: async () => ({ error: null, data: receipt }),
        returns: async () => ({ data: [], error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, count: 1 }).then(resolve),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ error: null, data: new Blob(["invoice document"]) }) }) },
  } as unknown as SupabaseClient;
  return { sb, writes };
}

const MODEL_JSON = {
  docKind: "invoice", totalCents: 8000,
  lines: [
    { description: "CREDIT - SUB ROLL MISPICK", qty: -1, extendedCents: -2000 },
    { description: "SUB ROLL 12CT", qty: 4, unitPriceCents: 2500, extendedCents: 10000 },
  ],
};

describe("W04/B044 invoice credits", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ANTHROPIC_API_KEY", "test-value"); vi.stubEnv("AI_PARSE_MODEL", ""); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("keeps a credit line's negative qty and amount, and tells the model credits are negative", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(MODEL_JSON) }] })));
    vi.stubGlobal("fetch", fetchMock);
    const { sb, writes } = service();
    await expect(parseReceipt(sb, "receipt")).resolves.toMatchObject({ ok: true });
    const extraction = (writes[0]!.parsed_json as { extraction: { totalCents: number; lines: unknown[] } }).extraction;
    expect(extraction.totalCents).toBe(8000);
    expect(extraction.lines[0]).toEqual({ description: "CREDIT - SUB ROLL MISPICK", qty: -1, extendedCents: -2000 });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(JSON.stringify(body)).toMatch(/NEGATIVE/);
  });

  it("still refuses fractional cents", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ docKind: "invoice", totalCents: -12.5, lines: [{ description: "X", extendedCents: -0.5 }] }) }] }))));
    const { sb, writes } = service();
    await parseReceipt(sb, "receipt");
    const extraction = (writes[0]!.parsed_json as { extraction: Record<string, unknown> }).extraction;
    expect(extraction.totalCents).toBeUndefined();
    expect(extraction.lines).toEqual([{ description: "X" }]);
  });

  it("a credit line never takes the SKU row; the real charge joins it and totals are signed", () => {
    const v = buildThreeWayLines(
      [{ skuId: "roll", name: "Sub Roll", itemNumber: null, qty: 4, unitLabel: "case", priceCents: 2500 }],
      [{ skuId: "roll", qty: 4, level: "case" }],
      [
        { description: "CREDIT - SUB ROLL MISPICK", qty: -1, unit: null, unitPriceCents: null, extendedCents: -2000 },
        { description: "SUB ROLL 12CT", qty: 4, unit: "case", unitPriceCents: 2500, extendedCents: 10000 },
      ],
      true,
    );
    const roll = v.lines.find((l) => l.key === "roll")!;
    expect(roll).toMatchObject({ billedQty: 4, billedCents: 10000, flags: [] });
    const credit = v.lines.find((l) => l.key !== "roll")!;
    expect(credit).toMatchObject({ name: "CREDIT - SUB ROLL MISPICK", billedQty: -1, billedCents: -2000, flags: ["invoice_credit"] });
    expect(v.totals.billedCents).toBe(8000);
  });

  it("a legacy credit row stored with no numbers does not take the SKU row either", () => {
    const v = buildThreeWayLines(
      [{ skuId: "roll", name: "Sub Roll", itemNumber: null, qty: 4, unitLabel: null, priceCents: null }],
      [{ skuId: "roll", qty: 4, level: null }],
      [
        { description: "CREDIT - SUB ROLL MISPICK", qty: null, unit: null, unitPriceCents: null, extendedCents: null },
        { description: "SUB ROLL 12CT", qty: 4, unit: null, unitPriceCents: null, extendedCents: 10000 },
      ],
      true,
    );
    expect(v.lines.find((l) => l.key === "roll")).toMatchObject({ billedQty: 4, billedCents: 10000, flags: [] });
    expect(v.lines.find((l) => l.key !== "roll")!.flags).toEqual(["unmatched_invoice_line"]);
  });
});
