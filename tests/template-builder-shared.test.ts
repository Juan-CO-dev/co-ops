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
  classifyEdits,
  applyEditsToItems,
  shiftOperationalDay,
  nextOperationalDay,
  versionOutranks,
  resolveEffectiveVersionId,
  type TemplateItemEdit,
  type LineageVersionRow,
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

// ─────────────────────────────────────────────────────────────────────────────
// PR-3 — classifyEdits (the diff classifier truth-table; CI-owned per spec §6).
// The classifier feeds the confirm modal + audit metadata ONLY — it never gates
// the write path (everything versions). Order-independent, coalescing.
// ─────────────────────────────────────────────────────────────────────────────

/** Source items for classifier tests: two active rows + one already-inactive. */
function src() {
  return [
    item({ id: "a", label: "Sweep floor", minRoleLevel: 3, required: true, active: true }),
    item({ id: "b", label: "Count cash", minRoleLevel: 4, required: false, active: true }),
    item({ id: "c", label: "Old thing", minRoleLevel: 3, required: true, active: false }),
  ];
}

describe("classifyEdits — the diff classifier truth-table", () => {
  it("empty edits → the zero summary", () => {
    expect(classifyEdits(src(), [])).toEqual({
      added: [],
      removed: [],
      relabeled: [],
      reordered: 0,
      roleChanged: [],
      requiredChanged: [],
    });
  });

  it("counts a genuine relabel; ignores a no-op relabel to the same label", () => {
    const edits: TemplateItemEdit[] = [
      { op: "relabel", itemId: "a", label: "Sweep the floor" },
      { op: "relabel", itemId: "b", label: "Count cash" }, // unchanged
    ];
    const d = classifyEdits(src(), edits);
    expect(d.relabeled).toEqual([{ itemId: "a", from: "Sweep floor", to: "Sweep the floor" }]);
  });

  it("coalesces multiple relabels of one item (last-write-wins A→B→C = A→C)", () => {
    const edits: TemplateItemEdit[] = [
      { op: "relabel", itemId: "a", label: "B" },
      { op: "relabel", itemId: "a", label: "C" },
    ];
    expect(classifyEdits(src(), edits).relabeled).toEqual([{ itemId: "a", from: "Sweep floor", to: "C" }]);
  });

  it("disable of an active row → removed; disable of an already-inactive row → NOT removed", () => {
    const d = classifyEdits(src(), [
      { op: "disable", itemId: "a" },
      { op: "disable", itemId: "c" }, // c is already inactive
    ]);
    expect(d.removed).toEqual([{ itemId: "a", label: "Sweep floor" }]);
  });

  it("disable then enable nets to no removal (order-independent coalesce)", () => {
    expect(classifyEdits(src(), [{ op: "disable", itemId: "a" }, { op: "enable", itemId: "a" }]).removed).toEqual([]);
  });

  it("counts adds by tempId + label", () => {
    const d = classifyEdits(src(), [
      { op: "add", tempId: "t1", label: "New step", displayOrder: 99, minRoleLevel: 3, required: true, expectsCount: false },
    ]);
    expect(d.added).toEqual([{ tempId: "t1", label: "New step" }]);
  });

  it("role change reported only when the level differs from source", () => {
    const d = classifyEdits(src(), [
      { op: "role", itemId: "a", minRoleLevel: 5 },
      { op: "role", itemId: "b", minRoleLevel: 4 }, // unchanged
    ]);
    expect(d.roleChanged).toEqual([{ itemId: "a", label: "Sweep floor", from: 3, to: 5 }]);
  });

  it("required change reported only when it differs from source", () => {
    const d = classifyEdits(src(), [
      { op: "required", itemId: "b", required: true }, // false → true
      { op: "required", itemId: "a", required: true }, // unchanged
    ]);
    expect(d.requiredChanged).toEqual([{ itemId: "b", label: "Count cash", to: true }]);
  });

  it("reorder counts distinct moved ids, but not ids that are also disabled", () => {
    const d = classifyEdits(src(), [
      { op: "reorder", itemId: "a", displayOrder: 2 },
      { op: "reorder", itemId: "b", displayOrder: 1 },
      { op: "reorder", itemId: "b", displayOrder: 3 }, // same id twice = 1
      { op: "disable", itemId: "b" }, // disabled → its reorder doesn't count
    ]);
    expect(d.reordered).toBe(1); // only "a" survives
  });

  it("is order-independent for the full mixed draft", () => {
    const edits: TemplateItemEdit[] = [
      { op: "relabel", itemId: "a", label: "Sweep the floor" },
      { op: "role", itemId: "a", minRoleLevel: 5 },
      { op: "required", itemId: "b", required: true },
      { op: "disable", itemId: "b" },
      { op: "add", tempId: "t1", label: "New step", displayOrder: 99, minRoleLevel: 3, required: true, expectsCount: false },
    ];
    const forward = classifyEdits(src(), edits);
    const backward = classifyEdits(src(), [...edits].reverse());
    expect(forward).toEqual(backward);
    expect(forward.added).toHaveLength(1);
    expect(forward.removed).toEqual([{ itemId: "b", label: "Count cash" }]);
    expect(forward.relabeled).toHaveLength(1);
    expect(forward.roleChanged).toHaveLength(1);
    // b's required change: b ends disabled/removed but the requiredChanged classifier
    // reports the field delta regardless — the modal shows both facts honestly.
    expect(forward.requiredChanged).toEqual([{ itemId: "b", label: "Count cash", to: true }]);
  });
});

