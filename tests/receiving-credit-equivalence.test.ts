/**
 * Audit W20/B197: a new delivery's lined credits are now derived from the REQUEST's lines (so they
 * can be written in the header's transaction), where they used to be derived from the lines read
 * back after the insert. Both go through ONE rule, deriveLineCreditDrafts; this proves the two
 * sides feed it the same values, so the credits a vendor owes are unchanged to the cent.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deriveLineCreditDrafts, type LineCreditSource } from "@/lib/receiving-shared";
import type { PackChainLevel } from "@/lib/pack-chain-shared";

type Line = { skuId: string; qtyReceived: number; unitPrice?: number | null; expectedQty?: number | null;
  discrepancyType?: "short" | "over" | "damaged" | "substitution" | null; receivedLevelLabel?: string | null };

/** recordDelivery's mapping of a request line (lib/receiving.ts). */
const fromRequest = (lines: Line[]): LineCreditSource[] => lines.map((l, i) => ({
  deliveryItemId: String(i + 1), skuId: l.skuId, qtyReceived: l.qtyReceived, expectedQty: l.expectedQty ?? null,
  unitPrice: l.unitPrice ?? null, discrepancyType: l.discrepancyType ?? null, receivedLevelLabel: l.receivedLevelLabel?.trim() || null,
}));
/** What buildLineRows stores for that line, then deriveAndUpsertCredits' mapping of the row read back
 *  (numeric columns come back as strings from PostgREST). */
const num = (v: number | string | null) => (v === null ? null : Number(v));
const fromStoredRows = (lines: Line[]): LineCreditSource[] => lines.map((l, i) => {
  const row = {
    id: `item-${i + 1}`, vendor_item_id: l.skuId, qty_received: String(l.qtyReceived),
    received_level_label: l.receivedLevelLabel?.trim() || null,
    received_qty_at_level: l.receivedLevelLabel?.trim() ? String(l.qtyReceived) : null,
    unit_price: l.unitPrice == null ? null : String(l.unitPrice), expected_qty: l.expectedQty == null ? null : String(l.expectedQty),
    discrepancy_type: l.discrepancyType ?? null,
  };
  return { deliveryItemId: row.id, skuId: row.vendor_item_id, qtyReceived: num(row.received_qty_at_level) ?? num(row.qty_received) ?? 0,
    expectedQty: num(row.expected_qty), unitPrice: num(row.unit_price), discrepancyType: row.discrepancy_type, receivedLevelLabel: row.received_level_label };
});

const level = (id: string, label: string, containsQty: number, containsLevelId: string | null, unit: string | null): PackChainLevel =>
  ({ id, label, containsQty, containsLevelId, containsMeasureUnit: unit, displayOrdinal: 0 }) as unknown as PackChainLevel;
// case -> 12 each -> 16 oz
const chains = new Map<string, PackChainLevel[]>([["chained", [level("L1", "case", 12, "L2", null), level("L2", "each", 16, null, "oz")]]]);
const packFormat = new Map<string, string | null>([["chained", "case"], ["flat", "bag"], ["plain", null]]);

const lines: Line[] = [
  { skuId: "plain", qtyReceived: 4, expectedQty: 5, unitPrice: 12.5, discrepancyType: "short" },                       // 1 short at $12.50
  { skuId: "plain", qtyReceived: 2 },                                                                                   // no flag: no credit
  { skuId: "chained", qtyReceived: 20, expectedQty: 24, unitPrice: 36, discrepancyType: "short", receivedLevelLabel: " each " }, // 4 each at $3
  { skuId: "chained", qtyReceived: 3, expectedQty: 2, unitPrice: 36, discrepancyType: "over", receivedLevelLabel: "case" },     // 1 case at $36
  { skuId: "flat", qtyReceived: 1, expectedQty: null, unitPrice: 9.99, discrepancyType: "damaged" },                   // judgment call
  { skuId: "flat", qtyReceived: 2.5, expectedQty: 3, unitPrice: null, discrepancyType: "substitution" },               // no price
  { skuId: "flat", qtyReceived: 6, expectedQty: 6, unitPrice: 1, discrepancyType: "short" },                           // flagged, no delta
  { skuId: "chained", qtyReceived: 1, expectedQty: 2, unitPrice: 36, discrepancyType: "short", receivedLevelLabel: "pallet" }, // level not on the chain
  { skuId: "plain", qtyReceived: 0.1, expectedQty: 0.3, unitPrice: 0.07, discrepancyType: "short" },                   // float cents
];

