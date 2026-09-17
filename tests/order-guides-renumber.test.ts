import { describe, expect, it } from "vitest";
import { applyGuideEdit, renumber, type GuideModel } from "@/lib/order-guides";

const model = (): GuideModel => ({
  guideId: "g", vendorId: "v", name: "PFG", updatedAt: "2026-09-16T00:00:00Z",
  sections: [
    { id: "s1", name: "Produce", position: 1, lines: [
      { id: "l1", position: 1, skuId: "a", label: "Arugula", itemNumber: "1", note: null },
      { id: "l2", position: 2, skuId: "b", label: "Basil", itemNumber: null, note: null } ] },
    { id: "s2", name: "Dairy", position: 2, lines: [
      { id: "l3", position: 1, skuId: "c", label: "Eggs", itemNumber: null, note: null } ] },
  ],
});

describe("renumber", () => {
  it("makes sections and lines dense from 1 in array order", () => {
    const m = model(); m.sections[0]!.position = 7; m.sections[0]!.lines[1]!.position = 40;
    const r = renumber(m);
    expect(r.sections.map((s) => s.position)).toEqual([1, 2]);
    expect(r.sections[0]!.lines.map((l) => l.position)).toEqual([1, 2]);
  });
});

describe("applyGuideEdit", () => {
  it("moves a line up within its section", () => {
    const r = applyGuideEdit(model(), { kind: "move_line", lineId: "l2", direction: "up" });
    expect(r.sections[0]!.lines.map((l) => l.id)).toEqual(["l2", "l1"]);
  });
  it("moving the first line up is a no-op", () => {
    expect(applyGuideEdit(model(), { kind: "move_line", lineId: "l1", direction: "up" })).toEqual(renumber(model()));
  });
  it("moves a line to another section (appended last)", () => {
    const r = applyGuideEdit(model(), { kind: "move_line_to_section", lineId: "l1", sectionId: "s2" });
    expect(r.sections[1]!.lines.map((l) => l.id)).toEqual(["l3", "l1"]);
    expect(r.sections[1]!.lines[1]!.position).toBe(2);
  });
  it("moves a section down", () => {
    const r = applyGuideEdit(model(), { kind: "move_section", sectionId: "s1", direction: "down" });
    expect(r.sections.map((s) => s.id)).toEqual(["s2", "s1"]);
  });
  it("adds a line for a SKU not yet on the guide, refuses one that already is", () => {
    const r = applyGuideEdit(model(), { kind: "add_line", sectionId: "s2", skuId: "d", label: "Milk", itemNumber: null });
    expect(r.sections[1]!.lines.map((l) => l.skuId)).toEqual(["c", "d"]);
    expect(() => applyGuideEdit(model(), { kind: "add_line", sectionId: "s2", skuId: "a", label: "Arugula", itemNumber: null })).toThrow(/already on the guide/);
  });
  it("sets the SKU on a null-SKU line, and refuses a SKU already placed", () => {
    const m = model(); m.sections[0]!.lines[0]!.skuId = null;
    const r = applyGuideEdit(m, { kind: "set_line_sku", lineId: "l1", skuId: "z" });
    expect(r.sections[0]!.lines[0]!.skuId).toBe("z");
    expect(() => applyGuideEdit(m, { kind: "set_line_sku", lineId: "l1", skuId: "b" })).toThrow(/already on the guide/);
  });
  it("removes a line; refuses to remove a non-empty section; removes an empty one", () => {
    const r = applyGuideEdit(model(), { kind: "remove_line", lineId: "l3" });
    expect(r.sections[1]!.lines).toEqual([]);
    expect(() => applyGuideEdit(model(), { kind: "remove_section", sectionId: "s1" })).toThrow(/not empty/);
    expect(applyGuideEdit(r, { kind: "remove_section", sectionId: "s2" }).sections.map((s) => s.id)).toEqual(["s1"]);
  });
  it("adds and renames sections, refusing a duplicate name", () => {
    const r = applyGuideEdit(model(), { kind: "add_section", name: "Meat" });
    expect(r.sections.map((s) => s.name)).toEqual(["Produce", "Dairy", "Meat"]);
    expect(() => applyGuideEdit(r, { kind: "rename_section", sectionId: "s1", name: "meat" })).toThrow(/section name/);
  });
});
