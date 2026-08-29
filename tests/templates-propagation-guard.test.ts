/**
 * Unit spine — the LINK RE-ASSERTION in `propagateItemDefinitionToLines`.
 *
 * A registry-item definition edit (MoO+) fans out to every ACTIVE line that links the item,
 * across both locations and the opening mirror. The list is SELECTed once and the loop then
 * spends one to four round trips per line, so a GM unlinking one of those lines
 * (`unlinkPrepItem`: item_id → null, label frozen) or deactivating it lands INSIDE the pass.
 * Writing by `id` alone then propagates the registry value onto a line that has just left the
 * registry — the operator's unlink silently overruled, with the returned count still claiming
 * the line was propagated. The guard is to re-assert `item_id` + `active` on every write in
 * the loop and to COUNT what that refuses.
 *
 * This function is private and DB-coupled: it is not exported, its caller reaches for
 * `getServiceRoleClient()`, and what has to be proven is the SHAPE of a write — a predicate
 * that must be present in a WHERE clause and a guard that must run BEFORE two helper calls.
 * No unit test over the module's exports can see either. So this takes the house's
 * source-assertion posture (tests/dynamic-pars-walker.test.ts, tests/loader-scale-ceilings.ts,
 * tests/vendor-order-minimum.test.ts) for the same stated reason those do: when the guarantee
 * is "this write can never land unguarded", the ABSENCE is the thing to assert.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "lib", "admin", "templates.ts"),
  "utf8",
);

/** The propagation function's own body, so no assertion can be satisfied by another site. */
function propagationBody(): string {
  const start = SRC.indexOf("async function propagateItemDefinitionToLines(");
  const end = SRC.indexOf("async function lineStillLinksItem(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SRC.slice(start, end);
}

describe("every write in the propagation loop re-asserts the link", () => {
  it("the per-row column UPDATE filters on item_id AND active, not on id alone", () => {
    const body = propagationBody();
    const update = body.slice(body.indexOf('.update(colUpdate'), body.indexOf("updated += 1"));

    expect(update).toContain('.eq("id", item.id)');
    expect(update).toContain('.eq("item_id", itemId)');
    expect(update).toContain('.eq("active", true)');
  });

  it("that UPDATE asks for a rowcount — a Supabase UPDATE matching nothing is silent", () => {
    const body = propagationBody();
    const update = body.slice(body.indexOf('.update(colUpdate'), body.indexOf("updated += 1"));

    expect(update).toContain('{ count: "exact" }');
    // …and the count is actually consulted, not merely requested.
    expect(update).toMatch(/count \?\? 0\) === 0/);
  });

  it("a refused write is counted as SKIPPED, never as propagated", () => {
    const body = propagationBody();
    const update = body.slice(body.indexOf('.update(colUpdate'), body.indexOf("updated += 1"));

    // The whole point of the finding: `updated` must not be incremented
    // unconditionally, or the race is undetectable from the return value.
    expect(update).toContain("skipped += 1");
    expect(body).toContain("return { updated, skipped };");
  });
});

describe("the prep helpers are guarded by a re-read, because they write by id", () => {
  it("the link re-check runs BEFORE setPrepItemSection and setPrepItemMeta", () => {
    const body = propagationBody();
    const guard = body.indexOf("lineStillLinksItem(sb, item.id, itemId)");
    const section = body.indexOf("setPrepItemSection(sb,");
    const meta = body.indexOf("setPrepItemMeta(sb,");

    expect(guard).toBeGreaterThan(-1);
    expect(section).toBeGreaterThan(guard);
    expect(meta).toBeGreaterThan(guard);
  });

  it("a line that lost its link is skipped, not written with a stale definition", () => {
    const body = propagationBody();
    const guard = body.slice(body.indexOf("lineStillLinksItem(sb, item.id, itemId)"));

    expect(guard.slice(0, 120)).toContain("skipped += 1");
    expect(guard.slice(0, 160)).toContain("continue;");
  });

  it("the re-check itself asserts the same two predicates as the write", () => {
    const helper = SRC.slice(SRC.indexOf("async function lineStillLinksItem("));

    expect(helper).toContain('.eq("id", lineId)');
    expect(helper).toContain('.eq("item_id", itemId)');
    expect(helper).toContain('.eq("active", true)');
  });
});

describe("the skip is reported, not swallowed", () => {
  it("updateRegistryItemDefinition audits the skipped count beside the propagated one", () => {
    const audit = SRC.slice(
      SRC.indexOf("const propagated = await propagateItemDefinitionToLines("),
      SRC.indexOf("export async function addUnit("),
    );

    expect(audit).toContain("propagated_line_count: propagated.updated");
    expect(audit).toContain("propagated_lines_skipped: propagated.skipped");
  });
});
