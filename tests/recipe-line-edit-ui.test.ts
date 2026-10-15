/** Catalog Phase 1 — saved and draft lines edit in place; ingredients come from the picker. Source pins. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");
const builder = read("components/admin/recipes/RecipeBuilder.tsx");
const consumes = builder.slice(builder.indexOf("function ConsumesSection"), builder.indexOf("function DraftInputRow"));
const draftRow = builder.slice(builder.indexOf("function DraftInputRow"), builder.indexOf("// ── PRODUCES section"));

describe("CONSUMES — one searchable picker, one line form", () => {
  it("the three unsearchable selects are gone from the line form", () => {
    expect(consumes).not.toContain("skus.map((s) => (<option");
    expect(consumes).not.toContain("items.map((i) => (<option");
    expect(consumes).not.toContain("products.map((p) => (<option");
    expect(consumes).toContain("buildIngredientOptions(");
    expect(consumes.match(/<RecipeLineEditor/g)).toHaveLength(3); // add + live edit + draft edit
  });

  it("a saved line is edited IN PLACE through PATCH …/inputs/[inputId], behind the window", () => {
    const lane = consumes.slice(consumes.indexOf("const submitLiveEdit"), consumes.indexOf("const submitDraftEdit"));
    expect(lane).toContain("/inputs/${start.id}`");
    expect(lane).toContain("{ line: lineBody(line), expected: start.expected }");
    expect(lane).toContain('"PATCH"');
    expect(lane.indexOf('requestStepUp("E")')).toBeGreaterThan(-1);
    expect(lane.indexOf('requestStepUp("E")')).toBeLessThan(lane.indexOf("send("));
  });

  it("the expected line is captured when editing BEGINS, never re-read from a refreshed row (Astra r2 #1)", () => {
    expect(consumes).toContain('setEditing({ kind: "live", ...beginLineEdit(inp) })');
    expect(consumes).toContain("initial={live.initial}");
    expect(consumes).not.toContain("lineSnapshotFromView(");
    expect(consumes).not.toContain("initial={lineDraftFromView(inp)}");
  });

  it("a DRAFT line is edited in place locally (P2-7) — no request, no password", () => {
    const lane = consumes.slice(consumes.indexOf("const submitDraftEdit"), consumes.indexOf("return ("));
    expect(lane).toContain("onUpdateDraftInput(");
    expect(lane).not.toContain("send(");
    expect(lane).not.toContain("requestStepUp");
    expect(draftRow).toContain("onEdit");
    expect(builder).toContain("onUpdateDraftInput={updateDraftInput}");
  });

  it("a live add asks for the window; a draft add writes nothing and asks for nothing", () => {
    const lane = consumes.slice(consumes.indexOf("const submitAdd"), consumes.indexOf("const submitLiveEdit"));
    expect(lane.indexOf("if (isDraft)")).toBeLessThan(lane.indexOf('requestStepUp("E")'));
  });

  it("RecipeInputRow offers Edit beside Remove", () => {
    const row = read("components/admin/recipes/RecipeInputRow.tsx");
    expect(row).toContain("onEdit");
    expect(row).toContain('rk("recipes.row.edit")');
    expect(row).toContain('rk("recipes.row.edit_aria")');
  });
});
