import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Audit W18/B024: the shop tabs on /ordering are soft navigations (`?location=`), so React
// reuses the ParPassWalker instance unless it is keyed by the shop. Without the key, shop A's
// unsubmitted counts survive the tab switch and are posted as shop B's walk. The house reset
// rule is a key (or a during-render compare), never an effect.
it("the walker island is keyed by the shop so a tab switch drops the walk", () => {
  const source = readFileSync("app/ordering/page.tsx", "utf8");
  const tag = source.match(/<ParPassWalker\b[\s\S]*?\/>/);
  expect(tag, "ParPassWalker is rendered").not.toBeNull();
  expect(tag![0]).toMatch(/\bkey=\{locationId\}/);
});
