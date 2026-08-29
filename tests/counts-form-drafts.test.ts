/**
 * Unit spine — THE COUNT SHEET'S DROP RULE (audit 2026-08-29, cluster reports-counts-ui).
 *
 * `submit()` is allowed to drop a line the operator started and did not finish — an
 * operator may legitimately abandon a row, so the submit button stays enabled. What is
 * NOT allowed is dropping it SILENTLY: council P2 added a pre-submit notice, and the
 * whole value of that notice is that it counts every entry the POST will leave behind.
 *
 * The shipped gap was in the shape the SPLIT affordance itself creates. Tapping Split
 * seeds one blank row per vendor; if the operator then leaves them blank, `filledEntries`
 * is 0 and no member counts as "started", so the product left the sheet with no notice —
 * while the identical operator mistake on a non-split row (product picked, nothing typed)
 * has always been flagged by that branch's `touched` check.
 *
 * The helpers are pure and module-scope precisely so this is assertable; the component
 * renders the number they return.
 */
import { describe, it, expect } from "vitest";

import {
  entryFilled,
  filledEntries,
  incompleteEntryCount,
  type LineDraft,
  type MemberDraft,
} from "@/components/counts/CountForm";

const member = (skuId: string, patch: Partial<MemberDraft> = {}): MemberDraft => ({
  skuId,
  level: "",
  qty: "",
  isLoose: false,
  partial: "",
  ...patch,
});

const line = (patch: Partial<LineDraft> = {}): LineDraft => ({
  pick: "",
  level: "",
  qty: "",
  isLoose: false,
  partial: "",
  split: false,
  members: [],
  ...patch,
});

/** A product row the operator picked, tapped Split on, and left entirely blank. */
const blankSplit = () =>
  line({ pick: "product:HAM", split: true, members: [member("sku-a"), member("sku-b")] });

/** Any other line that carries the sheet — its presence is what makes submit possible,
 *  and therefore what makes a silent drop reachable. */
const carrier = () => line({ pick: "sku:z", level: "Full", qty: "2" });

describe("filledEntries — what the POST will actually carry", () => {
  it("counts a product row as one entry and a split as one per COMPLETE vendor row", () => {
    expect(filledEntries(carrier())).toBe(1);
    expect(filledEntries(line({ pick: "product:HAM", level: "Full", qty: "3" }))).toBe(1);
    expect(
      filledEntries(
        line({
          pick: "product:HAM",
          split: true,
          members: [member("sku-a", { level: "Full", qty: "1" }), member("sku-b", { level: "Half" })],
        }),
      ),
    ).toBe(1);
  });

  it("carries NOTHING for a split whose vendor rows are all blank", () => {
    // The premise of the bug: this line submits nothing at all.
    expect(filledEntries(blankSplit())).toBe(0);
  });

  it("needs BOTH level and qty — a level alone is not an entry", () => {
    expect(entryFilled({ level: "Full", qty: "2" })).toBe(true);
    expect(entryFilled({ level: "Full", qty: "  " })).toBe(false);
    expect(entryFilled({ level: "", qty: "2" })).toBe(false);
  });
});

describe("incompleteEntryCount — every dropped entry is surfaced before Record", () => {
  it("THE GAP: a picked product, Split tapped, every vendor row blank, is one dropped entry", () => {
    // Pre-fix this returned 0: the split branch looked only at member-level partial
    // fills, so a product that submits nothing left the sheet with no warning at all.
    expect(incompleteEntryCount([blankSplit(), carrier()])).toBe(1);
  });

  it("flags a fully-typed product row that Split then orphans", () => {
    // Splitting AFTER typing keeps level/qty in the draft but submit() sends members
    // only — the typed entry is dropped, and it is the same one dropped entry.
    const typedThenSplit = line({
      pick: "product:HAM",
      level: "Full",
      qty: "4",
      split: true,
      members: [member("sku-a"), member("sku-b")],
    });
    expect(filledEntries(typedThenSplit)).toBe(0);
    expect(incompleteEntryCount([typedThenSplit, carrier()])).toBe(1);
  });

  it("still counts each half-filled VENDOR row, and never double-reports one loss", () => {
    // Unchanged from the shipped behaviour: one started-but-unfinished vendor row is
    // one dropped entry — NOT two (it must not also be counted as a dead line).
    const oneHalfFilled = line({
      pick: "product:HAM",
      split: true,
      members: [member("sku-a", { level: "Full" }), member("sku-b")],
    });
    expect(incompleteEntryCount([oneHalfFilled, carrier()])).toBe(1);

    const twoHalfFilled = line({
      pick: "product:HAM",
      split: true,
      members: [member("sku-a", { level: "Full" }), member("sku-b", { qty: "2" })],
    });
    expect(incompleteEntryCount([twoHalfFilled])).toBe(2);
  });

  it("stays silent for a split that submits everything it was given", () => {
    const complete = line({
      pick: "product:HAM",
      split: true,
      members: [member("sku-a", { level: "Full", qty: "1" }), member("sku-b", { level: "Half", qty: "1" })],
    });
    expect(incompleteEntryCount([complete])).toBe(0);
  });

  it("leaves the untouched spare row alone — an empty line is not a loss", () => {
    expect(incompleteEntryCount([line(), carrier()])).toBe(0);
    // ...while a picked-but-unfilled NON-split row keeps its long-standing warning.
    expect(incompleteEntryCount([line({ pick: "sku:a" }), carrier()])).toBe(1);
  });

  it("counts a split with no members at all as the one entry it drops", () => {
    // memberSkuIds can seed an empty list; the product still leaves the sheet.
    expect(incompleteEntryCount([line({ pick: "product:HAM", split: true, members: [] })])).toBe(1);
  });
});
