import { expect, it } from "vitest";
import { humanEzcaterNotes } from "@/lib/catering/ezcater-detail-shared";
import { wrapEzcaterNotes } from "@/lib/ezcater/lifecycle-shared";

it("does not display outdated machine order facts alongside the structured snapshot", () => {
  expect(humanEzcaterNotes(`Human before\n${wrapEzcaterNotes("Old quantity: 99")}\nHuman after`))
    .toBe("Human before\n\nHuman after");
});
it("preserves unmarked or incomplete notes verbatim", () => {
  for (const note of [null, "Human note", "--- ezCater order (auto) ---\nIncomplete"]) {
    expect(humanEzcaterNotes(note)).toBe(note);
  }
});