describe("lined credits: the request-side derivation equals the read-back derivation", () => {
  for (const store of [false, true]) {
    it(`same reason, qty and amount for every line, in order (${store ? "store run" : "vendor delivery"})`, () => {
      const requested = deriveLineCreditDrafts(fromRequest(lines), { chains, packFormat, store });
      const readBack = deriveLineCreditDrafts(fromStoredRows(lines), { chains, packFormat, store });
      expect(requested.map(({ deliveryItemId, ...rest }) => ({ line: Number(deliveryItemId), ...rest })))
        .toEqual(readBack.map(({ deliveryItemId, ...rest }) => ({ line: Number(deliveryItemId.replace("item-", "")), ...rest })));
      expect(requested).toHaveLength(8); // every flagged line, none of the unflagged
    });
  }
  it("the amounts are the W04/B046 level prices", () => {
    const drafts = deriveLineCreditDrafts(fromRequest(lines), { chains, packFormat, store: false });
    const at = (line: number) => drafts.find((d) => d.deliveryItemId === String(line))!;
    expect(at(1)).toMatchObject({ reason: "short", qty: 1, amountCents: 1250 });
    expect(at(3)).toMatchObject({ reason: "short", qty: 4, amountCents: 1200 });   // 36 / 12 per each
    expect(at(4)).toMatchObject({ reason: "over", qty: 1, amountCents: 3600 });
    expect(at(5)).toMatchObject({ reason: "damaged", qty: null, amountCents: null });
    expect(at(6)).toMatchObject({ reason: "substitution", qty: 0.5, amountCents: null });
    expect(at(7)).toMatchObject({ qty: null, amountCents: null });
    expect(at(8)).toMatchObject({ qty: 1, amountCents: null });                     // level not on the chain: never a guess
    expect(drafts.some((d) => d.deliveryItemId === "2")).toBe(false);
    // A store run's price is already per level: no division.
    expect(deriveLineCreditDrafts(fromRequest(lines), { chains, packFormat, store: true }).find((d) => d.deliveryItemId === "3"))
      .toMatchObject({ qty: 4, amountCents: 14400 });
  });
  it("chains for SKUs with no levelled line make no difference (the read-back path loads fewer)", () => {
    const flat = lines.filter((l) => !l.receivedLevelLabel);
    expect(deriveLineCreditDrafts(fromRequest(flat), { chains, packFormat, store: false }))
      .toEqual(deriveLineCreditDrafts(fromRequest(flat), { chains: new Map(), packFormat: new Map(), store: false }));
  });
});

describe("both write paths use the one rule", () => {
  const src = readFileSync("lib/receiving.ts", "utf8").replace(/\r\n/g, "\n");
  const body = (signature: string) => { const start = src.indexOf(signature); expect(start).toBeGreaterThan(-1); return src.slice(start, src.indexOf("\n}\n", start)); };
  it("recordDelivery and deriveAndUpsertCredits both call deriveLineCreditDrafts, and nothing prices a credit by hand", () => {
    expect(body("export async function recordDelivery(")).toContain("deriveLineCreditDrafts(");
    expect(body("async function deriveAndUpsertCredits(")).toContain("deriveLineCreditDrafts(");
    expect(src).not.toContain("creditUnitPrice(");
    expect(src).not.toContain("deriveCreditDrafts(");
  });
  it("a new delivery is written by one call, and the old four-step write survives only as the missing-function fallback", () => {
    const record = body("export async function recordDelivery(");
    expect(record).toContain('await sb.rpc("record_delivery_atomic", {');
    const fallback = record.slice(record.indexOf("} else {", record.indexOf("rpcNotInstalled(atomic.error)")));
    expect(record.indexOf('.from("vendor_deliveries").insert(')).toBeGreaterThan(record.indexOf("rpcNotInstalled(atomic.error)"));
    for (const step of ['.from("vendor_deliveries").insert(headerRow)', '.from("vendor_delivery_items").insert(', "await deriveAndUpsertCredits(", "await insertMissingExpectedCredits("]) {
      expect(fallback).toContain(step);
      expect(record.split(step)).toHaveLength(2); // exactly once, inside the fallback
    }
    // Follow-ups still come after the write, on the new delivery.
    expect(record.indexOf('await sb.rpc("record_receiving_prices"')).toBeGreaterThan(record.indexOf('await sb.rpc("record_delivery_atomic"'));
    expect(record).toContain("await attemptReceivingAutoLink(deliveryId)");
  });
});
