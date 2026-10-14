/**
 * B1 (guide-testing triage 2026-10-13) — the pure display helpers the opening and mid-day
 * prep forms share (lib/prep-display-shared.ts).
 *
 * #3  "Prep need 5 1/3 Pan" read as five-and-a-third; "0 1/3 Pan" read as a third.
 * #4  "Above prep need by 0.33000000000000007".
 * #5  the opening prep box ate the decimal point ("5." → "5") and ignored "5 1/3" silently.
 * #6  rows with no par said "verify section first" forever.
 * #10 the opening footer said only "Submit disabled" while the no-prior-data reason was unpicked.
 */
import { describe, expect, it } from "vitest";

import {
  formatPrepQty,
  openingFooterHint,
  parseDecimalDraft,
  prepNeedLabel,
  prepQtyParts,
  roundQty,
  type OpeningFooterState,
} from "@/lib/prep-display-shared";

describe("roundQty (#4)", () => {
  it("rounds float noise to at most 2 decimals", () => {
    expect(roundQty(5.33 - 5)).toBe(0.33);
    expect(String(roundQty(5.33 - 5))).toBe("0.33");
    expect(roundQty(0.33000000000000007)).toBe(0.33);
    expect(roundQty(7.3333)).toBe(7.33);
    expect(roundQty(2.5)).toBe(2.5);
    expect(roundQty(4)).toBe(4);
  });

  it("never renders a negative zero", () => {
    expect(Object.is(roundQty(-0.001), 0)).toBe(true);
    expect(String(roundQty(-0.001))).toBe("0");
  });
});

describe("formatPrepQty (#3)", () => {
  it.each([
    [5, "1/3 Pan", "5 × 1/3 Pan"],
    [0, "1/3 Pan", "0"],
    [7.3333, "Pan", "7.33 Pan"],
    [3, "Bottle", "3 Bottle"],
    [0, "Bottle", "0"],
    [2, null, "2"],
    [2, "  ", "2"],
    [1.5, "6 Pan", "1.5 × 6 Pan"],
    [5.33 - 5, "Qt", "0.33 Qt"],
  ] as const)("(%s, %s) → %s", (n, unit, expected) => {
    expect(formatPrepQty(n, unit)).toBe(expected);
  });

  it.each([[null], [undefined], [Number.NaN]])("(%s, x) → —", (n) => {
    expect(formatPrepQty(n as number | null | undefined, "1/3 Pan")).toBe("—");
  });

  it("splits into a quantity and a unit tail for two-tone rendering", () => {
    expect(prepQtyParts(5, "1/3 Pan")).toEqual({ qty: "5", unit: "× 1/3 Pan" });
    expect(prepQtyParts(3, "Bottle")).toEqual({ qty: "3", unit: "Bottle" });
    expect(prepQtyParts(0, "1/3 Pan")).toEqual({ qty: "0", unit: null });
    expect(prepQtyParts(null, "Bottle")).toEqual({ qty: "—", unit: null });
  });
});

describe("parseDecimalDraft (#5)", () => {
  it("empty", () => {
    expect(parseDecimalDraft("")).toEqual({ kind: "empty" });
    expect(parseDecimalDraft("   ")).toEqual({ kind: "empty" });
  });

  it("a whole number", () => {
    expect(parseDecimalDraft("5")).toEqual({ kind: "number", value: 5 });
    expect(parseDecimalDraft(" 12 ")).toEqual({ kind: "number", value: 12 });
  });

  it("a trailing point is a PARTIAL draft that keeps its number", () => {
    expect(parseDecimalDraft("5.")).toEqual({ kind: "partial", value: 5 });
    expect(parseDecimalDraft("0.")).toEqual({ kind: "partial", value: 0 });
    expect(parseDecimalDraft(".")).toEqual({ kind: "partial", value: null });
  });

  it("decimals, with or without a leading zero", () => {
    expect(parseDecimalDraft(".5")).toEqual({ kind: "number", value: 0.5 });
    expect(parseDecimalDraft("0.5")).toEqual({ kind: "number", value: 0.5 });
    expect(parseDecimalDraft("5.33")).toEqual({ kind: "number", value: 5.33 });
  });

  it("a decimal comma (Spanish keypads) reads as a point", () => {
    expect(parseDecimalDraft("5,5")).toEqual({ kind: "number", value: 5.5 });
    expect(parseDecimalDraft("5,")).toEqual({ kind: "partial", value: 5 });
  });

  it("a number too big to be finite is INVALID (shows the hint, commits nothing), never Infinity", () => {
    const nines = "9".repeat(309);
    expect(Number(nines)).toBe(Infinity); // sanity: the overflow is real
    expect(parseDecimalDraft(nines)).toEqual({ kind: "invalid" });
    expect(parseDecimalDraft(`${nines}.5`)).toEqual({ kind: "invalid" });
    expect(parseDecimalDraft(`${nines},5`)).toEqual({ kind: "invalid" });
    expect(parseDecimalDraft(`${nines}.`)).toEqual({ kind: "invalid" });
    expect(parseDecimalDraft(`${nines},`)).toEqual({ kind: "invalid" });
    // the largest finite magnitudes still parse
    expect(parseDecimalDraft("9".repeat(308))).toEqual({ kind: "number", value: Number("9".repeat(308)) });
  });

  it.each(["5 1/3", "-1", "1/3", "abc", "5..", "1e3", "5.5.5", "Infinity"])("%s is invalid", (raw) => {
    expect(parseDecimalDraft(raw)).toEqual({ kind: "invalid" });
  });
});

