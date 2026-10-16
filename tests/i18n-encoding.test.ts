import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const brokenWord = /\p{L}\?\p{L}/u;
describe("dictionary UTF-8 integrity", () => {
  it("has no replacement character in either complete dictionary", () => {
    for (const language of ["en", "es"]) {
      expect(readFileSync(`lib/i18n/${language}.json`, "utf8"), language).not.toContain("\uFFFD");
    }
  });
  it("has no question mark inside a Spanish word anywhere in the dictionary", () => {
    const dictionary = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    expect(Object.entries(dictionary).filter(([, value]) => brokenWord.test(value))).toEqual([]);
  });
  it("accepts legitimate Spanish questions and detects corrupted accented words", () => {
    expect(brokenWord.test("¿Quieres abrir este artículo? Sí." )).toBe(false);
    expect(brokenWord.test("art?culo")).toBe(true);
    expect(brokenWord.test("lí?nea")).toBe(true);
  });
});
