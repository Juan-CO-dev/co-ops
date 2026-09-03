/**
 * Unit spine — `deriveAndUpsertCredits`' READ-THEN-INSERT (audit v2, seat C5, finding F10).
 *
 * SIM-6 moved credit idempotency app-side for a good reason: `vendor_credits_line_reason_uq`
 * (0168) is a PARTIAL unique index, Postgres refuses a partial index as a bare
 * `ON CONFLICT (cols)` arbiter, and supabase-js cannot emit the index predicate — so the
 * upsert 500'd on EVERY lined-discrepancy credit while the delivery itself saved.
 *
 * What replaced it is a check-then-act: read the existing (delivery_item_id, reason) pairs,
 * insert only the missing drafts. THE PARTIAL INDEX IS STILL ENFORCED. Two derives against
 * ONE delivery — reachable through `addDeliveryLines`, which appends to an in-progress
 * delivery and then re-derives credits for the WHOLE delivery — both compute the same
 * drafts, both see an empty `have`, and the loser trips 23505 into the exact
 * `credit_write_failed` 500 the SIM-6 fix was written to remove. Its own lines already
 * committed, so the operator is told the credit failed on a delivery that saved.
 *
 * A 23505 here means the row IS THERE — which is precisely the state the pre-read was
 * looking for. It is a benign no-op, not a failure.
 *
 * Mitigating and stated: `addDeliveryLines` has no UI driver yet, so this is cold today.
 * The recordDelivery path is separately NOT self-healing — a credit-write 500 leaves the
 * delivery and lines durable and a retry hits `vendor_deliveries_dedupe_uq` → 409
 * `duplicate_delivery`, so the credits are never re-derived. That is a named follow-up.
 *
 * WHY SOURCE ASSERTION: `deriveAndUpsertCredits` is a module-private function that takes
 * its client as a positional argument from callers that build it with
 * `getServiceRoleClient()`; it is not exported and the spine has no Supabase env. The
 * guarantee is a branch and a comment, both asserted where they live.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const src = read("lib/receiving.ts");
const derive = (() => {
  const start = src.indexOf("async function deriveAndUpsertCredits(");
  expect(start).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("\n}\n");
  expect(end).toBeGreaterThan(-1);
  return rest.slice(0, end);
})();

describe("the app-side pre-read stays — SIM-6's fix is not being undone", () => {
  it("still reads the existing (line, reason) pairs and inserts only the missing drafts", () => {
    expect(derive).toMatch(/const have = new Set\(/);
    expect(derive).toMatch(/const toInsert = drafts\.filter\(/);
  });

  it("still refuses to emit an ON CONFLICT the partial index cannot arbitrate", () => {
    expect(derive).not.toMatch(/\.upsert\(/);
    expect(derive).not.toMatch(/onConflict/);
  });
});

describe("23505 on the credit insert is a benign no-op, not a 500", () => {
  it("names the code", () => {
    // The row the pre-read was looking for exists. Raising credit_write_failed for it
    // re-raises the exact error SIM-6 removed, on a delivery whose lines already saved.
    expect(derive).toMatch(/"23505"/);
  });

  it("returns instead of throwing on that code", () => {
    const branch = derive.slice(derive.indexOf('"23505"'));
    expect(branch.slice(0, branch.indexOf("\n", branch.indexOf("return")) + 1)).toMatch(/return/);
  });

  it("still throws credit_write_failed for every OTHER error", () => {
    // A genuine write failure must stay a genuine failure — a vendor debt silently lost is
    // what the whole SIM-6 arc is about.
    expect(derive).toMatch(/ReceivingError\(500, "credit_write_failed"/);
  });

  it("the tolerance is BEHIND the 23505 check, not a blanket swallow", () => {
    const idx = derive.indexOf('"23505"');
    const thr = derive.lastIndexOf('ReceivingError(500, "credit_write_failed"');
    expect(idx).toBeGreaterThan(-1);
    expect(thr).toBeGreaterThan(idx);
  });
});

describe("addDeliveryLines' docstring stops describing a mechanism that was removed", () => {
  it("no longer claims prior lines' credits ignoreDuplicate on the unique index", () => {
    // Comment rot on the exact mechanism the finding is about: the upsert (and its
    // ignoreDuplicates) has been gone since SIM-6.
    expect(src).not.toMatch(/ignoreDuplicate/);
  });

  it("says what actually makes the re-derive safe", () => {
    const doc = src.slice(0, src.indexOf("export async function addDeliveryLines("));
    const block = doc.slice(doc.lastIndexOf("/**"));
    expect(block).toMatch(/pre-read|23505/);
  });
});
