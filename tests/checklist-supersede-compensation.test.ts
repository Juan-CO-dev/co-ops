/**
 * Unit spine — `completeItem`'s MISSING COMPENSATION (audit v2, seat C5, finding F4).
 *
 * `completeItem` claims the live-head slot flip-first: supersede whatever live completion
 * exists for this (instance, template_item), then INSERT the new one. Migration 0176's
 * partial unique index `checklist_completions_one_live_head` makes a second live head
 * impossible, and a racing writer that inserted between our supersede and our insert trips
 * 23505 — which the loop already handles by re-claiming and retrying.
 *
 * EVERY OTHER INSERT ERROR THREW WITH THE PRIOR HEAD ALREADY STAMPED. The supersede runs on
 * the SERVICE-ROLE client (bypasses RLS); the insert runs on the AUTHED one. The function's
 * own docstring says RLS rejects the insert when the instance is not open, so the reachable
 * sequence is: a KH taps an item → ensureInstanceOpen passes → the supersede lands → a GM's
 * confirmInstance (or the auto-release RPC) flips the instance → the KH's insert is denied →
 * a previously-completed closing item silently reads as NOT DONE on a now-confirmed closing,
 * with no route back (completeItem 409s on a closed instance). An FK failure on `photo_id`
 * produces the same loss with no race at all.
 *
 * `recordPlacement` and `confirmInstance` both revert their claim on a dependent-write
 * failure; `completeItem` was the odd one out, on the hottest write path in the app.
 *
 * WHY SOURCE ASSERTION. `completeItem` takes its AUTHED client as a parameter but reaches
 * for `getServiceRoleClient()` internally for the supersede — and there is no Supabase env
 * on the spine, so any call that gets that far dies at the module boundary rather than at
 * the branch under test. The compensation is therefore asserted where it lives, the same
 * posture tests/admin-sku-write-contracts.test.ts takes for the absences it pins.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const src = read("lib/checklists.ts");
const body = (() => {
  const start = src.indexOf("export async function completeItem(");
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("\n}\n");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
})();

/** The retry lap, from the `for` to the end of the insert-error branch. */
const lap = body.slice(body.indexOf("for (let attempt = 0"));

describe("completeItem still claims the slot flip-first — the 0176 design is untouched", () => {
  it("supersedes before inserting, guarded on the live head", () => {
    const supersede = lap.indexOf("superseded_at: ");
    const insert = lap.indexOf('.from("checklist_completions")\n      .insert(');
    expect(supersede).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(supersede);
    expect(lap).toMatch(/\.is\("superseded_at", null\)/);
  });

  it("still re-claims and retries on 23505 rather than compensating", () => {
    // A rival winning the slot is the index working. Reverting our stamp there would ask
    // that same index for a second live head, which it refuses — the cash lesson.
    expect(lap).toMatch(/=== "23505"\) continue/);
  });
});

describe("a NON-23505 insert failure un-supersedes our own stamp before rethrowing", () => {
  it("reverts superseded_at to null", () => {
    expect(lap).toMatch(/superseded_at: null/);
  });

  it("matches on the id AND the exact stamp we wrote, not on the row alone", () => {
    // An unfiltered revert would lift a CONCURRENT writer's supersede too, handing the item
    // two live heads' worth of ambiguity. The stamp is the proof the claim was ours.
    const revert = lap.slice(lap.indexOf("superseded_at: null"));
    expect(revert).toMatch(/\.eq\("id", claimed\.id\)/);
    expect(revert).toMatch(/\.eq\("superseded_at", claimed\.stamp\)/);
  });

  it("captures the stamp as a value instead of re-deriving it at revert time", () => {
    // `new Date().toISOString()` inline in the payload cannot be matched on later; a second
    // call would produce a different instant and the revert would match zero rows.
    expect(lap).toMatch(/const claimStamp = new Date\(\)\.toISOString\(\)/);
    expect(lap).toMatch(/superseded_at: claimStamp/);
  });

  it("tracks the claim made in THIS lap, not the accumulated prior id", () => {
    // `supersededPriorId` deliberately carries across laps (`?? supersededPriorId`) so the
    // back-pointer survives a 23505 retry. Compensating with it would revert a stamp from
    // an EARLIER lap that a rival has since settled.
    // Declared `const` INSIDE the lap and derived from THIS lap's own response, so it
    // structurally cannot carry a stale claim forward.
    expect(lap).toMatch(/const claimed = superseded/);
    expect(lap).toMatch(/\.eq\("id", claimed\.id\)/);
    expect(lap).not.toMatch(/\.eq\("id", supersededPriorId\)/);
  });

  it("checks the revert's rowcount — a silent UPDATE 0 is the house's oldest trap", () => {
    const revert = lap.slice(lap.indexOf("superseded_at: null"));
    expect(revert).toMatch(/\{ count: "exact" \}/);
  });

  it("reports a failed revert loudly instead of swallowing it", () => {
    const revert = lap.slice(lap.indexOf("superseded_at: null"));
    expect(revert).toMatch(/console\.error/);
  });

  it("still rethrows — the completion genuinely did not land", () => {
    // Compensation is not recovery. The tap failed and the operator must see that; the
    // revert only ensures the PRIOR completion is not collateral damage.
    expect(lap).toMatch(/throw new Error\(`completeItem insert: \$\{insertErr\.message\}`\)/);
  });

  it("compensates BEFORE the throw, not in a finally that runs after it", () => {
    const revertIdx = lap.indexOf("superseded_at: null");
    const throwIdx = lap.indexOf("throw new Error(`completeItem insert:");
    expect(revertIdx).toBeGreaterThan(-1);
    expect(throwIdx).toBeGreaterThan(revertIdx);
  });
});

describe("the compensation follows the house idiom rather than inventing one", () => {
  it("lib/cash.ts still spells the same compare-and-set revert", () => {
    // The idiom this copies. If cash.ts's shape ever changes, this pairing is the reminder
    // that two supersede-then-insert writers should not drift apart.
    const cash = read("lib/cash.ts");
    expect(cash).toMatch(/\.update\(\{ superseded_at: null \}, \{ count: "exact" \}\)/);
    expect(cash).toMatch(/\.eq\("superseded_at", nowIso\)/);
  });

  it("adds no new audit action name — the vocabulary is closed", () => {
    // A `checklist_completion.supersede_reverted` action would be the natural signal, and
    // it is a NAMED FOLLOW-UP: lib/audit-actions.ts is owned by another open PR, and an
    // unregistered action fails the build at the call site by design.
    const actions = read("lib/audit-actions.ts");
    expect(actions).not.toMatch(/supersede_reverted/);
    expect(lap).not.toMatch(/supersede_reverted/);
  });
});
