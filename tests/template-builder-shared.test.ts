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
  TemplateBuilderError,
} from "@/lib/admin/template-builder-shared";
import type { ChecklistTemplateItemTranslations } from "@/lib/types";

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
