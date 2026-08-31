/**
 * Unit spine — migration 0186 (AUTHORED / NOT APPLIED): submit_am_prep_atomic must supersede
 * the live completion head before it inserts, on BOTH of its write paths.
 *
 * This is 0185's twin, and the difference is the point. 0185's Phase 1 chain-edit branch has
 * no caller and cannot fail today; ITS tripwire watches for one appearing. THIS branch is
 * fully wired and shipped — AmPrepForm's edit mode posts isUpdate:true → /api/prep/submit →
 * submitAmPrepUpdate → the RPC with p_is_update = true — so the tests below assert the caller
 * EXISTS. That is the urgency: 0176's index has been live since 2026-08-11, no am-prep edit
 * has been attempted since, and the next one raises a raw 23505 that lib/prep.ts does not map
 * (it names P0001, 23514 and foreign_key_violation only) — an opaque 500 at 6 AM.
 *
 * There is nothing to unit-test here in the ordinary sense: the artifact is SQL and it is not
 * applied. What CAN be pinned, and what actually protects the kitchen, is (a) the ORDER of the
 * statements in each of the two fixed regions — supersede, then insert, then back-point,
 * because any other order is the bug back again — and (b) the live-caller assertions, so this
 * file goes red if someone "fixes" the 500 by unwiring the edit button instead of applying the
 * migration.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const MIGRATION = read("supabase", "migrations", "0186_am_prep_chain_edit_supersede.sql");

/**
 * Structural-absence assertions must read the SQL, not the prose around it — this file's own
 * comments name the constructs they forbid (that is the point of a provenance block), and a
 * bare substring search would match the explanation instead of the code.
 */
const sqlOnly = (s: string) => s.replace(/--[^\n]*/g, "");

/** The auto-complete block on the ORIGINAL submission path. */
function autoCompleteBlock(): string {
  const at = MIGRATION.indexOf("IF p_closing_report_ref_item_id IS NOT NULL THEN");
  expect(at).toBeGreaterThan(-1);
  const end = MIGRATION.indexOf("UPDATE PATH (C.46 A6)", at);
  expect(end).toBeGreaterThan(at);
  return MIGRATION.slice(at, end);
}

/** The per-entry loop of the chain-edit branch — everything after the update-path guard. */
function chainEditBranch(): string {
  const at = MIGRATION.indexOf("p_original_submission_id required when p_is_update = true");
  expect(at).toBeGreaterThan(-1);
  return MIGRATION.slice(at, MIGRATION.indexOf("END LOOP;", at));
}

describe("0186 flips before it inserts — chain-edit path", () => {
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
    // no-op there and the 23505 would come straight back. The edit cap is 3 and prod
    // already holds am_prep chains at max edit_count 3, so edits 2-3 are reachable.
    expect(flip).toContain("instance_id = p_prep_instance_id");
    expect(flip).toContain("template_item_id = (v_entry->>'templateItemId')::uuid");
    expect(flip).toContain("superseded_at IS NULL");
    expect(flip).toContain("revoked_at IS NULL");
    expect(sqlOnly(flip)).not.toContain("v_original_completion_id");
  });

  it("keeps the C.44 alignment guard and the chain link on the ORIGINAL completion", () => {
    const branch = chainEditBranch();

    // The alignment guard reads the chain head's completion_ids — that read is what
    // original_completion_id MEANS, and the flip above must not be confused with it.
    expect(branch).toContain("cc.id = ANY(v_chain_head_row.completion_ids)");
    expect(branch).toContain("not found in chain head submission");
    // The new row still links to the chain head's completion, not to the row just flipped.
    expect(branch).toContain("v_original_completion_id,\n        v_new_edit_count");
  });

  it("honours C.46 A6/A4 — no status change and no closing-side write on the edit path", () => {
    const branch = sqlOnly(chainEditBranch());
    expect(branch).not.toContain("UPDATE checklist_instances");
    expect(branch).not.toContain("auto_complete_meta");
  });
});

describe("0186 flips before it inserts — auto-complete path", () => {
  it("resolves the closing instance, supersedes, then inserts, then back-points", () => {
    const block = autoCompleteBlock();
    const resolve = block.indexOf("INTO v_closing_instance_id");
    const supersede = block.indexOf("SET superseded_at = v_submitted_at");
    const insert = block.indexOf("INSERT INTO checklist_completions (");
    const backPointer = block.indexOf("SET superseded_by = v_auto_complete_id");

    expect(resolve).toBeGreaterThan(-1);
    // You cannot supersede a key before you know which instance it is on — which is why
    // 0044 could not flip first without this lookup being landed into a variable.
    expect(resolve).toBeLessThan(supersede);
    expect(supersede).toBeLessThan(insert);
    expect(backPointer).toBeGreaterThan(insert);
  });

  it("flips the live head on exactly the key the INSERT will occupy", () => {
    const block = autoCompleteBlock();
    const flip = block.slice(
      block.indexOf("UPDATE checklist_completions"),
      block.indexOf("RETURNING id INTO v_superseded_completion_id;"),
    );

    expect(flip).toContain("instance_id = v_closing_instance_id");
    expect(flip).toContain("template_item_id = p_closing_report_ref_item_id");
    expect(flip).toContain("superseded_at IS NULL");
    expect(flip).toContain("revoked_at IS NULL");
  });

  it("drops the dead prior_live CTE and the post-insert self-exclusion it needed", () => {
    const block = sqlOnly(autoCompleteBlock());

    // 0044 declared prior_live and never referenced it — an unreferenced CTE in a
    // data-modifying statement never executes. It reads like a flip-first that was
    // drafted and never wired; the block above is what it was reaching for.
    expect(block).not.toContain("prior_live");
    // `cc.id <> v_auto_complete_id` only existed because the collapse ran AFTER the
    // insert and had to exclude the row it had just written. Flipping first removes it.
    expect(block).not.toContain("cc.id <> v_auto_complete_id");
  });

  it("preserves the no-closing-instance refusal verbatim, message and errcode", () => {
    const block = autoCompleteBlock();

    // 0044 detected this by INSERT ... SELECT inserting zero rows and leaving
    // v_auto_complete_id NULL. The explicit check must raise the SAME thing.
    expect(block).toContain(
      "no closing instance found for prep instance % to auto-complete report-ref item %",
    );
    expect(block).toContain("USING ERRCODE = 'foreign_key_violation'");
  });
});