describe("applyEditsToItems — in-memory draft render (preview + list)", () => {
  function items() {
    return [
      item({ id: "a", label: "Sweep floor", displayOrder: 1, required: true, active: true }),
      item({ id: "b", label: "Count cash", displayOrder: 2, minRoleLevel: 4, active: true }),
    ];
  }

  it("relabel + describe + role + required mutate the drafted row", () => {
    const out = applyEditsToItems(items(), [
      { op: "relabel", itemId: "a", label: "Sweep the floor" },
      { op: "describe", itemId: "a", description: "corners too" },
      { op: "role", itemId: "b", minRoleLevel: 6 },
      { op: "required", itemId: "b", required: true },
    ]);
    const a = out.find((it) => it.id === "a")!;
    const b = out.find((it) => it.id === "b")!;
    expect(a.label).toBe("Sweep the floor");
    expect(a.description).toBe("corners too");
    expect(b.minRoleLevel).toBe(6);
    expect(b.required).toBe(true);
  });

  it("disable flips active=false (kept in the array for the struck-through list)", () => {
    const out = applyEditsToItems(items(), [{ op: "disable", itemId: "a" }]);
    expect(out.find((it) => it.id === "a")!.active).toBe(false);
    expect(out).toHaveLength(2);
  });

  it("add produces a synthetic draft- row sorted by displayOrder", () => {
    const out = applyEditsToItems(items(), [
      { op: "add", tempId: "t1", label: "New", displayOrder: 3, minRoleLevel: 3, required: true, expectsCount: false },
    ]);
    expect(out).toHaveLength(3);
    const added = out.find((it) => it.id === "draft-t1")!;
    expect(added.label).toBe("New");
    expect(out[out.length - 1]!.id).toBe("draft-t1"); // sorted last (order 3)
  });

  it("reorder swaps rendered order by displayOrder", () => {
    const out = applyEditsToItems(items(), [
      { op: "reorder", itemId: "a", displayOrder: 2 },
      { op: "reorder", itemId: "b", displayOrder: 1 },
    ]);
    expect(out.map((it) => it.id)).toEqual(["b", "a"]);
  });

  it("NEVER edits a mirror row (the §5 seal)", () => {
    const src = [mirrorItem({ id: "mir", label: "Mirror", displayOrder: 1 })];
    const out = applyEditsToItems(src, [
      { op: "relabel", itemId: "mir", label: "hacked" },
      { op: "disable", itemId: "mir" },
    ]);
    expect(out[0]!.label).toBe("Mirror");
    expect(out[0]!.active).toBe(true);
  });

  it("add with a count spine-link carries the item/sku ref", () => {
    const outItem = applyEditsToItems(items(), [
      { op: "add", tempId: "ti", label: "Count subs", displayOrder: 3, minRoleLevel: 3, required: true, expectsCount: true, spineLink: { kind: "item", id: "item-9" } },
    ]);
    expect(outItem.find((it) => it.id === "draft-ti")!.itemId).toBe("item-9");
    const outSku = applyEditsToItems(items(), [
      { op: "add", tempId: "ts", label: "Count SKU", displayOrder: 3, minRoleLevel: 3, required: true, expectsCount: true, spineLink: { kind: "sku", id: "sku-9" } },
    ]);
    expect(outSku.find((it) => it.id === "draft-ts")!.vendorItemId).toBe("sku-9");
  });
});

