/**
 * resolveLineDefinition — the label law (hotfix 2026-07-30).
 *
 * The regression this pins: linking a QUESTION-SHAPED prep line (yes_no /
 * free_text — its label IS the question, "Meatball mix - ready?") to a registry
 * item made resolveLineDefinition render the ITEM name ("Meatballs") instead —
 * the question text vanished from the operator form, the submit snapshot and
 * the admin editor, at both shops, uneditably. Question lines must keep their
 * own label even when linked; par lines keep registry-name authority.
 */
import { describe, it, expect } from "vitest";
import { isQuestionShapedColumns, isQuestionShapedLine, resolveLineDefinition, type ItemDefn } from "@/lib/items";
import type { ChecklistTemplateItem } from "@/lib/types";

const baseLine = (over: Partial<ChecklistTemplateItem>): ChecklistTemplateItem =>
  ({
    id: "line-1",
    templateId: "tpl-1",
    station: "Misc",
    displayOrder: 1,
    label: "Meatball mix - ready?",
    description: null,
    minRoleLevel: 3,
    required: true,
    expectsCount: false,
    expectsPhoto: false,
    vendorItemId: null,
    active: true,
    translations: { es: { label: "¿Mezcla de albóndigas lista?" } },
    prepMeta: { section: "Misc", columns: ["yes_no"], parValue: null, parUnit: null, specialInstruction: null },
    reportReferenceType: null,
    referencesTemplateItemId: null,
    itemId: "item-meatballs",
    sectionQuestionId: null,
    itemQuestionId: null,
    ...over,
  }) as ChecklistTemplateItem;

const meatballsItem: ItemDefn = {
  id: "item-meatballs",
  name: "Meatballs",
  nameEs: "Albóndigas",
  defaultPar: 2,
  defaultParUnit: "1/6 Pan",
} as ItemDefn;

describe("isQuestionShapedLine", () => {
  it("yes_no and free_text lines are question-shaped", () => {
    expect(isQuestionShapedLine(baseLine({}))).toBe(true);
    expect(
      isQuestionShapedLine(
        baseLine({ prepMeta: { section: "Misc", columns: ["free_text"], parValue: null, parUnit: null, specialInstruction: null } }),
      ),
    ).toBe(true);
  });

  it("the columns primitive is the single definition (section-change guards route through it)", () => {
    expect(isQuestionShapedColumns(["yes_no"])).toBe(true);
    expect(isQuestionShapedColumns(["free_text"])).toBe(true);
    expect(isQuestionShapedColumns(["yes_no", "free_text"])).toBe(true);
    expect(isQuestionShapedColumns(["par", "on_hand", "back_up", "total"])).toBe(false);
    expect(isQuestionShapedColumns([])).toBe(false);
  });

  it("par/count lines and meta-less lines are NOT", () => {
    expect(
      isQuestionShapedLine(
        baseLine({ prepMeta: { section: "Veg", columns: ["par", "on_hand", "back_up", "total"], parValue: 7, parUnit: "1/3 Pan", specialInstruction: null } }),
      ),
    ).toBe(false);
    expect(isQuestionShapedLine(baseLine({ prepMeta: null }))).toBe(false);
  });
});

describe("resolveLineDefinition — question lines keep their label when linked", () => {
  it("THE MEATBALL PIN: a linked yes_no line renders its own question, not the item name", () => {
    const r = resolveLineDefinition(baseLine({}), meatballsItem);
    expect(r.name).toBe("Meatball mix - ready?");
    expect(r.nameEs).toBe("¿Mezcla de albóndigas lista?");
  });

  it("a linked PAR line keeps registry-name authority (unchanged behavior)", () => {
    const parLine = baseLine({
      label: "Old label",
      prepMeta: { section: "Veg", columns: ["par", "on_hand", "back_up", "total"], parValue: 7, parUnit: "1/3 Pan", specialInstruction: null },
    });
    const r = resolveLineDefinition(parLine, meatballsItem);
    expect(r.name).toBe("Meatballs");
    expect(r.par).toBe(2);
  });

  it("an UNLINKED question line falls back to its label (unchanged behavior)", () => {
    const r = resolveLineDefinition(baseLine({ itemId: null }), null);
    expect(r.name).toBe("Meatball mix - ready?");
  });
});
