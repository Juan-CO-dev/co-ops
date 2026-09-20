import { expect, it } from "vitest";
import type { ProdExport } from "../scripts/vendor-exports/catalog";
import { checkReview, formatReviewCounts, REVIEW_COLUMNS } from "../scripts/vendor-exports/review-check";

it("validates review CSV identifiers, ownership, sections and required cells offline", () => {
  const skuId = "00000000-0000-0000-0000-000000000001";
  const vendorId = "00000000-0000-0000-0000-000000000002";
  const levelId = "00000000-0000-0000-0000-000000000003";
  const otherSkuId = "00000000-0000-0000-0000-000000000004";
  const catalog = { vendor_items: [{ id: skuId, name: "Butter", vendor_id: vendorId }, { id: otherSkuId, name: "Other", vendor_id: vendorId }], vendors: [{ id: vendorId, name: "Vendor" }], sku_pack_levels: [{ id: levelId, sku_id: skuId }], vendor_price_history: [] } as unknown as ProdExport;
  const base = ["D001", "dedupe_level", "Vendor", skuId, "Butter", "001", JSON.stringify({ id: levelId, sku_id: skuId }), "", "pack", "high", "report.md:12", "false", "quote, \"then\"\nnew line"];
  const csv = (cells = base) => REVIEW_COLUMNS.join(",") + "\n" + cells.map(s => `"${s.replaceAll('"', '""')}"`).join(",") + "\n";
  expect(formatReviewCounts(checkReview(csv(), catalog))).toContain("dedupe_level: 1");
  expect(checkReview(csv(), catalog)).toMatchObject({ needsJuan: 0, total: 1 });
  for (const [index, value, error] of [[1, "delete", "unknown kind"], [3, "00000000-0000-0000-0000-000000000099", "unknown sku_id"], [6, '{"vendor_item_id":"bad"}', "unknown vendor_item_id"], [6, JSON.stringify({ id: levelId, "sku_pack_levels.id": vendorId }), "unknown sku_pack_levels.id"], [2, "Other vendor", "SKU/vendor mismatch"], [11, "yes", "needs_juan"], [10, "", "missing evidence"]] as const) {
    const cells = [...base]; cells[index] = value;
    expect(() => checkReview(csv(cells), catalog)).toThrow(error);
  }
  catalog.sku_pack_levels[0]!.sku_id = otherSkuId;
  expect(() => checkReview(csv(), catalog)).toThrow("pack level belongs to another SKU");
  const guideId = "00000000-0000-0000-0000-000000000005";
  const sectionId = "00000000-0000-0000-0000-000000000006";
  const lineId = "00000000-0000-0000-0000-000000000007";
  catalog.vendor_order_guides = [{ id: guideId, vendor_id: vendorId, name: "Guide", updated_at: "2026-09-19" }];
  catalog.order_guide_sections = [{ id: sectionId, guide_id: guideId, name: "Section", position: 0 }];
  catalog.order_guide_lines = [{ id: lineId, section_id: sectionId, position: 0, sku_id: null, label: "Eggs", item_number: null, note: null }];
  const eggs = ["I068", "item_number", "Vendor", "", "Eggs", "", JSON.stringify({ guide_line_id: lineId, sku_id: null }), "517842", "Juan answer", "medium", "spec.md:177", "true", "tentative — confirm at the door"];
  expect(checkReview(csv(eggs), catalog)).toMatchObject({ total: 1, needsJuan: 1 });
  catalog.order_guide_lines[0]!.sku_id = skuId;
  expect(() => checkReview(csv(eggs), catalog)).toThrow("invalid unlinked Eggs amendment");
});
