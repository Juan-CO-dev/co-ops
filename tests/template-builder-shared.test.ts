/**
 * Unit spine — Template Builder pure surface (PR-0, spec §2):
 *  - isMirrorItem / assertNotMirrorItem: the Opening Phase-2 mirror classifier
 *    (prep_meta.openingPhase2 === true) that makes mirror rows read-only (§2.3).
 *  - mergeEsFill: the same-day Spanish-translation fill merge (§1) — only present
 *    keys written, empty label never clobbers a real one, es bucket isolated.
 *
 * Canonical reference: docs/superpowers/specs/2026-07-28-template-builder-design.md
 */
import { describe, it, expect } from "vitest";
import {
  isMirrorItem,
  assertNotMirrorItem,
  mergeEsFill,
  esFillCount,
  itemNeedsLink,
  diffLocationItems,
  classifyRoleFloor,
  MAX_ROLE_LEVEL,
  CLOSING_CONFIRM_FLOOR_LEVEL,
  OPENING_CONFIRM_FLOOR_LEVEL,
  confirmFloorForType,
  TemplateBuilderError,
} from "@/lib/admin/template-builder-shared";
import type { ChecklistTemplateItem, ChecklistTemplateItemTranslations } from "@/lib/types";

/** Minimal item factory for the Doctor classifier tests (only the fields the
 *  pure fns read; the rest cast through). */
function item(over: Partial<ChecklistTemplateItem>): ChecklistTemplateItem {
  return {
    id: "i1",
    templateId: "t1",
    station: null,
    displayOrder: 0,
    label: "Item",
    description: null,
    minRoleLevel: 3,
    required: false,
    expectsCount: false,
    expectsPhoto: false,
    vendorItemId: null,
    active: true,
    translations: null,
    prepMeta: null,
    reportReferenceType: null,
    referencesTemplateItemId: null,
    itemId: null,
    ...over,
  };
}

/** A Phase-2 mirror row exactly as createOpeningMirror (lib/admin/templates.ts)
 *  writes it: prep_meta.openingPhase2 = true, expects_count = false, item_id
 *  SHARED from the AM-prep line, references_template_item_id set, translations
 *  absent (they mirror from AM Prep). The end-to-end fixture the Doctor + client
 *  classify on the opening page. */
function mirrorItem(over: Partial<ChecklistTemplateItem> = {}): ChecklistTemplateItem {
  return item({
    id: "mirror-1",
    station: "Veg",
    label: "Sliced tomatoes",
    // Mirrors share the AM-prep item's registry id (createOpeningMirror line 355).
    itemId: "shared-item-id",
    required: true,
    expectsCount: false, // mirrors never carry expects_count
    translations: null, // no es on the row — mirrors from AM Prep
    prepMeta: {
      openingPhase2: true,
      section: "Veg",
      parValue: 4,
      parUnit: "qt",
    } as unknown as ChecklistTemplateItem["prepMeta"],
    referencesTemplateItemId: "am-prep-item-1",
    ...over,
  });
}

describe("isMirrorItem — Opening Phase-2 mirror classifier", () => {
  it("is TRUE only when openingPhase2 === true", () => {
    expect(isMirrorItem({ openingPhase2: true, section: "Veg", parValue: null, parUnit: null })).toBe(true);
  });
  it("is FALSE for a prep-shaped meta (openingPhase2 absent)", () => {
    expect(isMirrorItem({ section: "Veg", parValue: 4, parUnit: "qt", columns: [], specialInstruction: null })).toBe(false);
  });
  it("is FALSE for null / non-object / wrong-typed discriminator", () => {
    expect(isMirrorItem(null)).toBe(false);
    expect(isMirrorItem(undefined)).toBe(false);
    expect(isMirrorItem("openingPhase2")).toBe(false);
    expect(isMirrorItem(42)).toBe(false);
    expect(isMirrorItem({ openingPhase2: false })).toBe(false);
    expect(isMirrorItem({ openingPhase2: "true" })).toBe(false); // string, not boolean true
  });
});

