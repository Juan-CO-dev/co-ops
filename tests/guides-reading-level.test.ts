// tests/guides-reading-level.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { englishSections, fkGrade, plainSentences } from "@/lib/guides/readability-shared";

const MAX_GRADE = 6;
const MIN_WORDS = 30; // the formula swings wildly on a few words

describe("guides read at grade 6 or lower (Juan 2026-10-13)", () => {
  it.each(["staff", "manager", "catering"])("%s guide: every English section", (g) => {
    const md = readFileSync(`docs/guides/${g}-guide.md`, "utf8");
    const tooHard = englishSections(md).flatMap(({ heading, body }) => {
      const sentences = plainSentences(body);
      const r = fkGrade(sentences);
      if (r.words < MIN_WORDS || r.grade <= MAX_GRADE) return [];
      const longest = [...sentences].sort((a, b) => b.split(" ").length - a.split(" ").length).slice(0, 3);
      return [`${heading}: grade ${r.grade.toFixed(1)} — longest: ${longest.join(" | ")}`];
    });
    expect(tooHard).toEqual([]);
  });
});
