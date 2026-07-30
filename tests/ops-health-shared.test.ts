/**
 * Unit spine — the adoption roll-up pure surface (Ops guardrails NOW #3).
 * bucketAdoptionCounts sums each curated surface's mapped actions from a raw
 * per-action count map, preserving declaration order and returning every surface
 * (zero-count included so the card roster stays stable).
 */
import { describe, it, expect } from "vitest";
import {
  ADOPTION_SURFACES,
  bucketAdoptionCounts,
} from "@/lib/admin/ops-health-shared";

describe("bucketAdoptionCounts — curated audit-action → surface roll-up", () => {
  it("returns every surface in declaration order, even with zero activity", () => {
    const out = bucketAdoptionCounts(new Map());
    expect(out.map((s) => s.id)).toEqual(ADOPTION_SURFACES.map((s) => s.id));
    expect(out.every((s) => s.count === 0)).toBe(true);
  });

  it("sums ALL of a surface's mapped actions into one count", () => {
    // checklists maps two actions: checklist.confirm + checklist_submission.create
    const counts = new Map<string, number>([
      ["checklist.confirm", 3],
      ["checklist_submission.create", 4],
    ]);
    const out = bucketAdoptionCounts(counts);
    const checklists = out.find((s) => s.id === "checklists");
    expect(checklists?.count).toBe(7);
  });

  it("attributes a single-action surface correctly and ignores unmapped actions", () => {
    const counts = new Map<string, number>([
      ["sku_count.recorded", 12],
      ["photo.upload", 5],
      ["some.unmapped.action", 999], // never appears in any surface → ignored
    ]);
    const out = bucketAdoptionCounts(counts);
    expect(out.find((s) => s.id === "counts")?.count).toBe(12);
    expect(out.find((s) => s.id === "photos")?.count).toBe(5);
    // an unmapped action contributes to no surface (total is only the mapped counts)
    expect(out.reduce((n, s) => n + s.count, 0)).toBe(17);
  });

  it("keeps the map small (a pulse, not analytics)", () => {
    expect(ADOPTION_SURFACES.length).toBeLessThanOrEqual(8);
    expect(ADOPTION_SURFACES.length).toBeGreaterThanOrEqual(6);
  });

  it("every surface maps at least one action and ids are unique", () => {
    const ids = new Set<string>();
    for (const s of ADOPTION_SURFACES) {
      expect(s.actions.length).toBeGreaterThan(0);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
    }
  });
});
