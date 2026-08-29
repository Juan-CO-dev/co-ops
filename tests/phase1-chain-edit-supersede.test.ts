/**
 * Unit spine — migration 0185 (AUTHORED / NOT APPLIED): submit_phase1_atomic's chain-edit
 * branch must supersede the live completion head before it inserts.
 *
 * 0176 made "one live head per (instance_id, template_item_id)" a DB fact — a partial unique
 * index, verified present on prod 2026-08-29 — and every completion writer flips first:
 * completeItem (lib/checklists.ts), save_phase2_item_atomic (0056), autoCompleteClosingMidDayRef
 * (lib/prep.ts). submit_phase1_atomic (0055) never learned the rule; its p_is_update branch
 * bare-INSERTS a second live row for the same key, which is a raw 23505 mapOpeningError cannot
 * name — an opaque 500 on the first chain edit anyone ever performs.
 *
 * There is nothing to unit-test here in the ordinary sense: the artifact is SQL, it is not
 * applied, and the branch has no caller. What CAN be pinned, and what actually protects the
 * kitchen, is (a) the ORDER of the two statements inside the authored file — supersede, then
 * insert, then back-point, because any other order is the bug back again — and (b) the
 * tripwire: Phase 1's route still never asks for a chain edit, so the day someone wires that
 * UI, this file goes red and says the gate has to be cleared first.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const MIGRATION = read("supabase", "migrations", "0185_phase1_chain_edit_supersede.sql");

/** The chain-edit branch of the authored function — everything after the update-path guard. */
function chainEditBranch(): string {
  const at = MIGRATION.indexOf("p_original_submission_id required when p_is_update = true");
  expect(at).toBeGreaterThan(-1);
  return MIGRATION.slice(at, MIGRATION.indexOf("END LOOP;", at));
}

describe("0185 flips before it inserts", () => {
  it("supersedes the live head, then inserts, then writes the back-pointer", () => {
    const branch = chainEditBranch();
    const supersede = branch.indexOf("SET superseded_at = v_submitted_at");
    const insert = branch.indexOf("INSERT INTO checklist_completions (");
    const backPointer = branch.indexOf("SET superseded_by = v_completion_id");

    expect(supersede).toBeGreaterThan(-1);
    // The order IS the fix. Insert-then-supersede is what 0176's deploy note calls out as
    // the hazard, and it 23505s against the live index before the supersede ever runs.
    expect(supersede).toBeLessThan(insert);
    expect(backPointer).toBeGreaterThan(insert);
  });

  it("targets the LIVE head by key, not the chain-head completion id", () => {
    const branch = chainEditBranch();
    const flip = branch.slice(
      branch.indexOf("UPDATE checklist_completions"),
      branch.indexOf("RETURNING id INTO v_superseded_completion_id;"),
    );

    // On the SECOND edit the chain head is already superseded; the row holding the index
    // slot is the first edit's. Keying the flip on v_original_completion_id would be a
    // no-op there and the 23505 would come straight back.
    expect(flip).toContain("instance_id = p_opening_instance_id");
    expect(flip).toContain("template_item_id = v_template_item_id");
    expect(flip).toContain("superseded_at IS NULL");
    expect(flip).toContain("revoked_at IS NULL");
    expect(flip).not.toContain("v_original_completion_id");
  });

  it("leaves the C.54 §9 preservation gate intact — provenance still comes from the original", () => {
    const branch = chainEditBranch();

    // §9 (a): the new row's provenance is READ from the chain head, never recomputed.
    expect(branch).toContain("v_original_count_provenance,  -- ← §9 PRESERVATION POINT (a)");
    // §9 (b)+(c): structural absence. A supersede is not a notification write, and the
    // branch must still contain no notifications statement of any kind.
    expect(branch).not.toContain("INSERT INTO notifications");
    expect(branch).not.toContain("UPDATE notifications");
    expect(branch).not.toContain("DELETE FROM notifications");
  });
});

describe("0185 is authored, gated, and honest about it", () => {
  it("carries the house NOT-APPLIED gate header", () => {
    expect(MIGRATION).toContain("NOT YET APPLIED — GATE (LEAD/JUAN)");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.submit_phase1_atomic(");
  });

  it("re-asserts the definer grant posture rather than silently widening it", () => {
    // CREATE OR REPLACE keeps the existing ACL, but a fresh environment runs this file
    // alone — and AGENTS.md is explicit that REVOKE FROM PUBLIC does not strip Supabase's
    // explicit anon/authenticated grants.
    expect(MIGRATION).toContain(") FROM anon;");
    expect(MIGRATION).toContain(") FROM authenticated;");
    expect(MIGRATION).toContain(") TO service_role;");
  });
});

describe("tripwire — the Phase 1 chain edit still has no caller", () => {
  it("the phase1 submit route does not request an update, so the branch stays unreachable", () => {
    const route = read("app", "api", "opening", "submit", "phase1", "route.ts");
    const call = route.slice(
      route.indexOf("await submitPhase1Atomic(service, {"),
      route.indexOf("});", route.indexOf("await submitPhase1Atomic(service, {")),
    );

    // If this goes red, someone is building the Phase 1 chain-edit UI. That is the moment
    // migration 0185 must be gated and APPLIED — the branch it wires up 23505s without it.
    expect(call).not.toContain("isUpdate");
    expect(call).not.toContain("originalSubmissionId");
  });
});
