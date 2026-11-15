import { describe, expect, it } from "vitest";
import { applyScanToIntake, type IntakeScanState } from "@/lib/scan-field-shared";
import { deriveCreditDrafts, levelChangePatch } from "@/lib/receiving-shared";

/**
 * Audit W04 fix round 3 (B046, reviewer P2 on components/receiving/ReceivingForm.tsx:607). The
 * level picker rescaled a PO row's expectation (levelChangePatch), but a barcode scan that moved
 * the row's level (blank → each) did not: after picking the blank/default level and scanning 24
 * inner units, the row expected "2 each", suggested Over and an accepted Over credited 22 units.
 * Every level-changing transition now goes through the SAME conversion.
 * Chain: case = 12 x each. PO: 2 cases.
 */
const labels = ["case", "each"];
const counts = [12];
type Row = { key: string; skuId: string; level: string; qty: string; expanded: boolean; confirmed: boolean; expectedQty: number | null; discrepancy: "short" | "over" | "damaged" | "substitution" | null };
const relevel = (l: Row, next: string) => levelChangePatch(l, next, labels, counts);
const poRow: Row = { key: "k1", skuId: "x", level: "case", qty: "", expanded: false, confirmed: false, expectedQty: 2, discrepancy: null };

function scan(state: IntakeScanState<Row>, levelLabel: string): IntakeScanState<Row> {
  return applyScanToIntake(state, { skuId: "x", levelLabel, level: levelLabel === "case" ? "case" : "inner", code: "0001", newLine: null, lineKey: null, relevel });
}

describe("W04 r3: a scan that changes a row's level converts its expectation like the picker does", () => {
  it("picker case -> blank (default) keeps two root packs, then 24 inner scans expect 24 each: no Over, no credit", () => {
    // The picker: the same patch the form's setLine applies.
    const picked: Row = { ...poRow, ...levelChangePatch(poRow, "", labels, counts) };
    expect(picked).toMatchObject({ level: "", expectedQty: 2 });

    let state: IntakeScanState<Row> = { lines: [picked], scanned: {} };
    for (let i = 0; i < 24; i++) state = scan(state, "each");
    const row = state.lines[0]!;
    expect(state.lines).toHaveLength(1);
    expect(row).toMatchObject({ level: "each", qty: "24", expectedQty: 24 });
    // No Over: the count equals the expectation, and even an Over chosen by hand credits nothing.
    expect(Number(row.qty)).toBe(row.expectedQty);
    expect(deriveCreditDrafts([{ deliveryItemId: "l", skuId: "x", qtyReceived: Number(row.qty), expectedQty: row.expectedQty, unitPrice: 1.5, discrepancyType: "over" }]))
      .toEqual([{ deliveryItemId: "l", skuId: "x", reason: "over", qty: null, amountCents: null }]);
  });

  it("an unconvertible scanned level clears the expectation and its flag rather than leaving it in the wrong unit", () => {
    const blank: Row = { ...poRow, level: "", discrepancy: "short" };
    const next = scan({ lines: [blank], scanned: {} }, "pallet");
    expect(next.lines[0]).toMatchObject({ level: "pallet", qty: "1", expectedQty: null, discrepancy: null });
  });

  it("a scan at the row's own level changes nothing about the expectation", () => {
    const next = scan({ lines: [poRow], scanned: {} }, "case");
    expect(next.lines[0]).toMatchObject({ level: "case", qty: "1", expectedQty: 2 });
  });

  it("an explicit pick (lineKey) onto a blank row converts too", () => {
    const blank: Row = { ...poRow, level: "" };
    const next = applyScanToIntake({ lines: [blank], scanned: {} }, { skuId: "x", levelLabel: "each", level: "inner", code: null, newLine: null, lineKey: "k1", relevel });
    expect(next.lines[0]).toMatchObject({ level: "each", qty: "1", expectedQty: 24 });
  });
});
