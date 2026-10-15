/**
 * Catalog Phase 2a — a delivery's price lands in the shop's lane: its live one, else a lane the
 * delivery OPENS (decision e) — decided IN THE DATABASE under the SKU lock (record_receiving_prices),
 * so a lane opened or retired concurrently can never strand an invoice price, and a shop's first
 * invoice never moves the global price other shops inherit (Astra 2a#9, r2#4). The payload is unchanged.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { receivingPriceRows } from "@/lib/receiving-shared";

describe("receiving prices", () => {
  it("the payload is byte-identical to before (no lane in TS)", () => {
    expect(JSON.stringify(receivingPriceRows([{ skuId: "a", unitPrice: 12.5 }], "2026-10-07", "kh", "vendor")))
      .toBe(JSON.stringify([{ vendor_item_id: "a", unit_price: 12.5, effective_date: "2026-10-07", recorded_by: "kh" }]));
  });
  it("both receiving writes go through the locked RPC with the delivery's shop, never a bare insert", () => {
    const src = readFileSync("lib/receiving.ts", "utf8");
    expect(src).toContain('sb.rpc("record_receiving_prices", { p_location: input.locationId, p_rows: receivingPriceRows(priced, input.deliveryDate, actor.user.id, vend.source_kind) })');
    expect(src).toContain('sb.rpc("record_receiving_prices", { p_location: h.location_id, p_rows: receivingPriceRows(priced, h.delivery_date, actor.user.id, source.source_kind) })');
    expect(src).not.toContain('from("vendor_price_history").insert(');
  });
});
