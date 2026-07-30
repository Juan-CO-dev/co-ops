/**
 * Unit spine — READ-ONLY prep overview + prep Doctor pure classifiers (PR-3/4 of
 * the checklist full-edit arc, spec §"The three classifiers"):
 *  - classifyPrepInputTypeDrift: same identity at BOTH locations, different input
 *    type → drift; consistent type → no drift; identity by item_id BEATS label.
 *  - classifyPrepNeedsLink: active inventory (non-question) lines with no link;
 *    question lines EXCLUDED.
 *  - prepEsFill: {filled,total} over active lines (esMissing → not filled).
 *
 * Canonical reference: docs/superpowers/specs/2026-07-30-prep-builder-view-design.md
 */
import { describe, it, expect } from "vitest";
import {
  classifyPrepInputTypeDrift,
  classifyPrepNeedsLink,
  prepEsFill,
  prepLineIdentity,
  prepOverviewTotals,
  type PrepOverviewLine,
  type PrepOverviewTemplate,
  type PrepSubtypeKey,
} from "@/lib/admin/prep-overview-shared";
import type { LineInputType } from "@/lib/types";

/** Minimal line factory (only the fields the pure fns read). */
function line(over: Partial<PrepOverviewLine>): PrepOverviewLine {
  return {
    lineId: "L1",
    displayLabel: "Meatball mix",
    rawLabel: "Meatball mix",
    section: "cooks",
    inputType: "on_hand",
    linked: false,
    itemId: null,
    questionShaped: false,
    esMissing: false,
    displayOrder: 0,
    ...over,
  };
}

function tpl(
  over: Partial<PrepOverviewTemplate> & { locationId: string; subtype: PrepSubtypeKey; lines: PrepOverviewLine[] },
): PrepOverviewTemplate {
  return {
    templateId: `tpl-${over.locationId}-${over.subtype}`,
    templateName: "Prep",
    locationName: over.locationId,
    ...over,
  };
}

describe("prepLineIdentity", () => {
  it("uses item_id when linked (beats label)", () => {
    expect(prepLineIdentity({ itemId: "item-1", rawLabel: "Anything" })).toBe("item:item-1");
  });
  it("falls to normalized-lowercase label when unlinked", () => {
    expect(prepLineIdentity({ itemId: null, rawLabel: "  Fridge 1 " })).toBe("label:fridge 1");
  });
});

describe("classifyPrepInputTypeDrift", () => {
  it("finds drift when the same identity has different input types across locations", () => {
    const templates = [
      tpl({ locationId: "A", subtype: "am_prep", lines: [line({ itemId: "x", inputType: "on_hand" })] }),
      tpl({ locationId: "B", subtype: "am_prep", lines: [line({ itemId: "x", inputType: "yes_no" })] }),
    ];
    const findings = classifyPrepInputTypeDrift(templates);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.subtype).toBe("am_prep");
    expect(findings[0]?.perLocation.map((p) => p.inputType).sort()).toEqual(["on_hand", "yes_no"]);
  });

  it("reports NO drift when the input type is consistent across locations", () => {
    const templates = [
      tpl({ locationId: "A", subtype: "am_prep", lines: [line({ itemId: "x", inputType: "on_hand" })] }),
      tpl({ locationId: "B", subtype: "am_prep", lines: [line({ itemId: "x", inputType: "on_hand" })] }),
    ];
    expect(classifyPrepInputTypeDrift(templates)).toEqual([]);
  });

  it("does not report an identity present at only one location", () => {
    const templates = [
      tpl({ locationId: "A", subtype: "am_prep", lines: [line({ itemId: "only-a", inputType: "on_hand" })] }),
      tpl({ locationId: "B", subtype: "am_prep", lines: [line({ itemId: "only-b", inputType: "yes_no" })] }),
    ];
    expect(classifyPrepInputTypeDrift(templates)).toEqual([]);
  });

  it("pairs by item_id even when labels drifted (identity by item_id beats label)", () => {
    const templates = [
      tpl({ locationId: "A", subtype: "am_prep", lines: [line({ itemId: "x", rawLabel: "Meatball mix", inputType: "on_hand" })] }),
      tpl({ locationId: "B", subtype: "am_prep", lines: [line({ itemId: "x", rawLabel: "Meatballs (mix)", inputType: "free_text" })] }),
    ];
    const findings = classifyPrepInputTypeDrift(templates);
    expect(findings).toHaveLength(1);
  });

  it("pairs unlinked lines by normalized label", () => {
    const templates = [
      tpl({ locationId: "A", subtype: "mid_day_prep", lines: [line({ itemId: null, rawLabel: "Walk-in temp ok?", inputType: "yes_no" })] }),
      tpl({ locationId: "B", subtype: "mid_day_prep", lines: [line({ itemId: null, rawLabel: "walk-in temp ok? ", inputType: "free_text" })] }),
    ];
    const findings = classifyPrepInputTypeDrift(templates);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.subtype).toBe("mid_day_prep");
  });

  it("does not cross subtypes (am_prep vs mid_day_prep never pair)", () => {
    const templates = [
      tpl({ locationId: "A", subtype: "am_prep", lines: [line({ itemId: "x", inputType: "on_hand" })] }),
      tpl({ locationId: "B", subtype: "mid_day_prep", lines: [line({ itemId: "x", inputType: "yes_no" })] }),
    ];
    // Each subtype has only one location → no cross-location drift within a subtype.
    expect(classifyPrepInputTypeDrift(templates)).toEqual([]);
  });

  it("collapses a within-location duplicate (first line wins its input type)", () => {
    const templates = [
      tpl({
        locationId: "A",
        subtype: "am_prep",
        lines: [line({ lineId: "a1", itemId: "x", inputType: "on_hand" }), line({ lineId: "a2", itemId: "x", inputType: "yes_no" })],
      }),
      tpl({ locationId: "B", subtype: "am_prep", lines: [line({ itemId: "x", inputType: "on_hand" })] }),
    ];
    // Location A collapses to its FIRST line (on_hand); B is on_hand → no drift.
    expect(classifyPrepInputTypeDrift(templates)).toEqual([]);
  });
});

