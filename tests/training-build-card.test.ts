/**
 * Unit spine — "Learn the build" step data (lib/training/build-card-shared.ts).
 *
 * Pins: the committed card export is FRESH against the build sheet (edit the
 * CSV → this fails until scripts/export-build-card.ts is re-run); the Crunchy
 * Boi steps run in the canonical order; every amount is GENERATED from the card
 * (no hand-typed counts); every card line is bound exactly once; and a def that
 * binds an unknown, doubled or missing line is REFUSED.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUILD_SHEET_PATH, exportBuildCard, serializeBuildCard } from "@/lib/training/build-card-export";
import { buildCardForSlug } from "@/lib/training/build-cards";
import {
  BUILD_DEFS,
  CARD_DISPLAY,
  buildDefForSlug,
  buildSteps,
  parseBuildSheetItem,
  type BuildCard,
  type BuildDef,
} from "@/lib/training/build-card-shared";

const CSV = readFileSync(BUILD_SHEET_PATH, "utf8");

describe("card export freshness", () => {
  it.each(BUILD_DEFS.map((d) => [d.slug, d] as const))("%s: committed JSON equals a fresh export of the sheet", (slug, def) => {
    const committed = readFileSync(`lib/training/build-cards/${slug}.card.json`, "utf8");
    expect(committed).toBe(serializeBuildCard(exportBuildCard(CSV, def.item)));
  });

  it("revision_sha changes when the item's rows change, and only then", () => {
    const base = exportBuildCard(CSV, "Crunchy Boi").revision_sha;
    const edited = CSV.replace("Crunchy Boi,Aioli,1.5,oz", "Crunchy Boi,Aioli,2,oz");
    expect(edited).not.toBe(CSV);
    expect(exportBuildCard(edited, "Crunchy Boi").revision_sha).not.toBe(base);
  });
});

describe("parseBuildSheetItem", () => {
  it("reads only the left block of the item, ending at the blank row", () => {
    const lines = parseBuildSheetItem(CSV, "Crunchy Boi");
    expect(lines.map((l) => l.ingredient)).toEqual([
      "Aioli", "Utz Ripples", "Provolone", "Turkey", "Onions", "Pickles", "Shredduce", "Oil/Vin", "Oregano",
    ]);
  });

  it("reads Handfull as a presentation amount with no quantity", () => {
    const chips = parseBuildSheetItem(CSV, "Crunchy Boi").find((l) => l.ingredient === "Utz Ripples");
    expect(chips).toEqual({ ingredient: "Utz Ripples", quantity: null, unit: null, presentation: "handful" });
  });

  it("refuses an item that is not on the sheet, and a bad quantity", () => {
    expect(() => parseBuildSheetItem(CSV, "No Such Sub")).toThrow(/not on the sheet/);
    const bad = "Sandwich,Ingredient,Quantity,Unit\nX,Aioli,lots,oz\n,,,\n";
    expect(() => parseBuildSheetItem(bad, "X")).toThrow(/bad quantity/);
  });
});

describe("Crunchy Boi steps", () => {
  const def = buildDefForSlug("crunchy-boi")!;
  const card = buildCardForSlug("crunchy-boi")!;
  const en = buildSteps(def, card, "en");
  const es = buildSteps(def, card, "es");

  it("run in the canonical order", () => {
    expect(en.map((s) => s.key)).toEqual([
      "whole", "slice", "gut", "aioli", "chips", "provolone", "turkey", "onions", "pickles", "shredduce", "oil-vin", "oregano",
    ]);
    expect(en.map((s) => s.n)).toEqual(en.map((_, i) => i + 1));
  });

  it("take amounts from the card, with sheet names except where a display rule applies", () => {
    const labels = Object.fromEntries(en.map((s) => [s.key, s.label]));
    expect(labels.aioli).toBe("Aioli · 1.5 oz");
    expect(labels.chips).toBe("Utz Ripples · a handful (about 22 chips)");
    expect(labels.provolone).toBe("Provolone · 2 slices");
    expect(labels.turkey).toBe("Turkey · 4 oz");
    expect(labels.shredduce).toBe("Shredduce · a handful");
    expect(labels["oil-vin"]).toBe("Oil and vinegar · 0.25 oz");
    expect(labels.oregano).toBe("Oregano · 0.1 oz");
  });

  it("the display rules change only how a line reads, never the card", () => {
    expect(card.lines.find((l) => l.ingredient === "Oil/Vin")).toBeTruthy();
    expect(card.lines.find((l) => l.ingredient === "Provolone")).toMatchObject({ quantity: 2, unit: "ea" });
  });

  it("state steps have no ingredient or amount", () => {
    expect(en.slice(0, 3).map((s) => [s.ingredient, s.amount])).toEqual([[null, null], [null, null], [null, null]]);
  });

  it("Spanish keeps the names and numbers, translates the handful and the action", () => {
    const chips = es.find((s) => s.key === "chips")!;
    expect(chips.label).toBe("Utz Ripples · un puñado (unas 22 papitas)");
    expect(es.find((s) => s.key === "provolone")!.label).toBe("Provolone · 2 rebanadas");
    expect(es.find((s) => s.key === "oil-vin")!.label).toBe("Aceite y vinagre · 0.25 oz");
    expect(es.find((s) => s.key === "turkey")!.label).toBe("Turkey · 4 oz");
    expect(chips.action).not.toBe(en.find((s) => s.key === "chips")!.action);
  });

  it("every step has an en and es how-to, and none states a number (amounts come from the card)", () => {
    for (const s of en) {
      expect(s.howto?.en).toBeTruthy();
      expect(s.howto?.es).toBeTruthy();
      expect(`${s.howto?.en} ${s.howto?.es}`).not.toMatch(/\d/);
    }
  });

  it("every step is marked drawn (illustrated) until photos land", () => {
    expect(en.every((s) => s.drawn)).toBe(true);
  });
});

describe("buildSteps refusals", () => {
  const card: BuildCard = {
    item: "T",
    source: "test",
    revision_sha: "x",
    lines: [
      { ingredient: "A", quantity: 1, unit: "oz", presentation: null },
      { ingredient: "B", quantity: 2, unit: "ea", presentation: null },
    ],
  };
  const step = (key: string, line: string | null) => ({
    key,
    line,
    action: { en: key, es: key },
    howto: { en: "note", es: "nota" },
  });
  const def = (steps: BuildDef["steps"]): BuildDef => ({ slug: "t", item: "T", steps });

  it("refuses a line that is not on the card", () => {
    expect(() => buildSteps(def([step("a", "A"), step("b", "B"), step("c", "C")]), card, "en")).toThrow(/not on the T card/);
  });
  it("refuses a line bound twice", () => {
    expect(() => buildSteps(def([step("a", "A"), step("a2", "A"), step("b", "B")]), card, "en")).toThrow(/bound twice/);
  });
  it("refuses a card line with no step", () => {
    expect(() => buildSteps(def([step("a", "A")]), card, "en")).toThrow(/no step: B/);
  });
  it("refuses a card for a different item", () => {
    expect(() => buildSteps({ ...def([]), item: "Other" }, card, "en")).toThrow(/card is "T"/);
  });
});

describe("display table mirror (co-scenes src/card/display.ts)", () => {
  it("equals the vendored co-scenes card-display.json, keyed by sha256 of the trimmed lower-cased name", () => {
    const vendored = JSON.parse(readFileSync("public/vendor/co-scenes/card-display.json", "utf8")) as unknown;
    const hashed = Object.fromEntries(
      Object.entries(CARD_DISPLAY).map(([name, rule]) => [
        createHash("sha256").update(name.trim().toLowerCase()).digest("hex"),
        rule,
      ]),
    );
    expect(hashed).toEqual(vendored);
  });

  it("every rule names a line that is on a card (a typo would silently never apply)", () => {
    const names = new Set(
      BUILD_DEFS.flatMap((d) => buildCardForSlug(d.slug)!.lines.map((l) => l.ingredient.trim().toLowerCase())),
    );
    for (const name of Object.keys(CARD_DISPLAY)) expect(names.has(name.trim().toLowerCase()), name).toBe(true);
  });
});
