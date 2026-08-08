/**
 * Unit spine — lib/po-match-shared.ts pure three-way join/compare (Vendor Ordering V2
 * §5). Zero I/O, no server imports. Pins the ADVISORY-NULL LAW (a flag fires only when
 * BOTH sides of its comparison are known finite numbers), the deterministic join
 * precedence (exact itemNumber → unambiguous name-contains → unmatched), and the
 * totals null-safety — the exact edge cases the server loader relies on being correct.
 */
import { describe, it, expect } from "vitest";

import {
  buildThreeWayLines,
  type SnapshotLineInput,
  type DeliveryLineInput,
  type InvoiceLineInput,
} from "@/lib/po-match-shared";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const snap = (
  skuId: string,
  name: string,
  qty: number | null,
  opts: { itemNumber?: string | null; unitLabel?: string | null; priceCents?: number | null } = {},
): SnapshotLineInput => ({
  skuId,
  name,
  itemNumber: opts.itemNumber ?? null,
  qty,
  unitLabel: opts.unitLabel ?? null,
  priceCents: opts.priceCents ?? null,
});

const deliv = (skuId: string, qty: number | null, level: string | null = null): DeliveryLineInput => ({
  skuId,
  qty,
  level,
});

const inv = (
  description: string | null,
  opts: { qty?: number | null; unit?: string | null; unitPriceCents?: number | null; extendedCents?: number | null } = {},
): InvoiceLineInput => ({
  description,
  qty: opts.qty ?? null,
  unit: opts.unit ?? null,
  unitPriceCents: opts.unitPriceCents ?? null,
  extendedCents: opts.extendedCents ?? null,
});

function rowByKey(view: ReturnType<typeof buildThreeWayLines>, key: string) {
  const r = view.lines.find((l) => l.key === key);
  if (!r) throw new Error(`no row with key ${key}`);
  return r;
}

// ── Empty legs ──────────────────────────────────────────────────────────────────

describe("buildThreeWayLines — empty legs", () => {
  it("all empty → no lines, null totals, no legs present", () => {
    const v = buildThreeWayLines([], [], [], false);
    expect(v.lines).toEqual([]);
    expect(v.totals).toEqual({ orderedCents: null, billedCents: null });
    expect(v.hasInvoice).toBe(false);
    expect(v.hasDelivery).toBe(false);
  });

  it("ordered only (no delivery, no invoice) → one row, both legs null, no flags", () => {
    const v = buildThreeWayLines([snap("s1", "Sub Roll", 4)], [], [], false);
    expect(v.lines).toHaveLength(1);
    const r = rowByKey(v, "s1");
    expect(r.orderedQty).toBe(4);
    expect(r.receivedQty).toBeNull();
    expect(r.billedQty).toBeNull();
    expect(r.flags).toEqual([]);
    expect(v.hasDelivery).toBe(false);
  });
});

// ── Snapshot ↔ delivery join by skuId ─────────────────────────────────────────

describe("buildThreeWayLines — snapshot↔delivery join", () => {
  it("joins on skuId; carries the received qty + level", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 4, "case")],
      [],
      false,
    );
    const r = rowByKey(v, "s1");
    expect(r.orderedQty).toBe(4);
    expect(r.receivedQty).toBe(4);
    expect(r.receivedLevel).toBe("case");
    expect(r.flags).toEqual([]);
    expect(v.hasDelivery).toBe(true);
  });

  it("a delivered-but-not-ordered SKU gets its own row (ordered leg null)", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 4), deliv("s2", 2)],
      [],
      false,
    );
    const extra = rowByKey(v, "s2");
    expect(extra.orderedQty).toBeNull();
    expect(extra.receivedQty).toBe(2);
    expect(extra.flags).toEqual([]);
  });
});

// ── Invoice fuzzy-join: exact itemNumber ──────────────────────────────────────

describe("buildThreeWayLines — invoice join by itemNumber (exact)", () => {
  it("matches an invoice description to a row's itemNumber (case-insensitive/trim)", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4, { itemNumber: "AB-123" })],
      [deliv("s1", 4)],
      [inv("  ab-123  ", { qty: 4, extendedCents: 1200 })],
      true,
    );
    const r = rowByKey(v, "s1");
    expect(r.billedQty).toBe(4);
    expect(r.billedCents).toBe(1200);
    expect(r.flags).toEqual([]); // 4/4/4 — clean
  });

  it("ambiguous exact itemNumber (two rows share it) → unmatched, never guessed", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Roll A", 1, { itemNumber: "DUP" }), snap("s2", "Roll B", 1, { itemNumber: "DUP" })],
      [deliv("s1", 1), deliv("s2", 1)],
      [inv("DUP", { qty: 1, extendedCents: 500 })],
      true,
    );
    // Neither s1 nor s2 gets billed; the invoice line stands alone.
    expect(rowByKey(v, "s1").billedQty).toBeNull();
    expect(rowByKey(v, "s2").billedQty).toBeNull();
    const unmatched = v.lines.filter((l) => l.flags.includes("unmatched_invoice_line"));
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]!.billedCents).toBe(500);
  });
});

