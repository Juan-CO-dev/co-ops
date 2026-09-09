/**
 * Unit spine — `moveStage` consults LEGAL_TRANSITIONS (PR fix/guide-walk-p3-batch, 2026-09-09).
 *
 * `tests/catering-pipeline-transitions.test.ts` pins the table and `canTransition`. This pins the
 * WIRING: for months the table existed while `moveStage` never called it (the module said "NOT YET
 * WIRED"), so the board offered every stage on one tap. Source assertion, because `moveStage` reaches
 * for `getServiceRoleClient()` internally and exposes no seam.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("lib/catering/pipeline.ts", "utf8").replace(/\r\n/g, "\n");
const fn = (() => {
  const start = src.indexOf("export async function moveStage(");
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("\n}\n");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
})();

describe("moveStage is wired to LEGAL_TRANSITIONS", () => {
  it("refuses an illegal move BEFORE the stage UPDATE", () => {
    const guard = fn.indexOf("canTransition(fromStage, args.toStage)");
    const update = fn.indexOf(".update({ stage: args.toStage");
    expect(guard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(update);
  });

  it("names the refusal with its own code", () => {
    expect(fn).toContain('"illegal_transition"');
  });

  it("refuses an unknown legacy label rather than guessing", () => {
    expect(fn).toContain("fromStage === null || !canTransition");
  });
});