describe("assertNotMirrorItem — the read-only guard", () => {
  it("throws TemplateBuilderError(409, mirror_item_readonly) on a mirror row", () => {
    try {
      assertNotMirrorItem({ openingPhase2: true, section: "Cooks", parValue: null, parUnit: null });
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TemplateBuilderError);
      const err = e as TemplateBuilderError;
      expect(err.status).toBe(409);
      expect(err.code).toBe("mirror_item_readonly");
    }
  });
  it("returns void (no throw) on a non-mirror row", () => {
    expect(() => assertNotMirrorItem(null)).not.toThrow();
    expect(() => assertNotMirrorItem({ section: "Veg", columns: [] })).not.toThrow();
  });
});

describe("mergeEsFill — same-day Spanish-translation fill", () => {
  it("STRICT FILL: an existing es value is NEVER overwritten (adversarial review MED)", () => {
    // Spec §1: fills fix MISSING data. Changing existing Spanish is a content
    // edit → PR-3's versioning engine, never this path.
    const existing: ChecklistTemplateItemTranslations = {
      en: { label: "Tomatoes" },
      es: { label: "Tomates", description: "Viejo" },
    };
    const merged = mergeEsFill(existing, { labelEs: "Jitomates", descriptionEs: "Nuevo" });
    expect(merged.en).toEqual({ label: "Tomatoes" }); // en untouched
    expect(merged.es?.label).toBe("Tomates"); // existing value WINS
    expect(merged.es?.description).toBe("Viejo"); // existing value WINS
  });

  it("fills only the MISSING es keys (blank existing counts as missing)", () => {
    const merged = mergeEsFill(
      { es: { label: "Tomates", description: "  " } },
      { descriptionEs: "Nuevo", specialInstructionEs: "Con cuidado" },
    );
    expect(merged.es?.label).toBe("Tomates"); // untouched
    expect(merged.es?.description).toBe("Nuevo"); // blank existing → filled
    expect(merged.es?.specialInstruction).toBe("Con cuidado"); // missing → filled
  });

  it("blank incoming values are NO-OPS — never delete or null an existing value", () => {
    const merged = mergeEsFill(
      { es: { label: "Prev", description: "d", specialInstruction: "si" } },
      { labelEs: "   ", descriptionEs: "  ", specialInstructionEs: "" },
    );
    expect(merged.es?.label).toBe("Prev");
    expect(merged.es?.description).toBe("d");
    expect(merged.es?.specialInstruction).toBe("si");
  });

  it("sets a real es label when provided (and trims it)", () => {
    const merged = mergeEsFill(null, { labelEs: "  Tomates  " });
    expect(merged.es?.label).toBe("Tomates");
  });

  it("null existing → creates the es bucket without an en bucket", () => {
    const merged = mergeEsFill(null, { descriptionEs: "hola" });
    expect(merged.en).toBeUndefined();
    expect(merged.es).toEqual({ description: "hola" });
  });

  it("is a fresh object (does not mutate the input)", () => {
    const existing: ChecklistTemplateItemTranslations = { es: { label: "Prev" } };
    mergeEsFill(existing, { labelEs: "New" });
    expect(existing.es?.label).toBe("Prev");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Template Doctor — pure classifiers (spec §6).
// ─────────────────────────────────────────────────────────────────────────────

describe("esFillCount — Spanish fill progress", () => {
  it("counts items whose es.label is a non-empty string", () => {
    const items = [
      item({ id: "a", translations: { es: { label: "Uno" } } }),
      item({ id: "b", translations: { es: { label: "  " } } }), // blank → not filled
      item({ id: "c", translations: null }), // missing → not filled
    ];
    expect(esFillCount(items)).toEqual({ filled: 1, total: 3 });
  });
  it("mirror rows count as filled (they're managed by AM Prep, not a gap here)", () => {
    const items = [
      item({ id: "m", prepMeta: { openingPhase2: true } as unknown as ChecklistTemplateItem["prepMeta"], translations: null }),
      item({ id: "n", translations: null }),
    ];
    expect(esFillCount(items)).toEqual({ filled: 1, total: 2 });
  });
});

describe("itemNeedsLink — mirror-aware spine-link classifier", () => {
  it("TRUE for a count line with neither ref set", () => {
    expect(itemNeedsLink(item({ expectsCount: true }))).toBe(true);
  });
  it("FALSE when linked to an item or a SKU", () => {
    expect(itemNeedsLink(item({ expectsCount: true, itemId: "x" }))).toBe(false);
    expect(itemNeedsLink(item({ expectsCount: true, vendorItemId: "y" }))).toBe(false);
  });
  it("FALSE for a plain tick (not count-bearing)", () => {
    expect(itemNeedsLink(item({ expectsCount: false }))).toBe(false);
  });
  it("FALSE for a mirror row even if count-bearing + unlinked", () => {
    expect(
      itemNeedsLink(item({ expectsCount: true, prepMeta: { openingPhase2: true } as unknown as ChecklistTemplateItem["prepMeta"] })),
    ).toBe(false);
  });
});

describe("diffLocationItems — NAMED location drift", () => {
  it("reports labels present in exactly one location, both directions", () => {
    const findings = diffLocationItems(
      { locationId: "P", labels: ["Fridge 1", "Lock door", "P-only"] },
      { locationId: "C", labels: ["Fridge 1", "Lock door", "C-only"] },
    );
    expect(findings).toContainEqual({ presentLocationId: "P", missingLocationId: "C", label: "P-only" });
    expect(findings).toContainEqual({ presentLocationId: "C", missingLocationId: "P", label: "C-only" });
    expect(findings).toHaveLength(2);
  });
  it("case/whitespace differences are NOT drift (diff on normalized English key)", () => {
    const findings = diffLocationItems(
      { locationId: "P", labels: ["Fridge 1 "] },
      { locationId: "C", labels: ["fridge 1"] },
    );
    expect(findings).toHaveLength(0);
  });
  it("identical sets → no drift", () => {
    expect(diffLocationItems({ locationId: "P", labels: ["a", "b"] }, { locationId: "C", labels: ["b", "a"] })).toHaveLength(0);
  });
  it("duplicate labels within a location collapse to present-or-absent", () => {
    const findings = diffLocationItems(
      { locationId: "P", labels: ["Mop", "Mop"] },
      { locationId: "C", labels: ["Mop"] },
    );
    expect(findings).toHaveLength(0);
  });
});

describe("classifyRoleFloor — never-confirmable trap (spec §6)", () => {
  it("flags a REQUIRED item above MAX_ROLE_LEVEL as impossible", () => {
    const findings = classifyRoleFloor(
      [{ id: "x", label: "Impossible step", required: true, minRoleLevel: MAX_ROLE_LEVEL + 1 }],
      CLOSING_CONFIRM_FLOOR_LEVEL,
    );
    expect(findings).toEqual([
      { itemId: "x", label: "Impossible step", minRoleLevel: MAX_ROLE_LEVEL + 1, severity: "impossible" },
    ]);
  });
  it("flags a REQUIRED item above the confirm floor as advisory (above_confirm_floor)", () => {
    const findings = classifyRoleFloor(
      [{ id: "y", label: "GM-only step", required: true, minRoleLevel: 7 }],
      CLOSING_CONFIRM_FLOOR_LEVEL, // 4
    );
    expect(findings).toEqual([{ itemId: "y", label: "GM-only step", minRoleLevel: 7, severity: "above_confirm_floor" }]);
  });
  it("does NOT flag a required item at or below the confirm floor", () => {
    expect(
      classifyRoleFloor([{ id: "z", label: "KH step", required: true, minRoleLevel: 4 }], CLOSING_CONFIRM_FLOOR_LEVEL),
    ).toHaveLength(0);
  });
  it("SKIPS non-required items entirely (optional high-floor is fine)", () => {
    expect(
      classifyRoleFloor([{ id: "o", label: "Optional GM note", required: false, minRoleLevel: 8 }], CLOSING_CONFIRM_FLOOR_LEVEL),
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-type confirm floor (PR-2) — the Doctor must NOT silently apply closing's
// constant to opening. Verified: opening confirms at KH+ = OPENING_BASE_LEVEL
// (4, lib/opening.ts) — equal to closing, but resolved per type.
// ─────────────────────────────────────────────────────────────────────────────

describe("confirmFloorForType — per-type role floor (PR-2)", () => {
  it("opening = OPENING_CONFIRM_FLOOR_LEVEL (KH+, = OPENING_BASE_LEVEL 4)", () => {
    expect(confirmFloorForType("opening")).toBe(OPENING_CONFIRM_FLOOR_LEVEL);
    expect(OPENING_CONFIRM_FLOOR_LEVEL).toBe(4);
  });
  it("closing = CLOSING_CONFIRM_FLOOR_LEVEL (KH+, 4)", () => {
    expect(confirmFloorForType("closing")).toBe(CLOSING_CONFIRM_FLOOR_LEVEL);
  });
  it("opening and closing floors are EQUAL today (verified KH+), but named per type", () => {
    // If a future amendment diverges them, this equality assertion is the tripwire
    // that forces re-reading the two gates (the C.54 preserved-from-prior lesson).
    expect(OPENING_CONFIRM_FLOOR_LEVEL).toBe(CLOSING_CONFIRM_FLOOR_LEVEL);
  });
  it("deep_cleaning returns a benign floor (no confirm gate; advisory-only)", () => {
    expect(confirmFloorForType("deep_cleaning")).toBe(CLOSING_CONFIRM_FLOOR_LEVEL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Opening Phase-2 mirror rows — END-TO-END behavior on the opening builder page
// (PR-2): a createOpeningMirror-shaped row must (1) be read-only (assertNotMirror
// rejects both fills), (2) be EXCLUDED from the needs-link + es-fill Doctor
// counts, and (3) NOT drive a spine-link picker. Tests the exact prod row shape.
// ─────────────────────────────────────────────────────────────────────────────

describe("Opening Phase-2 mirror — end-to-end read-only + Doctor exclusion (PR-2)", () => {
  it("the createOpeningMirror-shaped row IS a mirror", () => {
    expect(isMirrorItem(mirrorItem().prepMeta)).toBe(true);
  });

  it("both same-day fills REJECT the mirror row (assertNotMirrorItem throws 409)", () => {
    // The lib guards fillItemTranslations + fillItemSpineLink with this call.
    expect(() => assertNotMirrorItem(mirrorItem().prepMeta)).toThrow(TemplateBuilderError);
    try {
      assertNotMirrorItem(mirrorItem().prepMeta);
    } catch (e) {
      const err = e as TemplateBuilderError;
      expect(err.status).toBe(409);
      expect(err.code).toBe("mirror_item_readonly");
    }
  });

  it("is EXCLUDED from needs-link even if it were count-bearing + unlinked", () => {
    // Real mirrors are expects_count:false (never needs-link), but the classifier
    // must be mirror-aware regardless — a mirror never drives a spine-link picker.
    expect(itemNeedsLink(mirrorItem({ expectsCount: true, itemId: null }))).toBe(false);
    expect(itemNeedsLink(mirrorItem())).toBe(false);
  });

  it("counts as FILLED in the es fill-count despite null translations (managed by AM Prep)", () => {
    const items = [
      mirrorItem({ id: "m1", translations: null }),
      mirrorItem({ id: "m2", translations: null }),
      item({ id: "p1", translations: { es: { label: "Cerrar" } } }), // a real Phase-1 row
      item({ id: "p2", translations: null }), // a real Phase-1 gap
    ];
    // 2 mirrors (filled) + 1 real filled + 1 real gap = 3/4.
    expect(esFillCount(items)).toEqual({ filled: 3, total: 4 });
  });

  it("does NOT read as location drift against a matching label (system-key diff)", () => {
    // A mirror on both locations with the same label is NOT drift.
    const findings = diffLocationItems(
      { locationId: "P", labels: [mirrorItem().label, "Lock door"] },
      { locationId: "C", labels: [mirrorItem().label, "Lock door"] },
    );
    expect(findings).toHaveLength(0);
  });
});