// ── Invoice fuzzy-join: unambiguous name-contains ─────────────────────────────

describe("buildThreeWayLines — invoice join by name-contains", () => {
  it("joins when the invoice description contains the SKU name (unambiguous)", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 4)],
      [inv("SUB ROLL 12CT WHITE", { qty: 4, extendedCents: 1200 })],
      true,
    );
    const r = rowByKey(v, "s1");
    expect(r.billedQty).toBe(4);
    expect(r.billedCents).toBe(1200);
  });

  it("joins when the SKU name contains the invoice description (reverse-contains)", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Balsamic Vinaigrette House", 2)],
      [deliv("s1", 2)],
      [inv("balsamic", { qty: 2, extendedCents: 800 })],
      true,
    );
    expect(rowByKey(v, "s1").billedQty).toBe(2);
  });

  it("ambiguous name-contains (two candidate rows) → unmatched invoice line", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Roll White", 1), snap("s2", "Roll Wheat", 1)],
      [deliv("s1", 1), deliv("s2", 1)],
      [inv("Roll", { qty: 1, extendedCents: 300 })], // "Roll" is contained by both names
      true,
    );
    expect(rowByKey(v, "s1").billedQty).toBeNull();
    expect(rowByKey(v, "s2").billedQty).toBeNull();
    expect(v.lines.filter((l) => l.flags.includes("unmatched_invoice_line"))).toHaveLength(1);
  });

  it("itemNumber wins over name-contains when both would match different rows", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 1, { itemNumber: "XR-9" }), snap("s2", "Sub Roll Deluxe", 1)],
      [deliv("s1", 1), deliv("s2", 1)],
      [inv("XR-9", { qty: 1, extendedCents: 100 })],
      true,
    );
    // Exact itemNumber pins it to s1; name-contains would otherwise have hit both.
    expect(rowByKey(v, "s1").billedQty).toBe(1);
    expect(rowByKey(v, "s2").billedQty).toBeNull();
  });

  it("a second invoice line cannot re-bill a row already taken → unmatched", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 4)],
      [inv("Sub Roll", { qty: 4, extendedCents: 1200 }), inv("Sub Roll", { qty: 1, extendedCents: 300 })],
      true,
    );
    const r = rowByKey(v, "s1");
    expect(r.billedCents).toBe(1200); // first match wins
    expect(v.lines.filter((l) => l.flags.includes("unmatched_invoice_line"))).toHaveLength(1);
  });
});

// ── Flag firing rules + null-side suppression ─────────────────────────────────

describe("buildThreeWayLines — billed_over_received", () => {
  it("fires when billedQty > receivedQty (both known)", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 3)],
      [inv("Sub Roll", { qty: 5, extendedCents: 1500 })],
      true,
    );
    expect(rowByKey(v, "s1").flags).toContain("billed_over_received");
  });

  it("does NOT fire when received is null (invoice present, no delivery leg)", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [], // no delivery → receivedQty null
      [inv("Sub Roll", { qty: 5, extendedCents: 1500 })],
      true,
    );
    expect(rowByKey(v, "s1").flags).not.toContain("billed_over_received");
  });

  it("does NOT fire when billed equals received", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 4)],
      [inv("Sub Roll", { qty: 4, extendedCents: 1200 })],
      true,
    );
    expect(rowByKey(v, "s1").flags).toEqual([]);
  });
});

describe("buildThreeWayLines — short_received", () => {
  it("fires when receivedQty < orderedQty (both known)", () => {
    const v = buildThreeWayLines([snap("s1", "Sub Roll", 4)], [deliv("s1", 2)], [], false);
    expect(rowByKey(v, "s1").flags).toContain("short_received");
  });

  it("does NOT fire when ordered is null (received-but-not-ordered row)", () => {
    const v = buildThreeWayLines([snap("s1", "Sub Roll", 4)], [deliv("s1", 4), deliv("s2", 1)], [], false);
    expect(rowByKey(v, "s2").flags).not.toContain("short_received");
  });

  it("does NOT fire when received is null (no delivery leg)", () => {
    const v = buildThreeWayLines([snap("s1", "Sub Roll", 4)], [], [], false);
    expect(rowByKey(v, "s1").flags).not.toContain("short_received");
  });
});

