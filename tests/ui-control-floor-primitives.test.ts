/**
 * Unit spine — THE 44px CONTROL FLOOR ON THE SHARED DISCLOSURE PRIMITIVES
 * (audit 2026-08-29, cluster reports-counts-ui).
 *
 * A class string is not a pure function and nothing here can render a component (the
 * spine is node-environment, no DOM). What IS assertable is the SOURCE — the same
 * posture tests/loader-scale-ceilings.test.ts and tests/dynamic-pars-walker.test.ts
 * take when the guarantee lives in a shape rather than in a return value.
 *
 * Why these two files and not a repo-wide sweep: `SummaryRow` and `CollapsibleSection`
 * are the two Disclosure-Doctrine PRIMITIVES (docs/DISCLOSURE_DOCTRINE.md), so a floor
 * violation in either is inherited silently by every consumer instead of being visible
 * on the surface that owns it. `SummaryRow`'s toggle shipped at `min-h-[32px]` and was
 * the LAST such control in the repo: the 2026-08-19 phase-2 sweep enumerated the
 * `min-h-[32px]` button pills consumer-by-consumer (phase2-violation-ledger.md § Dimension 2)
 * and raised every one of them, but never named the primitive the consumers share.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Heights below the floor. Real class strings only — a doc comment is allowed to
 *  NAME the value it was raised from, which is why this reads className lines, not
 *  the whole file. */
const UNDER_FLOOR = ["min-h-[32px]", "min-h-[36px]", "min-h-[40px]"];
const classLines = (src: string) => src.split("\n").filter((l) => l.includes("className="));

describe("SummaryRow — the toggle seven admin surfaces inherit", () => {
  const src = read("components/ui/SummaryRow.tsx");

  it("sizes its toggle at the 44px floor", () => {
    expect(src.includes("min-h-[44px]")).toBe(true);
    const rendered = classLines(src).join("\n");
    for (const bad of UNDER_FLOOR) expect(rendered.includes(bad)).toBe(false);
  });

  it("pairs the floor with items-center — a 44px control without centring does not exist", () => {
    // AGENTS.md § UI design system: the two are one rule, never one without the other.
    expect(src.includes("min-h-[44px] items-center")).toBe(true);
  });

  it("keeps the toggle a real <button> with the aria contract (D10)", () => {
    // The floor only means something on a genuine tap target; pin that this stayed one.
    expect(src.includes("type=\"button\"")).toBe(true);
    expect(src.includes("aria-expanded={expanded}")).toBe(true);
    expect(src.includes("aria-controls={drawerId}")).toBe(true);
  });
});

describe("CollapsibleSection — the sibling primitive that was already correct", () => {
  const src = read("components/ui/CollapsibleSection.tsx");

  it("is and stays at the floor, so the two primitives cannot drift apart", () => {
    expect(src.includes("min-h-[44px]")).toBe(true);
    const rendered = classLines(src).join("\n");
    for (const bad of UNDER_FLOOR) expect(rendered.includes(bad)).toBe(false);
  });
});
