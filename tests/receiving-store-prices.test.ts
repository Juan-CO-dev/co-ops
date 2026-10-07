import { describe, expect, it } from "vitest";
import { findVendorMismatch, receivingPriceRows } from "../lib/receiving-shared";
import { readFileSync } from "node:fs";

describe("store receipt price isolation", () => {
  const storeSku = { id: "store-sku", vendorId: "store" };
  const reference = { id: "reference-sku", vendorId: "supplier" };
  const unassigned = { id: "unassigned-sku", vendorId: null };

  it("requires a materialized store SKU, including for vendorless references", () => {
    expect(findVendorMismatch("store", [reference], "store")).toEqual(reference);
    expect(findVendorMismatch("store", [unassigned], "store")).toEqual(unassigned);
    expect(findVendorMismatch("store", [storeSku], "store")).toBeNull();
  });

  it("preserves ordinary vendor binding including the unassigned exception", () => {
    expect(findVendorMismatch("supplier", [unassigned, reference])).toBeNull();
    expect(findVendorMismatch("supplier", [storeSku])).toEqual(storeSku);
  });

  it("appends provenance to the store SKU only and omits unpriced lines", () => {
    expect(receivingPriceRows([
      { skuId: storeSku.id, unitPrice: 4.25 },
      { skuId: "unpriced", unitPrice: null },
    ], "2026-10-07", "receiver", "store")).toEqual([{
      vendor_item_id: storeSku.id, unit_price: 4.25,
      effective_date: "2026-10-07", recorded_by: "receiver", source: "store_run",
    }]);
  });

  it("keeps the ordinary vendor price payload byte-identical", () => {
    const lines = [{ skuId: reference.id, unitPrice: 12.5 }];
    const previous = lines.map((l) => ({ vendor_item_id: l.skuId, unit_price: l.unitPrice,
      effective_date: "2026-10-07", recorded_by: "receiver" }));
    expect(JSON.stringify(receivingPriceRows(lines, "2026-10-07", "receiver", "vendor")))
      .toBe(JSON.stringify(previous));
  });

  it("uses the same provenance builder on initial and continued intake", () => {
    const src = readFileSync(new URL("../lib/receiving.ts", import.meta.url), "utf8");
    expect(src).toContain("receivingPriceRows(priced, input.deliveryDate, actor.user.id, vend.source_kind)");
    expect(src).toContain("receivingPriceRows(priced, h.delivery_date, actor.user.id, source.source_kind)");
    expect(src).toContain("validateAndResolveDeliveryLines(sb, input.lines, input.vendorId, vend.source_kind, input.locationId)");
    expect(src).toContain("validateAndResolveDeliveryLines(sb, lines, h.vendor_id, source.source_kind, h.location_id)");
    expect(src).toContain("sku.location_id !== deliveryLocationId");
  });
});
