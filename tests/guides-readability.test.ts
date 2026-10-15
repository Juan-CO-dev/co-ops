// tests/guides-readability.test.ts
import { describe, it, expect } from "vitest";
import { englishSections, fkGrade, plainSentences, syllables } from "@/lib/guides/readability-shared";

describe("syllables", () => {
  it.each([["the", 1], ["prep", 1], ["make", 1], ["table", 2], ["station", 2], ["verification", 5], ["2:00", 1], ["", 0]])(
    "%s has %i", (word, n) => expect(syllables(word)).toBe(n));
});

describe("plainSentences", () => {
  it("drops headings, images, tables, rules and code; keeps bullets as their own sentences", () => {
    const md = [
      "### How do I log in?", "", "![Login](img/staff/01-login.png)", "",
      "Tap **P Street**. Then tap your name", "", "| a | b |", "|---|---|", "---",
      "- Pick your role", "1. Type your PIN.", "```", "code here", "```", "See [the board](#board) for more.",
    ].join("\n");
    expect(plainSentences(md)).toEqual(["Tap X.", "Then tap your name.", "Pick your role.", "Type your PIN.", "See the board for more."]);
  });
  it("skips label-only lines", () => expect(plainSentences("**What you see**\n\nFour tiles.\n\n- **Worth knowing**")).toEqual(["Four tiles."]));
  it("scores a bolded sentence instead of hiding it", () => expect(plainSentences("- **Nothing here saves as you go.** It all lives on the tablet until **Submit Opening** goes through.")).toEqual(["Nothing here saves as you go.", "It all lives on the tablet until X goes through."]));
});

describe("fkGrade", () => {
  it("matches the Flesch-Kincaid formula", () => {
    const r = fkGrade(["The cat sat.", "The dog ran."]);
    expect(r.words).toBe(6);
    expect(r.sentences).toBe(2);
    expect(r.grade).toBeCloseTo(0.39 * 3 + 11.8 * 1 - 15.59, 2);
  });
  it("is zero for no words", () => expect(fkGrade([]).grade).toBe(0));
});

describe("englishSections", () => {
  it("splits on ## and stops each section at its Spanish", () => {
    const md = "# Title\n\nIntro.\n\n## Morning\n\nTap it.\n\n### En español\n\nToca.\n\n## Night\n\nCount it.\n";
    expect(englishSections(md)).toEqual([
      { heading: "Morning", body: "\nTap it.\n\n" },
      { heading: "Night", body: "\nCount it.\n" },
    ]);
  });
});