describe("prepNeedLabel (#6)", () => {
  it("no par → no_par, even once ground truth is known", () => {
    expect(prepNeedLabel({ parValue: null, groundTruth: 4 })).toBe("no_par");
    expect(prepNeedLabel({ parValue: null, groundTruth: null })).toBe("no_par");
  });
  it("a par but no ground truth yet → pending (verify the section first)", () => {
    expect(prepNeedLabel({ parValue: 6, groundTruth: null })).toBe("pending");
  });
  it("par and ground truth → ready", () => {
    expect(prepNeedLabel({ parValue: 6, groundTruth: 2 })).toBe("ready");
    expect(prepNeedLabel({ parValue: 0, groundTruth: 0 })).toBe("ready");
  });
});

describe("openingFooterHint (#10)", () => {
  const P1: OpeningFooterState = {
    activePhase: "verification",
    submitEnabled: false,
    roleCanSubmit: true,
    remainingTicks: 0,
    firstMissingTemp: null,
    spotCheckBlockReason: null,
    attestationMissing: false,
    phase2AlreadyFinalized: false,
    outstandingCount: 0,
  };

  it("ready / role when the button is live", () => {
    expect(openingFooterHint({ ...P1, submitEnabled: true })).toEqual({ kind: "ready" });
    expect(openingFooterHint({ ...P1, submitEnabled: true, roleCanSubmit: false })).toEqual({ kind: "role" });
  });

  it("Phase 1 blockers, in order: ticks → temps → sections → reason", () => {
    const all: OpeningFooterState = {
      ...P1,
      remainingTicks: 3,
      firstMissingTemp: { label: "Line fridge", station: "Line" },
      spotCheckBlockReason: "verify_sections",
      attestationMissing: true,
    };
    expect(openingFooterHint(all)).toEqual({ kind: "items_remaining", remaining: 3 });
    expect(openingFooterHint({ ...all, remainingTicks: 0 })).toEqual({
      kind: "temps_required",
      item: "Line fridge",
      station: "Line",
    });
    expect(openingFooterHint({ ...all, remainingTicks: 0, firstMissingTemp: null })).toEqual({ kind: "verify_sections" });
    expect(
      openingFooterHint({ ...all, remainingTicks: 0, firstMissingTemp: null, spotCheckBlockReason: "template_misconfigured" }),
    ).toEqual({ kind: "template_misconfigured" });
    expect(
      openingFooterHint({ ...all, remainingTicks: 0, firstMissingTemp: null, spotCheckBlockReason: null }),
    ).toEqual({ kind: "reason_required" });
  });

  it("names the missing no-prior-data reason instead of 'Submit disabled'", () => {
    expect(openingFooterHint({ ...P1, attestationMissing: true })).toEqual({ kind: "reason_required" });
  });

  it("falls to generic only when no blocker is known", () => {
    expect(openingFooterHint(P1)).toEqual({ kind: "generic" });
  });

  it("Phase 2: finalized → outstanding → generic", () => {
    const P2: OpeningFooterState = { ...P1, activePhase: "prep", attestationMissing: true, remainingTicks: 4 };
    expect(openingFooterHint({ ...P2, phase2AlreadyFinalized: true, outstandingCount: 2 })).toEqual({ kind: "already_finalized" });
    expect(openingFooterHint({ ...P2, outstandingCount: 2 })).toEqual({ kind: "outstanding", count: 2 });
    expect(openingFooterHint(P2)).toEqual({ kind: "generic" });
  });
});
