/**
 * W15/B087: ticking "include note" on an existing Yes/No section showed no
 * "Change input type" path (the dirty check compared the shape only), so Save sent
 * labels/order and the note setting was silently dropped.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { sectionShapeDirty } from "@/lib/prep-sections";

describe("W15/B087 sectionShapeDirty", () => {
  it("a yes/no section toggling its note on is dirty", () => {
    expect(sectionShapeDirty({ shape: "yes_no", columns: ["yes_no"] }, "yes_no", true)).toBe(true);
  });
  it("a yes/no section toggling its note off is dirty", () => {
    expect(sectionShapeDirty({ shape: "yes_no", columns: ["yes_no", "free_text"] }, "yes_no", false)).toBe(true);
  });
  it("same shape and same note is clean", () => {
    expect(sectionShapeDirty({ shape: "yes_no", columns: ["yes_no", "free_text"] }, "yes_no", true)).toBe(false);
    expect(sectionShapeDirty({ shape: "yes_no", columns: ["yes_no"] }, "yes_no", false)).toBe(false);
  });
  it("a numeric shape ignores includeNote", () => {
    expect(sectionShapeDirty({ shape: "on_hand", columns: ["par", "on_hand", "back_up", "total"] }, "on_hand", true)).toBe(false);
  });
  it("a different shape is dirty", () => {
    expect(sectionShapeDirty({ shape: "on_hand", columns: ["par", "on_hand", "back_up", "total"] }, "line", false)).toBe(true);
  });
  it("SectionsTab uses the helper for its dirty check", () => {
    const src = readFileSync("components/admin/templates/SectionsTab.tsx", "utf8");
    expect(src).toMatch(/const shapeChanged = sectionShapeDirty\(section, shape, includeNote\)/);
  });
});