describe("classifyPrepNeedsLink", () => {
  it("lists active inventory lines with no link", () => {
    const t = tpl({
      locationId: "A",
      subtype: "am_prep",
      lines: [line({ lineId: "L1", linked: false, questionShaped: false })],
    });
    expect(classifyPrepNeedsLink(t)).toEqual([{ lineId: "L1", label: "Meatball mix" }]);
  });

  it("EXCLUDES question-shaped lines (a question carries no link)", () => {
    const t = tpl({
      locationId: "A",
      subtype: "am_prep",
      lines: [line({ lineId: "Q1", linked: false, questionShaped: true, inputType: "yes_no" })],
    });
    expect(classifyPrepNeedsLink(t)).toEqual([]);
  });

  it("EXCLUDES already-linked inventory lines", () => {
    const t = tpl({
      locationId: "A",
      subtype: "am_prep",
      lines: [line({ lineId: "L1", linked: true, itemId: "x" })],
    });
    expect(classifyPrepNeedsLink(t)).toEqual([]);
  });
});

describe("prepEsFill", () => {
  it("counts filled vs total over active lines", () => {
    const t = tpl({
      locationId: "A",
      subtype: "am_prep",
      lines: [line({ esMissing: false }), line({ esMissing: true }), line({ esMissing: false })],
    });
    expect(prepEsFill(t)).toEqual({ filled: 2, total: 3 });
  });

  it("is 0/0 on an empty template", () => {
    expect(prepEsFill({ lines: [] })).toEqual({ filled: 0, total: 0 });
  });
});

describe("prepOverviewTotals", () => {
  it("rolls needs-link, es-missing, and drift across templates", () => {
    const templates = [
      tpl({
        locationId: "A",
        subtype: "am_prep",
        lines: [line({ itemId: "x", inputType: "on_hand", linked: true }), line({ lineId: "L2", linked: false, esMissing: true })],
      }),
      tpl({
        locationId: "B",
        subtype: "am_prep",
        lines: [line({ itemId: "x", inputType: "yes_no", linked: true })],
      }),
    ];
    const drift = classifyPrepInputTypeDrift(templates);
    const totals = prepOverviewTotals(templates, drift);
    expect(totals.needsLink).toBe(1); // L2 unlinked inventory
    expect(totals.esMissing).toBe(1); // L2 esMissing
    expect(totals.inputTypeDrift).toBe(1); // item x drift on_hand vs yes_no
  });
});

// Type-only assertion the LineInputType union carries the shapes we test.
const _shapes: LineInputType[] = ["on_hand", "portioned", "line", "yes_no", "free_text"];
void _shapes;
