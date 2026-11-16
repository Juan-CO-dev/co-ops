/**
 * W08/B056 fix round 2 — recovery after a picked SKU becomes unorderable.
 *
 * A manager picks an item in the PO "Add item" picker; before Save, it is switched off at the shop (or
 * otherwise stops fitting the PO). Save then fails with invalid_sku. The manager must be able to drop
 * the unsaved pick — set it to 0 — and save the rest WITHOUT reloading:
 *   - the panel's PATCH payload leaves out an UNSAVED new line at qty 0 (a saved line at 0 stays: that
 *     is how an existing line is removed), and
 *   - the writer skips a zero-qty new line entirely (no fit check, no insert), so an older client that
 *     still sends it is not refused either (covered in po-draft-line-update-fit.test.ts).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildDraftEditPayload } from "@/lib/po-draft-edits-shared";

describe("buildDraftEditPayload (PoPanel's PATCH payload)", () => {
  const saved = new Set(["kept", "zeroed"]);

  it("drops an unsaved new line set to 0, keeps a saved line at 0 (removal) and every positive line", () => {
    const edits = {
      kept: { qty: "3", note: null, orderUnitLabel: "case" },
      zeroed: { qty: "0", note: "gone", orderUnitLabel: null },
      picked: { qty: "2", note: null, orderUnitLabel: "bag" },
      dropped: { qty: "0", note: null, orderUnitLabel: "bag" },
    };
    expect(buildDraftEditPayload(edits, saved)).toEqual([
      { skuId: "kept", orderQty: 3, note: null, orderUnitLabel: "case" },
      { skuId: "zeroed", orderQty: 0, note: "gone", orderUnitLabel: null },
      { skuId: "picked", orderQty: 2, note: null, orderUnitLabel: "bag" },
    ]);
  });

  it("still drops non-numeric and negative quantities (unchanged rule)", () => {
    expect(buildDraftEditPayload({ kept: { qty: "abc", note: null }, picked: { qty: "-1", note: null } }, saved)).toEqual([]);
  });

  it("PoPanel builds its PATCH payload through it, keyed by the PO's saved lines", () => {
    const src = readFileSync("components/ordering/PoPanel.tsx", "utf8");
    const start = src.indexOf("const editPayload = useMemo(");
    const block = src.slice(start, src.indexOf("const anyInvalid", start));
    expect(start).toBeGreaterThan(0);
    expect(block).toContain("buildDraftEditPayload(edits,");
    expect(block).toContain("detail?.lines");
  });
});