describe("buildThreeWayLines — not_billed", () => {
  it("fires when ordered+received but no invoice line matched AND an invoice exists", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 4)],
      [inv("Something Else Entirely", { qty: 1, extendedCents: 100 })], // won't join s1
      true,
    );
    expect(rowByKey(v, "s1").flags).toContain("not_billed");
  });

  it("does NOT fire when there is no invoice on the PO (hasInvoice=false)", () => {
    const v = buildThreeWayLines([snap("s1", "Sub Roll", 4)], [deliv("s1", 4)], [], false);
    expect(rowByKey(v, "s1").flags).not.toContain("not_billed");
  });

  it("does NOT fire when the row WAS billed", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 4)],
      [inv("Sub Roll", { qty: 4, extendedCents: 1200 })],
      true,
    );
    expect(rowByKey(v, "s1").flags).not.toContain("not_billed");
  });

  it("does NOT fire when the received leg is missing (can't call it un-billed without a receipt)", () => {
    const v = buildThreeWayLines([snap("s1", "Sub Roll", 4)], [], [], true);
    expect(rowByKey(v, "s1").flags).not.toContain("not_billed");
  });
});

describe("buildThreeWayLines — combined flags on one line", () => {
  it("short_received AND billed_over_received can both fire", () => {
    // ordered 4, received 2 (short), billed 5 (over received).
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", 2)],
      [inv("Sub Roll", { qty: 5, extendedCents: 1500 })],
      true,
    );
    const r = rowByKey(v, "s1");
    expect(r.flags).toContain("short_received");
    expect(r.flags).toContain("billed_over_received");
    expect(r.flags).not.toContain("not_billed"); // it WAS billed
  });
});

// ── Non-finite suppression (advisory-null law hardening) ──────────────────────

describe("buildThreeWayLines — non-finite inputs are treated as unknown", () => {
  it("NaN received qty is null → no short/over flag", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4)],
      [deliv("s1", Number.NaN)],
      [inv("Sub Roll", { qty: 5, extendedCents: 1500 })],
      true,
    );
    const r = rowByKey(v, "s1");
    expect(r.receivedQty).toBeNull();
    expect(r.flags).not.toContain("short_received");
    expect(r.flags).not.toContain("billed_over_received");
  });
});

// ── Totals ────────────────────────────────────────────────────────────────────

describe("buildThreeWayLines — totals", () => {
  it("orderedCents sums price×qty; billedCents sums extended", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4, { priceCents: 300 }), snap("s2", "Balsamic", 2, { priceCents: 400 })],
      [deliv("s1", 4), deliv("s2", 2)],
      [inv("Sub Roll", { extendedCents: 1200 }), inv("Balsamic", { extendedCents: 800 })],
      true,
    );
    expect(v.totals.orderedCents).toBe(4 * 300 + 2 * 400); // 2000
    expect(v.totals.billedCents).toBe(2000);
  });

  it("orderedCents null when no snapshot line carried both price and qty (never a false $0)", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4, { priceCents: null }), snap("s2", "Balsamic", null, { priceCents: 400 })],
      [],
      [],
      false,
    );
    expect(v.totals.orderedCents).toBeNull();
  });

  it("billedCents null when no invoice line carried an extended amount", () => {
    const v = buildThreeWayLines(
      [snap("s1", "Sub Roll", 4, { priceCents: 300 })],
      [deliv("s1", 4)],
      [inv("Sub Roll", { qty: 4 })], // no extendedCents
      true,
    );
    expect(v.totals.billedCents).toBeNull();
  });
});

// ── Unmatched invoice line ────────────────────────────────────────────────────

describe("buildThreeWayLines — unmatched invoice line", () => {
  it("an invoice line that joins nothing becomes its own flagged row with the description as name", () => {
    const v = buildThreeWayLines([], [], [inv("Mystery Fee", { qty: 1, extendedCents: 250 })], true);
    expect(v.lines).toHaveLength(1);
    const r = v.lines[0]!;
    expect(r.name).toBe("Mystery Fee");
    expect(r.orderedQty).toBeNull();
    expect(r.receivedQty).toBeNull();
    expect(r.billedCents).toBe(250);
    expect(r.flags).toEqual(["unmatched_invoice_line"]);
  });

  it("a null-description unmatched line still renders a safe placeholder name", () => {
    const v = buildThreeWayLines([], [], [inv(null, { extendedCents: 100 })], true);
    expect(v.lines[0]!.name).toBe("(invoice line)");
    expect(v.lines[0]!.flags).toEqual(["unmatched_invoice_line"]);
  });
});
