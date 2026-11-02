import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const marketingValues = Object.entries(
  JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>,
).filter(([key]) => key.startsWith("marketing."));

// A bounded vocabulary guard: only these known marketing words are checked.
// Unlike a general accent heuristic, it permits legitimate Spanish endings.
const expectedWords = [
  "l\u00ednea", "est\u00e1n", "instant\u00e1nea", "m\u00e1s", "d\u00eda", "d\u00edas",
  "semana", "p\u00e1gina", "c\u00f3digo", "n\u00fameros", "per\u00edodo",
  "correcci\u00f3n", "importaci\u00f3n", "proporci\u00f3n", "comparaci\u00f3n",
];
const unaccent = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "");

describe("marketing Spanish spelling", () => {
  it("rejects the known accent substitutions in every marketing value", () => {
    expect(marketingValues.filter(([, value]) => /l\u00f3nea|est\u00f3n|instant\u00f3nea/u.test(value))).toEqual([]);
  });

  it.each(expectedWords)("keeps the known word %s correctly spelled everywhere", (expected) => {
    const matching = marketingValues.flatMap(([key, value]) =>
      (value.toLowerCase().match(/\p{L}+/gu) ?? [])
        .filter((word) => unaccent(word) === unaccent(expected))
        .map((word) => ({ key, word })),
    );
    expect(matching.length).toBeGreaterThan(0);
    expect(matching.filter(({ word }) => word !== expected)).toEqual([]);
  });
});
