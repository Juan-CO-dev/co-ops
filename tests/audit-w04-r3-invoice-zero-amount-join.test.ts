import { describe, expect, it } from "vitest";
import { buildThreeWayLines, type InvoiceLineInput } from "@/lib/po-match-shared";

/**
 * Audit W04 fix round 3 (B044, reviewer P2 on lib/po-match-shared.ts:440). A zero- or null-amount
 * invoice line (a zero-value adjustment, or a legacy credit that kept a positive qty but lost its
 * negative amount) is not a charge, so it must never take a SKU's billed join: when it did, the real
 * charge line after it found no free row and the over-billing it carried went unflagged. Such lines
 * stay on the view as their own rows.
 */
const order = [{ skuId: "roll", name: "Sub Roll", itemNumber: null, qty: 4, unitLabel: "case", priceCents: 2500 }];
const received = [{ skuId: "roll", qty: 4, level: "case" }];
const charge: InvoiceLineInput = { description: "SUB ROLL 12CT", qty: 5, unit: "CS", unitPriceCents: 2500, extendedCents: 12500 };

describe("W04 r3: zero/null-amount invoice lines never take the SKU's billed join", () => {
  it("a zero-value 'CREDIT SUB ROLL' before the real charge: 5 billed vs 4 received still flags", () => {
    const v = buildThreeWayLines(order, received, [
      { description: "CREDIT SUB ROLL", qty: 0, unit: "CS", unitPriceCents: 0, extendedCents: 0 },
      charge,
    ], true);
    const roll = v.lines.find((l) => l.key === "roll")!;
    expect(roll).toMatchObject({ billedQty: 5, billedCents: 12500 });
    expect(roll.flags).toEqual(["billed_over_received"]);
    const kept = v.lines.filter((l) => l.key !== "roll");
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: "CREDIT SUB ROLL", billedQty: 0, billedCents: 0, flags: ["unmatched_invoice_line"] });
  });

  it("a legacy credit with a positive qty but a lost (null) amount does not take the join either", () => {
    const v = buildThreeWayLines(order, received, [
      { description: "CREDIT SUB ROLL MISPICK", qty: 1, unit: "CS", unitPriceCents: null, extendedCents: null },
      charge,
    ], true);
    expect(v.lines.find((l) => l.key === "roll")!.flags).toEqual(["billed_over_received"]);
    expect(v.lines.find((l) => l.key !== "roll")).toMatchObject({ billedQty: 1, billedCents: null, flags: ["unmatched_invoice_line"] });
  });

  it("the real charge alone still joins and a clean match stays clean", () => {
    const v = buildThreeWayLines(order, received, [{ ...charge, qty: 4, extendedCents: 10000 }], true);
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]).toMatchObject({ billedQty: 4, billedCents: 10000, flags: [] });
  });
});
