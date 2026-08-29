/**
 * Unit spine — lib/receiving-shared.ts pure math (zero I/O, no server imports).
 * Pins: credit derivation for short/over/damaged/substitution lines, qty-delta
 * arithmetic, amount-cents derivation from intake price (spec D1), and the
 * addDeliveryLines double-submit multiset guard (isDuplicateAppend), and the
 * offline intake-draft shelf (one slot per vendor, newest first, capped), and the
 * avg_oz_per_each FOLD POLICY (what a delivery observation may overwrite).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";
import {
  AVG_FOLD_WEIGHT_CLASS,
  AVG_FOLD_WRITABLE_CLASSES,
  avgFoldSourceNote,
  deriveCreditDrafts,
  deriveMissingCreditDrafts,
  disposeAvgFold,
  findVendorMismatch,
  isDuplicateAppend,
  upsertIntakeDraft,
  removeIntakeDraft,
  INTAKE_DRAFT_CAP,
  type AppendLine,
  type IntakeLineForCredits,
  type SkuVendorBinding,
} from "../lib/receiving-shared";
import { isMeasuredWeightClass, WEIGHT_CLASS_RANK } from "../lib/angel-wave4";

const line = (over: Partial<IntakeLineForCredits>): IntakeLineForCredits => ({
  deliveryItemId: "item-1",
  skuId: "sku-1",
  qtyReceived: 5,
  expectedQty: 5,
  unitPrice: 12.5,
  discrepancyType: null,
  ...over,
});

describe("deriveCreditDrafts", () => {
  it("returns nothing for clean lines", () => {
    expect(deriveCreditDrafts([line({})])).toEqual([]);
  });

  it("derives a short credit with qty = expected - received and amount from intake price", () => {
    const [c] = deriveCreditDrafts([
      line({ qtyReceived: 3, discrepancyType: "short" }),
    ]);
    expect(c).toMatchObject({
      deliveryItemId: "item-1",
      reason: "short",
      qty: 2,
      amountCents: 2500,
    });
  });

  it("flags with no qty delta still produce a credit with null qty (damaged whole-line judgment)", () => {
    const [c] = deriveCreditDrafts([line({ discrepancyType: "damaged" })]);
    expect(c).toMatchObject({ reason: "damaged", qty: null, amountCents: null });
  });

  it("never derives negative qty (over-delivery credit carries the overage qty)", () => {
    const [c] = deriveCreditDrafts([
      line({ qtyReceived: 8, discrepancyType: "over" }),
    ]);
    expect(c).toMatchObject({ reason: "over", qty: 3 });
  });

  it("null expectedQty (added line) with a flag produces a null-qty credit", () => {
    const [c] = deriveCreditDrafts([
      line({ expectedQty: null, discrepancyType: "substitution" }),
    ]);
    expect(c).toMatchObject({ reason: "substitution", qty: null });
  });

  it("amountCents is null when unitPrice missing", () => {
    const [c] = deriveCreditDrafts([
      line({ qtyReceived: 3, discrepancyType: "short", unitPrice: null }),
    ]);
    expect(c?.amountCents).toBeNull();
  });
});

describe("deriveMissingCreditDrafts", () => {
  it("credits the WHOLE expected qty (nothing arrived) at the intake price", () => {
    const [c] = deriveMissingCreditDrafts([
      { skuId: "sku-9", expectedQty: 4, unitPrice: 12.5 },
    ]);
    expect(c).toMatchObject({ skuId: "sku-9", reason: "short", qty: 4, amountCents: 5000 });
  });

  it("leaves amountCents null when no intake price was entered (advisory, never fabricated)", () => {
    const [c] = deriveMissingCreditDrafts([
      { skuId: "sku-9", expectedQty: 4, unitPrice: null },
    ]);
    expect(c).toMatchObject({ qty: 4, amountCents: null });
  });

  it("carries no delivery_item_id — these credits have no line by construction", () => {
    const [c] = deriveMissingCreditDrafts([{ skuId: "s", expectedQty: 1, unitPrice: null }]);
    expect(c?.deliveryItemId).toBe("");
  });

  it("empty input → no drafts", () => {
    expect(deriveMissingCreditDrafts([])).toEqual([]);
  });
});

describe("isDuplicateAppend", () => {
  const l = (skuId: string, level: string | null, qty: number): AppendLine => ({ skuId, level, qty });

  it("exact multiset match → true (retry of the identical batch)", () => {
    const batch = [l("sku-1", "case", 2), l("sku-2", null, 5)];
    // different array order, same tuples + counts → still an exact multiset match
    const recent = [l("sku-2", null, 5), l("sku-1", "case", 2)];
    expect(isDuplicateAppend(batch, recent)).toBe(true);
  });

  it("differing qty → false", () => {
    const batch = [l("sku-1", "case", 2)];
    const recent = [l("sku-1", "case", 3)];
    expect(isDuplicateAppend(batch, recent)).toBe(false);
  });

  it("subset → false (incoming smaller than recent)", () => {
    const batch = [l("sku-1", "case", 2)];
    const recent = [l("sku-1", "case", 2), l("sku-2", null, 5)];
    expect(isDuplicateAppend(batch, recent)).toBe(false);
  });

  it("empty recent → false (nothing appended in the window)", () => {
    expect(isDuplicateAppend([l("sku-1", "case", 2)], [])).toBe(false);
  });
});

describe("intake draft shelf", () => {
  const d = (vendorId: string, startedAt: string, savedAt = startedAt) => ({
    vendorId,
    startedAt,
    savedAt,
  });

  it("prepends a new draft — newest first", () => {
    const shelf = upsertIntakeDraft([d("v-1", "t1")], d("v-2", "t2"));
    expect(shelf.map((x) => x.vendorId)).toEqual(["v-2", "v-1"]);
  });

  it("replaces the same vendor's slot instead of duplicating it", () => {
    // The live intake saves every 500 ms; each save must land in ONE slot.
    const shelf = [d("v-1", "t1", "s1")]
      .reduce((acc, x) => upsertIntakeDraft(acc, x), [] as ReturnType<typeof d>[]);
    const after = upsertIntakeDraft(upsertIntakeDraft(shelf, d("v-1", "t1", "s2")), d("v-1", "t1", "s3"));
    expect(after).toHaveLength(1);
    expect(after[0]?.savedAt).toBe("s3");
  });

  it("replaces by vendor even when startedAt differs (a fresh intake for that vendor)", () => {
    const after = upsertIntakeDraft([d("v-1", "t1")], d("v-1", "t9"));
    expect(after).toEqual([d("v-1", "t9")]);
  });

  it("keeps DIFFERENT vendors side by side — the two-trucks-one-hour case", () => {
    const shelf = upsertIntakeDraft(upsertIntakeDraft([], d("v-1", "t1")), d("v-2", "t2"));
    expect(shelf.map((x) => x.vendorId).sort()).toEqual(["v-1", "v-2"]);
  });

  it("caps the shelf, dropping the oldest", () => {
    const shelf = [d("v-1", "t1"), d("v-2", "t2"), d("v-3", "t3"), d("v-4", "t4")].reduce(
      (acc, x) => upsertIntakeDraft(acc, x),
      [] as ReturnType<typeof d>[],
    );
    expect(shelf).toHaveLength(INTAKE_DRAFT_CAP);
    expect(shelf.map((x) => x.vendorId)).toEqual(["v-4", "v-3", "v-2"]);
  });

  it("does not mutate the input shelf", () => {
    const shelf = [d("v-1", "t1")];
    upsertIntakeDraft(shelf, d("v-2", "t2"));
    expect(shelf).toEqual([d("v-1", "t1")]);
  });

  it("removes exactly one draft by full identity", () => {
    const shelf = [d("v-1", "t1"), d("v-2", "t2")];
    expect(removeIntakeDraft(shelf, "v-1", "t1")).toEqual([d("v-2", "t2")]);
  });

  it("leaves the shelf alone when the identity does not match", () => {
    // Same vendor, different session — submitting one intake must not delete another.
    const shelf = [d("v-1", "t1")];
    expect(removeIntakeDraft(shelf, "v-1", "t-other")).toEqual(shelf);
    expect(removeIntakeDraft(shelf, "v-other", "t1")).toEqual(shelf);
  });
});

// ── findVendorMismatch (multi-vendor audit P3) ────────────────────────────────
describe("findVendorMismatch", () => {
  const sku = (id: string, vendorId: string | null): SkuVendorBinding => ({ id, vendorId });

  it("passes when every SKU belongs to the delivering vendor", () => {
    expect(findVendorMismatch("v-baldor", [sku("a", "v-baldor"), sku("b", "v-baldor")])).toBeNull();
  });

  it("catches a twin from another vendor (the P3 bug)", () => {
    // Baldor's truck, but a line names PFG's "Ham" — this is what wrote price history
    // onto the twin that never arrived.
    const hit = findVendorMismatch("v-baldor", [sku("a", "v-baldor"), sku("ham-pfg", "v-pfg")]);
    expect(hit?.id).toBe("ham-pfg");
  });

  it("returns the FIRST offender when several cross vendors", () => {
    expect(findVendorMismatch("v-1", [sku("x", "v-2"), sku("y", "v-3")])?.id).toBe("x");
  });

  it("tolerates vendorless SKUs — unassigned is not another vendor", () => {
    // 11 ACTIVE SKUs carry a null vendor in prod (Sub Roll, Mortadella, …). Rejecting
    // them would make real ingredients un-receivable at the door.
    expect(findVendorMismatch("v-baldor", [sku("sub-roll", null), sku("a", "v-baldor")])).toBeNull();
  });

  it("disables the check when the delivery names no vendor", () => {
    expect(findVendorMismatch(null, [sku("a", "v-1")])).toBeNull();
    expect(findVendorMismatch("", [sku("a", "v-1")])).toBeNull();
    expect(findVendorMismatch(undefined, [sku("a", "v-1")])).toBeNull();
  });

  it("passes on an empty line set", () => {
    expect(findVendorMismatch("v-1", [])).toBeNull();
  });
});

// ── THE avg_oz_per_each FOLD POLICY ──────────────────────────────────────────
//
// The regression this pins: a GM weighs a case (recordWeightMeasurement writes
// avg_oz_per_each + weight_class 'OPERATIONAL' + note + established_at/_by at
// WEIGHT_WRITE_MIN = 7), and days later a key-holder (RECEIVE_MIN = 4) types an
// observed oz/each at the door. The fold used to recompute the mean of every
// historical observation and write avg_oz_per_each ALONE — so the weight board
// went on reporting the GM's name, the GM's date and "scale reading" over a number
// that had quietly become a delivery-clerk average, and the invoice-drift advisory
// (observed − believed) read a permanent 0 because believed had just been set to
// observed.

describe("disposeAvgFold", () => {
  it("folds onto an UNCLASSED SKU — an unexplained number gains a story", () => {
    expect(disposeAvgFold({ chained: false, liveWeightClass: null })).toBe("FOLD");
  });

  it("REFUSES an OPERATIONAL weight — a delivery average never overrules our scale", () => {
    // The regression, stated as one assertion. CONFLICT_PRESENT_ONLY, in disposeTub's
    // words: the line's observed_oz_per_each is still persisted, so the board's
    // invoice-drift advisory presents the disagreement instead of erasing it.
    expect(disposeAvgFold({ chained: false, liveWeightClass: "OPERATIONAL" })).toBe(
      "SKIP_PROTECTED_CLASS",
    );
  });

  it("KEEPS refreshing INVOICE_DERIVED — this fold is what maintains that class", () => {
    // HERB_WEIGHT_POLICY: "the AVERAGE of the derived invoice weights, refreshed as
    // new invoices land". A blanket isMeasuredWeightClass() skip would freeze the
    // bunch/catch-weight produce rows this class exists for.
    expect(disposeAvgFold({ chained: false, liveWeightClass: "INVOICE_DERIVED" })).toBe("FOLD");
  });

  it("folds over SPEC and ESTIMATE — an invoice average outranks a label and a guess", () => {
    expect(disposeAvgFold({ chained: false, liveWeightClass: "SPEC" })).toBe("FOLD");
    expect(disposeAvgFold({ chained: false, liveWeightClass: "ESTIMATE" })).toBe("FOLD");
  });

  it("PROTECTS a class this build has never heard of", () => {
    // The deliberate asymmetry with isMeasuredWeightClass: that predicate denies an
    // unknown term the MEASURED claim; this one denies an unknown term nothing —
    // it refuses to overrule what it cannot interpret.
    expect(disposeAvgFold({ chained: false, liveWeightClass: "SOMETHING_A_LATER_WAVE_MINTED" }))
      .toBe("SKIP_PROTECTED_CLASS");
    expect(disposeAvgFold({ chained: false, liveWeightClass: "operational" })).toBe(
      "SKIP_PROTECTED_CLASS", // case-sensitive, like every other reader of this column
    );
  });

  it("chain beats class in BOTH directions — the order of the checks is the policy", () => {
    // A chained SKU is skipped whatever it carries, and no class ever unlocks a
    // chained fold: the objection is that the number denominates another container.
    expect(disposeAvgFold({ chained: true, liveWeightClass: null })).toBe("SKIP_CHAINED");
    expect(disposeAvgFold({ chained: true, liveWeightClass: "OPERATIONAL" })).toBe("SKIP_CHAINED");
    expect(disposeAvgFold({ chained: true, liveWeightClass: "INVOICE_DERIVED" })).toBe("SKIP_CHAINED");
  });

  it("never claims a class stronger than what a delivery average is", () => {
    // The fold writes INVOICE_DERIVED — the vendor's scale, averaged — and never
    // OPERATIONAL, which asserts somebody weighed it HERE.
    expect(AVG_FOLD_WEIGHT_CLASS).toBe("INVOICE_DERIVED");
    expect(AVG_FOLD_WEIGHT_CLASS).not.toBe("OPERATIONAL");
    expect(isMeasuredWeightClass(AVG_FOLD_WEIGHT_CLASS)).toBe(true);
    // …and it writes a class it is itself allowed to refresh next delivery.
    expect(AVG_FOLD_WRITABLE_CLASSES).toContain(AVG_FOLD_WEIGHT_CLASS);
  });

  it("keeps the allow-list coupled to the weight-class ranking", () => {
    // Every writable class is either BELOW measured (SPEC, ESTIMATE) or is the fold's
    // own class. If a future wave mints a measured class and drops it in here without
    // a ruling, this fails — which is the point.
    for (const cls of AVG_FOLD_WRITABLE_CLASSES) {
      if (cls === AVG_FOLD_WEIGHT_CLASS) continue;
      expect(isMeasuredWeightClass(cls)).toBe(false);
      expect(WEIGHT_CLASS_RANK[cls as keyof typeof WEIGHT_CLASS_RANK]).toBeLessThan(2);
    }
    expect(AVG_FOLD_WRITABLE_CLASSES).not.toContain("OPERATIONAL");
  });

  it("names the sample size in the note it leaves behind", () => {
    // The board renders this string as "where did this number come from"; a delivery
    // average without an N is not an answer.
    expect(avgFoldSourceNote(7)).toContain("7");
    expect(avgFoldSourceNote(1)).toMatch(/observed oz\/each/);
  });
});

// ── THE FOLD'S I/O HALF, AT THE SOURCE ───────────────────────────────────────
//
// recordDelivery is DB-coupled, so no unit test over its exports can see that the
// write carries the provenance quartet — and "these four columns always move with
// the number" is exactly the guarantee whose ABSENCE caused the defect. Reading the
// source is the assertion available, the same posture tests/dynamic-pars-walker.ts
// takes for loadWalkerData's structural rules.

describe("recordDelivery's fold, at the source", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "receiving.ts"),
    "utf8",
  );

  it("routes the fold through the ONE policy function, not a bare chain check", () => {
    expect(src.includes("const disposition = disposeAvgFold({")).toBe(true);
    expect(src.includes('if (disposition === "SKIP_PROTECTED_CLASS")')).toBe(true);
  });

  it("stamps ALL FOUR provenance columns on the same update as the value", () => {
    const updateAt = src.indexOf('await sb.from("vendor_items").update({');
    expect(updateAt).toBeGreaterThan(-1);
    const stmt = src.slice(updateAt, src.indexOf('.eq("id", id)', updateAt));
    for (const col of [
      "avg_oz_per_each",
      "weight_class",
      "weight_source_note",
      "weight_established_at",
      "weight_established_by",
    ]) {
      expect(stmt).toContain(col);
    }
  });

  it("reads the live class off the select that already touches every line's SKU", () => {
    // A second round trip for one column would be the per-node read the
    // loadRecipeGraph law exists to prevent.
    expect(src).toContain("avg_oz_per_each, weight_class");
    expect(src).toContain("weightClassBySku");
  });

  it("checks the rowcount on the fold's UPDATE (silent-UPDATE law)", () => {
    // Bounded to THIS statement: a `{ count: "exact" }` further down the file
    // (completeDelivery's guarded flip) must not be able to satisfy the assertion.
    const updateAt = src.indexOf('await sb.from("vendor_items").update({');
    const stmtEnd = src.indexOf('.eq("id", id)', updateAt);
    expect(updateAt).toBeGreaterThan(-1);
    expect(stmtEnd).toBeGreaterThan(updateAt);
    expect(src.slice(updateAt, stmtEnd + 40)).toContain('{ count: "exact" }');
    expect(src.slice(stmtEnd, stmtEnd + 600)).toContain("if (count === 0)");
  });

  it("records the refusal in the delivery's audit row", () => {
    expect(src).toContain("avg_skipped_protected: avgSkippedProtected");
  });
});
