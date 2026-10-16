import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hasUnbalancedQuestionMarks = (value: string) =>
  (value.match(/\?/g) ?? []).length !== (value.match(/¿/g) ?? []).length;
describe("dictionary UTF-8 integrity", () => {
  it("has no replacement character in either complete dictionary", () => {
    for (const language of ["en", "es"]) {
      expect(readFileSync(`lib/i18n/${language}.json`, "utf8"), language).not.toContain("\uFFFD");
    }
  });
  it("has no question mark inside a Spanish word anywhere in the dictionary", () => {
    const dictionary = JSON.parse(readFileSync("lib/i18n/es.json", "utf8")) as Record<string, string>;
    expect(Object.entries(dictionary).filter(([, value]) => hasUnbalancedQuestionMarks(value))).toEqual([]);
  });
  it("accepts legitimate Spanish questions and detects corrupted accented words", () => {
    expect(hasUnbalancedQuestionMarks("¿Quieres abrir este artículo? Sí.")).toBe(false);
    expect(hasUnbalancedQuestionMarks("art?culo")).toBe(true);
    expect(hasUnbalancedQuestionMarks("est? disponible")).toBe(true);
    expect(hasUnbalancedQuestionMarks("cambi?.")).toBe(true);
    expect(hasUnbalancedQuestionMarks("lí?nea")).toBe(true);
  });
});
