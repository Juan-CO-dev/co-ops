/**
 * The WRITE-SIDE label law (fulledit floor, PR-1 cut A).
 *
 * resolvePrepLabelWriteTarget decides where a label/labelEs edit lands:
 * question-shaped or unlinked → the LINE (the label IS the question / there is
 * no registry row); linked inventory → the registry ITEM (edit-once-everywhere).
 * Mirrors the read law pinned in items-line-definition.test.ts — the pair must
 * always agree, or an edit saves to a place the display never reads.
 */
import { describe, it, expect } from "vitest";
import { resolvePrepLabelWriteTarget } from "@/lib/items";
import type { ChecklistTemplateItem } from "@/lib/types";

const line = (over: Partial<ChecklistTemplateItem>): ChecklistTemplateItem =>
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
    translations: null,
    prepMeta: { section: "Misc", columns: ["yes_no"], parValue: null, parUnit: null, specialInstruction: null },
    reportReferenceType: null,
    referencesTemplateItemId: null,
    itemId: "item-meatballs",
    sectionQuestionId: null,
    itemQuestionId: null,
    ...over,
  }) as ChecklistTemplateItem;

describe("resolvePrepLabelWriteTarget — the write half of the label law", () => {
  it("a LINKED question line edits the LINE (the label IS the question)", () => {
    expect(resolvePrepLabelWriteTarget(line({}))).toBe("line");
  });

  it("a linked free_text line edits the LINE", () => {
    expect(
      resolvePrepLabelWriteTarget(
        line({ prepMeta: { section: "Misc", columns: ["free_text"], parValue: null, parUnit: null, specialInstruction: null } }),
      ),
    ).toBe("line");
  });

  it("a linked INVENTORY line edits the registry ITEM (edit-once-everywhere)", () => {
    expect(
      resolvePrepLabelWriteTarget(
        line({ prepMeta: { section: "Veg", columns: ["par", "on_hand", "back_up", "total"], parValue: 7, parUnit: "1/3 Pan", specialInstruction: null } }),
      ),
    ).toBe("item");
  });

  it("an UNLINKED line always edits the LINE (no registry row; never a 409)", () => {
    expect(resolvePrepLabelWriteTarget(line({ itemId: null }))).toBe("line");
    expect(
      resolvePrepLabelWriteTarget(
        line({
          itemId: null,
          prepMeta: { section: "Veg", columns: ["par", "on_hand", "back_up", "total"], parValue: 7, parUnit: "1/3 Pan", specialInstruction: null },
        }),
      ),
    ).toBe("line");
  });

  it("a meta-less line (opening mirror shape) edits the LINE only when unlinked", () => {
    expect(resolvePrepLabelWriteTarget(line({ prepMeta: null }))).toBe("item");
    expect(resolvePrepLabelWriteTarget(line({ prepMeta: null, itemId: null }))).toBe("line");
  });
});