describe("versionOutranks + resolveEffectiveVersionId — the date-aware resolution rule", () => {
  const row = (over: Partial<LineageVersionRow> & { id: string }): LineageVersionRow => ({
    active: true,
    effective_from: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  });

  it("effective_from DESC, NULLS LAST", () => {
    const legacy = row({ id: "legacy", effective_from: null });
    const dated = row({ id: "dated", effective_from: "2026-07-20" });
    expect(versionOutranks(dated, legacy)).toBe(true); // a dated version beats a NULL
    expect(versionOutranks(legacy, dated)).toBe(false);
  });

  it("newer effective_from wins; ties break on created_at DESC", () => {
    const older = row({ id: "o", effective_from: "2026-07-20" });
    const newer = row({ id: "n", effective_from: "2026-07-28" });
    expect(versionOutranks(newer, older)).toBe(true);
    const t1 = row({ id: "t1", effective_from: "2026-07-28", created_at: "2026-07-27T10:00:00Z" });
    const t2 = row({ id: "t2", effective_from: "2026-07-28", created_at: "2026-07-27T12:00:00Z" });
    expect(versionOutranks(t2, t1)).toBe(true); // later created_at wins the tie
  });

  it("legacy-only lineage → legacy is currently effective (no publish yet)", () => {
    expect(resolveEffectiveVersionId([row({ id: "legacy" })], "2026-07-28")).toBe("legacy");
  });

  it("current + pending: today resolves current, the pending is invisible until its day", () => {
    const rows = [
      row({ id: "current", effective_from: null }),
      row({ id: "pending", effective_from: "2026-07-29" }),
    ];
    expect(resolveEffectiveVersionId(rows, "2026-07-28")).toBe("current"); // pending hidden
    expect(resolveEffectiveVersionId(rows, "2026-07-29")).toBe("pending"); // its day arrived
  });

  it("apply-now (effective today) wins over the prior current from today onward", () => {
    const rows = [
      row({ id: "legacy", effective_from: null, created_at: "2026-01-01T00:00:00Z" }),
      row({ id: "applied", effective_from: "2026-07-28", created_at: "2026-07-28T09:00:00Z" }),
    ];
    expect(resolveEffectiveVersionId(rows, "2026-07-28")).toBe("applied");
  });

  it("only-pending lineage → null (nothing effective yet)", () => {
    expect(resolveEffectiveVersionId([row({ id: "p", effective_from: "2026-08-01" })], "2026-07-28")).toBeNull();
  });

  it("inactive rows are never resolved", () => {
    const rows = [
      row({ id: "dead", effective_from: "2026-07-28", active: false }),
      row({ id: "live", effective_from: null }),
    ];
    expect(resolveEffectiveVersionId(rows, "2026-07-28")).toBe("live");
  });
});

describe("operational-date primitives (pure UTC-anchored day math)", () => {
  it("shiftOperationalDay adds/subtracts whole days across month + year boundaries", () => {
    expect(shiftOperationalDay("2026-07-28", 1)).toBe("2026-07-29");
    expect(shiftOperationalDay("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftOperationalDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftOperationalDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftOperationalDay("2024-02-28", 1)).toBe("2024-02-29"); // leap year
  });
  it("nextOperationalDay = tomorrow", () => {
    expect(nextOperationalDay("2026-07-28")).toBe("2026-07-29");
  });
});
