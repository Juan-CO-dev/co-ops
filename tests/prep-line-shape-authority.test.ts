/**
 * THE CREATE/CONVERT AUTHORITY SPLIT (Phase-3 UX pair, report-A bug 4).
 *
 * Creating a prep line has always been AGM+ (≥6); converting an existing line's
 * input type has always been MoO-adjacent (≥7). Once the add form can CHOOSE a
 * shape, "create a line whose shape diverges from its section" is structurally
 * the convert operation performed one step earlier — so it takes the convert
 * authority, while a same-as-section create keeps today's ≥6 door.
 *
 * These are the pure predicates both halves (client picker + server enforcement)
 * read, so the two can never disagree about which door a choice walks through.
 */
import { describe, it, expect } from "vitest";
import {
  CREATE_LINE_MIN_LEVEL,
  DIVERGENT_LINE_MIN_LEVEL,
  isDivergentLineShape,
  requiredLevelForLineShape,
  canCreateLineWithShape,
} from "@/lib/prep-sections";
import type { LineInputType, PrepSectionShape } from "@/lib/types";

const SECTION_SHAPES: PrepSectionShape[] = ["on_hand", "portioned", "line", "yes_no"];
const LINE_TYPES: LineInputType[] = ["on_hand", "portioned", "line", "yes_no", "free_text"];

describe("the two authority floors", () => {
  it("same-as-section create is the existing AGM+ door", () => {
    expect(CREATE_LINE_MIN_LEVEL).toBe(6);
  });

  it("divergent create borrows the convert route's floor", () => {
    // app/api/admin/checklist-templates/[id]/items/[itemId]/input-type/route.ts
    expect(DIVERGENT_LINE_MIN_LEVEL).toBe(7);
  });
});

describe("isDivergentLineShape", () => {
  it("a request equal to the section's shape is never divergent", () => {
    for (const shape of SECTION_SHAPES) {
      expect(isDivergentLineShape(shape, shape)).toBe(false);
    }
  });

  it("every other input type IS divergent", () => {
    for (const shape of SECTION_SHAPES) {
      for (const requested of LINE_TYPES) {
        if (requested === shape) continue;
        expect(isDivergentLineShape(shape, requested)).toBe(true);
      }
    }
  });

  it("free_text is divergent from every section shape — no section can be free_text", () => {
    // prep_sections_shape_check (migration 0086) admits only the four numeric/
    // yes_no shapes, so a free_text line is ALWAYS a per-line divergence.
    for (const shape of SECTION_SHAPES) {
      expect(isDivergentLineShape(shape, "free_text")).toBe(true);
    }
  });

  it("null/undefined request means 'take the section's shape' — not divergent", () => {
    for (const shape of SECTION_SHAPES) {
      expect(isDivergentLineShape(shape, null)).toBe(false);
    }
  });
});

describe("requiredLevelForLineShape", () => {
  it("same shape → 6", () => {
    expect(requiredLevelForLineShape("on_hand", "on_hand")).toBe(6);
    expect(requiredLevelForLineShape("yes_no", "yes_no")).toBe(6);
  });

  it("omitted shape → 6 (the unchanged pre-picker path)", () => {
    expect(requiredLevelForLineShape("portioned", null)).toBe(6);
  });

  it("divergent shape → 7", () => {
    expect(requiredLevelForLineShape("on_hand", "yes_no")).toBe(7);
    expect(requiredLevelForLineShape("yes_no", "free_text")).toBe(7);
    expect(requiredLevelForLineShape("line", "portioned")).toBe(7);
  });
});

describe("canCreateLineWithShape", () => {
  it("L6 keeps the same-shape create it has today", () => {
    expect(canCreateLineWithShape(6, "on_hand", "on_hand")).toBe(true);
    expect(canCreateLineWithShape(6, "on_hand", null)).toBe(true);
  });

  it("L6 is refused a divergent shape — that is the convert authority", () => {
    expect(canCreateLineWithShape(6, "on_hand", "yes_no")).toBe(false);
    // Misc's seeded shape IS yes_no (0086) — a Text question there still diverges.
    expect(canCreateLineWithShape(6, "yes_no", "free_text")).toBe(false);
  });

  it("L7+ may create any shape", () => {
    for (const shape of SECTION_SHAPES) {
      for (const requested of LINE_TYPES) {
        expect(canCreateLineWithShape(7, shape, requested)).toBe(true);
        expect(canCreateLineWithShape(10, shape, requested)).toBe(true);
      }
    }
  });

  it("below 6 nothing may be created, same shape or not", () => {
    expect(canCreateLineWithShape(5, "on_hand", "on_hand")).toBe(false);
    expect(canCreateLineWithShape(5, "on_hand", null)).toBe(false);
    expect(canCreateLineWithShape(5, "on_hand", "yes_no")).toBe(false);
  });

  it("a non-finite level is refused, never silently permitted", () => {
    expect(canCreateLineWithShape(Number.NaN, "on_hand", "on_hand")).toBe(false);
  });
});