describe("0186 is authored, gated, and honest about it", () => {
  it("carries the house NOT-APPLIED gate header", () => {
    expect(MIGRATION).toContain("NOT YET APPLIED — GATE (LEAD/JUAN)");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.submit_am_prep_atomic(");
  });

  it("re-asserts the definer grant posture rather than silently widening it", () => {
    // CREATE OR REPLACE keeps the existing ACL, but a fresh environment runs this file
    // alone — and 0132 shipped as a CRITICAL hotfix (WB3-01) precisely because this
    // function had retained the PUBLIC grant. REVOKE FROM PUBLIC alone is not enough.
    expect(MIGRATION).toContain(") FROM PUBLIC;");
    expect(MIGRATION).toContain(") FROM anon;");
    expect(MIGRATION).toContain(") FROM authenticated;");
    expect(MIGRATION).toContain(") TO service_role;");
  });

  it("preserves the 0044 audit-emission shape — ip/ua inside metadata, never columns", () => {
    const auditInsert = MIGRATION.slice(
      MIGRATION.indexOf("INSERT INTO audit_log ("),
      MIGRATION.indexOf("-- 6. Per A6"),
    );
    expect(auditInsert).toContain("'ip_address', p_ip_address");
    expect(auditInsert).toContain("'user_agent', p_user_agent");
    // 0043's bug was these as top-level INSERT columns → sqlstate 42703 on every edit.
    expect(auditInsert).not.toMatch(/^\s+ip_address,$/m);
    expect(auditInsert).not.toMatch(/^\s+user_agent,$/m);
  });
});

describe("live-path tripwire — the am-prep chain edit HAS a caller, and it is unguarded", () => {
  it("AmPrepForm's edit mode posts isUpdate:true", () => {
    const form = read("components", "prep", "AmPrepForm.tsx");
    const submit = form.slice(
      form.indexOf("const requestBody ="),
      form.indexOf('fetch("/api/prep/submit"'),
    );

    // If this goes red, the edit affordance moved or was removed. Removing it is NOT the
    // fix for the 23505 — applying 0186 is.
    expect(submit).toContain('mode === "edit"');
    expect(submit).toContain("isUpdate: true");
    expect(submit).toContain("originalSubmissionId,");
  });

  it("the route forwards isUpdate + originalSubmissionId to the lib", () => {
    const route = read("app", "api", "prep", "submit", "route.ts");
    expect(route).toContain("isUpdate?: boolean;");
    expect(route).toContain("originalSubmissionId?: string;");
  });

  it("submitAmPrepUpdate calls the RPC with p_is_update and supersedes NOTHING itself", () => {
    const prep = read("lib", "prep.ts");
    const fn = prep.slice(prep.indexOf("async function submitAmPrepUpdate("));
    expect(fn.length).toBeGreaterThan(0);

    expect(fn).toContain("p_is_update: true");
    // Per A4 the edit path must not touch the closing auto-complete row.
    expect(fn).toContain("p_closing_report_ref_item_id: null");
    // THE DEFECT, pinned: there is no JS-side flip anywhere on this path, so the RPC is
    // the only place the one-live-head rule can be honoured. If a JS-side supersede ever
    // appears here, that is a SECOND opinion about the index slot and this test should be
    // re-adjudicated, not deleted.
    expect(fn).not.toContain("superseded_at");
    expect(fn).not.toContain("superseded_by");
  });

  it("a 23505 from that RPC is unmapped — which is why the failure is opaque", () => {
    const prep = read("lib", "prep.ts");
    const fn = prep.slice(prep.indexOf("async function submitAmPrepUpdate("));
    const errorMapping = fn.slice(fn.indexOf("if (rpcErr) {"), fn.indexOf("if (!rpcData) {"));

    expect(errorMapping).toContain('rpcErr.code === "P0001"');
    expect(errorMapping).toContain('rpcErr.code === "23514"');
    // No unique_violation branch: the throw falls to the generic Error → a 500 reading
    // "Submission failed", with the whole prep transaction rolled back.
    expect(errorMapping).not.toContain("23505");
    expect(errorMapping).toContain("update RPC failed");
  });
});
