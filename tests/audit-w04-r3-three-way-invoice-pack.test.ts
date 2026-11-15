import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@/lib/session";
import type { PackChainLevel } from "@/lib/pack-chain-shared";
import type { PackPoint, ResolvedPack } from "@/lib/sku-versions-shared";

/**
 * Audit W04 fix round 3 (B045, reviewer P2 on lib/po-match.ts:137). The invoice leg was dated by the
 * EMAIL's arrival, so an invoice forwarded late — after the case went from 12 to 24 bottles — was read
 * through the 24-bottle case and falsely flagged billed_over_received. The invoice bills the
 * TRANSACTION it is linked to (the PO and its receipt), so its pack is the pack that transaction
 * happened under; when the order and the receipt disagree, the invoice's pack is ambiguous and the
 * billed comparison is suppressed, never flagged.
 */
type Row = Record<string, unknown>;
// The case became 24 bottles at 2026-10-05T00:00:00Z (see the pack mock below).
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  detail: {} as Record<string, unknown>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/purchase-orders", () => ({ loadPoDetail: async () => state.detail }));
vi.mock("@/lib/prep-consumption", () => {
  const bottles = (perCase: number): PackChainLevel[] => [
    { id: `case${perCase}`, label: "case", containsQty: perCase, containsLevelId: `bottle${perCase}`, containsMeasureUnit: null, displayOrdinal: 0 },
    { id: `bottle${perCase}`, label: "bottle", containsQty: 16.9, containsLevelId: null, containsMeasureUnit: "fl oz", displayOrdinal: 1 },
  ];
  const packOf = (perCase: number, from: string): ResolvedPack => ({ levels: bottles(perCase), versionId: `v${perCase}`, locationId: null, effectiveFrom: from });
  return {
    loadMeasures: async () => new Map([["fl oz", { dimension: "volume", toBaseFactor: 1 }], ["count", { dimension: "count", toBaseFactor: 1 }]]),
    // Today's pack is the 24-bottle case.
    loadSkuPackChains: async (ids: string[]) => new Map(ids.map((id) => [id, bottles(24)])),
    // Versioned SKU: 12 bottles before CHANGE, 24 from it.
    loadSkuPacksAtPoints: async (points: readonly PackPoint[]) => ({
      packs: new Map(points.map((p) => [p.key, p.asOf < "2026-10-05T00:00:00.000Z" ? packOf(12, "2026-01-01T00:00:00Z") : packOf(24, "2026-10-05T00:00:00Z")])),
      versioned: new Set(points.map((p) => p.skuId)),
    }),
  };
});
vi.mock("@/lib/supabase-server", () => ({
  getServiceRoleClient: () => ({
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      let lim = Number.POSITIVE_INFINITY;
      const run = () => ({ data: (state.tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, lim), error: null });
      const q: Record<string, unknown> = {
        select: () => q, order: () => q, returns: () => q,
        limit: (n: number) => { lim = n; return q; },
        eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
        in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q; },
        then: (resolve: (x: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return q;
    },
  }),
}));

const SKU = "11111111-1111-4111-8111-111111111111";
const actor = {} as AuthContext;

function setup(opts: { confirmedAt: string; receivedAt: string | null; receivedLevel?: string; receivedQty?: number; billedCases: number; invoiceAt: string }) {
  state.detail = {
    confirmedSnapshot: { lines: [{ skuId: SKU, name: "Water", itemNumber: null, qty: 1, unitLabel: "case", priceCents: 2400 }] },
    deliveryIds: opts.receivedAt ? ["d1"] : [],
    confirmedAt: opts.confirmedAt,
    locationId: "loc",
  };
  state.tables = {
    vendor_delivery_items: opts.receivedAt
      ? [{ vendor_item_id: SKU, delivery_id: "d1", qty_received: null, received_qty_at_level: opts.receivedQty ?? 1, received_level_label: opts.receivedLevel ?? "case", created_at: opts.receivedAt }]
      : [],
    vendor_deliveries: [{ id: "d1", location_id: "loc" }],
    email_receipts: [{
      id: "r1", linked_po_id: "po", doc_kind: "invoice", received_at: opts.invoiceAt,
      parsed_json: { extraction: { lines: [{ description: "Water", qty: opts.billedCases, unit: "CS", extendedCents: 2400 * opts.billedCases }] } },
    }],
    vendor_items: [],
  };
}

async function flags() {
  const { buildThreeWayView } = await import("@/lib/po-match");
  const view = await buildThreeWayView(actor, "po");
  return view.lines.find((l) => l.key === SKU)!.flags;
}

beforeEach(() => { state.tables = {}; state.detail = {}; });

describe("W04 r3: the invoice leg's pack comes from the transaction it bills, not the email's arrival", () => {
  it("a delayed invoice forwarded after a 12 -> 24 pack change is a clean match (the reviewer's repro)", async () => {
    setup({ confirmedAt: "2026-10-01T12:00:00.000Z", receivedAt: "2026-10-02T12:00:00.000Z", billedCases: 1, invoiceAt: "2026-10-10T12:00:00.000Z" });
    expect(await flags()).toEqual([]);
  });

  it("a real over-bill on a delayed invoice still flags under the transaction's 12-bottle pack", async () => {
    setup({ confirmedAt: "2026-10-01T12:00:00.000Z", receivedAt: "2026-10-02T12:00:00.000Z", billedCases: 2, invoiceAt: "2026-10-10T12:00:00.000Z" });
    expect(await flags()).toEqual(["billed_over_received"]);
  });

  it("an invoice that arrives before the receipt reads through the order's pack", async () => {
    setup({ confirmedAt: "2026-10-01T12:00:00.000Z", receivedAt: null, billedCases: 1, invoiceAt: "2026-10-10T12:00:00.000Z" });
    expect(await flags()).toEqual([]);
  });

  it("order under the 12-bottle case, receipt under the 24: the invoice's pack is ambiguous, so the billed comparison is suppressed", async () => {
    // 1 case of 24 received; 2 CS billed is 24 bottles under the old pack and 48 under the new one.
    setup({ confirmedAt: "2026-10-01T12:00:00.000Z", receivedAt: "2026-10-06T12:00:00.000Z", billedCases: 2, invoiceAt: "2026-10-10T12:00:00.000Z" });
    expect(await flags()).not.toContain("billed_over_received");
  });
});
