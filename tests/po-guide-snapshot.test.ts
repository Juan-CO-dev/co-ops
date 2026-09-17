/**
 * V3-A §3 — the guide key on a PO line: snapshotted at draft time from the LIVE guide, read
 * back as `snapshot ?? live`. Two pins:
 *   1. resolveGuideKey — the pure read law (a pre-0205 snapshot with a position but no section
 *      still counts as snapshotted; a null snapshot falls back to the live guide; nothing → null).
 *   2. A source pin on lib/purchase-orders.ts (the repo's pattern for wiring laws, see
 *      po-vendor-picker.test.ts): both draft paths write BOTH snapshot columns from the ONE
 *      helper `guideKeysFor`, and no reader of the dropped `vendor_items.guide_position` remains.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveGuideKey } from "@/lib/order-guides-shared";

describe("resolveGuideKey (V3-A read law)", () => {
  const live = { position: 2001, section: "Produce" };
  it("a snapshot wins over the live guide, section included", () => {
    expect(resolveGuideKey({ position: 1001, section: "Dairy" }, live)).toEqual({ position: 1001, section: "Dairy" });
  });
  it("a pre-0205 snapshot (position, no section) still counts as snapshotted", () => {
    expect(resolveGuideKey({ position: 7, section: null }, live)).toEqual({ position: 7, section: null });
  });
  it("no snapshot → the live guide (legacy POs, lines added after an edit)", () => {
    expect(resolveGuideKey({ position: null, section: null }, live)).toEqual({ position: 2001, section: "Produce" });
  });
  it("no snapshot and not on any guide → nulls", () => {
    expect(resolveGuideKey({ position: null, section: null }, undefined)).toEqual({ position: null, section: null });
  });
});

describe("lib/purchase-orders.ts wiring pins", () => {
  const src = readFileSync("lib/purchase-orders.ts", "utf8");
  it("never reads the dropped vendor_items.guide_position", () => {
    expect(src).not.toMatch(/select\("id, guide_position"\)/);
    expect(src).not.toMatch(/\.order\("guide_position"/);
    expect(src).not.toMatch(/guide_position\b(?!_snapshot)[^\n]*\bs\.guide_position/);
  });
  it("both draft paths snapshot position AND section from guideKeysFor", () => {
    expect((src.match(/guideKeysFor\(/g) ?? []).length).toBeGreaterThanOrEqual(3); // createDraftsFromLines, insertNewDraftLines, loadPoDetail
    expect((src.match(/guide_section_snapshot: guideKeys\.get\(l\.skuId\)\?\.section \?\? null/g) ?? []).length).toBe(2);
    expect((src.match(/guide_position_snapshot: guideKeys\.get\(l\.skuId\)\?\.position \?\? null/g) ?? []).length).toBe(2);
  });
  it("loadPoDetail hydrates lines through resolveGuideKey and sorts the picker by the guide", () => {
    expect(src).toContain("resolveGuideKey({ position: l.guide_position_snapshot, section: l.guide_section_snapshot }, liveGuide.get(l.sku_id))");
    expect(src).toContain("compareByGuide(");
  });
  it("the confirmed snapshot carries the section", () => {
    expect(src).toContain("guideSection: l.guide_section_snapshot,");
  });
});
