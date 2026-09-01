/**
 * Unit spine — THE PO LIFECYCLE'S TWO INTEGRITY HOLES (audit v2, seat C5, findings F1 + F2).
 *
 *   F1 · `updateDraftLines` is a SELECT-then-INSERT create-if-absent on `po_lines` with no
 *        unique index behind it (BC-037). Two PATCHes for the same new SKU — a Save
 *        double-tap, a retry, two managers on one draft — both read `existing`, both classify
 *        the SKU as new, and both INSERT. `confirmPO` then snapshots `po_lines` verbatim, so
 *        the frozen order carries the SKU TWICE AT FULL QTY: the vendor email renders both and
 *        po-match's ORDERED leg double-counts it. Nothing complains, because the later
 *        `.eq("po_id").eq("sku_id")` UPDATE matches 2 rows and `count` is 2.
 *
 *   F2 · `confirmPO` flipped `draft → confirmed` FIRST and wrote the snapshot ~8 statements
 *        later (BC-036). Anything throwing in between — the line load, the batched reads, the
 *        PAGED price scan, the snapshot UPDATE itself, a serverless timeout — left a
 *        `confirmed` PO with `confirmed_snapshot = NULL` and NO repair path (re-confirming
 *        409s `not_draft`). `sendOrderEmail` had no empty-lines guard, so that PO could be
 *        flipped to `placed` and a blank order transmitted to the vendor.
 *
 * WHAT IS TESTABLE HERE, AND WHY THE REST IS ASSERTED AT THE SOURCE. `updateDraftLines` and
 * `confirmPO` both reach for `getServiceRoleClient()` internally rather than taking a client
 * as a parameter, so the cash-supersede tape technique does not apply — there is no seam.
 * The DECISION inside F1 (which submitted lines are updates and which are inserts) is pure and
 * is extracted and exercised directly; F2 is entirely an ORDERING guarantee, and an ordering
 * guarantee is an ABSENCE — "no write to purchase_orders.status happens before the snapshot
 * exists" — which no test over the module's exports can observe. Source assertion is the house
 * technique for exactly that shape (tests/admin-sku-write-contracts.test.ts, tests/dynamic-
 * pars-walker.test.ts, tests/loader-scale-ceilings.test.ts).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { partitionDraftLines, type DraftLineEdit } from "@/lib/purchase-orders";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const HAM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROLL = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TURKEY = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const line = (skuId: string, orderQty: number): DraftLineEdit => ({ skuId, orderQty });

// ─────────────────────────────────────────────────────────────────────────────
// F1 · the partition decision, extracted
// ─────────────────────────────────────────────────────────────────────────────

describe("partitionDraftLines — which submitted lines are UPDATEs and which are INSERTs", () => {
  it("routes a SKU the PO already carries to the UPDATE leg", () => {
    const { toUpdate, toInsert } = partitionDraftLines([line(HAM, 3)], new Set([HAM]));
    expect(toUpdate).toEqual([line(HAM, 3)]);
    expect(toInsert).toEqual([]);
  });

  it("routes a genuinely-new SKU to the INSERT leg", () => {
    const { toUpdate, toInsert } = partitionDraftLines([line(ROLL, 2)], new Set([HAM]));
    expect(toUpdate).toEqual([]);
    expect(toInsert).toEqual([line(ROLL, 2)]);
  });

  it("splits a mixed submit, preserving the caller's order within each leg", () => {
    const lines = [line(ROLL, 2), line(HAM, 3), line(TURKEY, 1)];
    const { toUpdate, toInsert } = partitionDraftLines(lines, new Set([HAM]));
    expect(toUpdate).toEqual([line(HAM, 3)]);
    expect(toInsert).toEqual([line(ROLL, 2), line(TURKEY, 1)]);
  });

  it("THE FINDING'S CASE: re-partitioning against a set the loser re-read moves the SKU to UPDATE", () => {
    // Both tabs read an empty `existing` and classified ROLL as new. The unique index (0190)
    // lets exactly one INSERT land; the loser sees 23505, RE-READS, and asks this function
    // again with the winner's row now in the set. The same submit must now be an UPDATE —
    // which is what turns a duplicated line into a last-writer-wins qty edit.
    const lines = [line(ROLL, 2)];
    expect(partitionDraftLines(lines, new Set<string>()).toInsert).toEqual(lines);
    expect(partitionDraftLines(lines, new Set([ROLL]))).toEqual({ toUpdate: lines, toInsert: [] });
  });

  it("a qty-0 removal is an ordinary line on whichever leg it belongs to", () => {
    // Append-only: removing a line is qty 0, never a DELETE. The partition must not treat
    // 0 specially or a removal of a not-yet-existing line would vanish instead of landing.
    expect(partitionDraftLines([line(HAM, 0)], new Set([HAM])).toUpdate).toEqual([line(HAM, 0)]);
    expect(partitionDraftLines([line(HAM, 0)], new Set<string>()).toInsert).toEqual([line(HAM, 0)]);
  });

  it("an empty submit partitions to two empty legs rather than throwing", () => {
    expect(partitionDraftLines([], new Set([HAM]))).toEqual({ toUpdate: [], toInsert: [] });
  });

  it("ignores SKUs the PO carries that this submit does not mention", () => {
    // A partial submit must not resurrect or touch lines outside it.
    const { toUpdate, toInsert } = partitionDraftLines([line(HAM, 3)], new Set([HAM, ROLL, TURKEY]));
    expect(toUpdate).toEqual([line(HAM, 3)]);
    expect(toInsert).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F1 · the write shape — the index is the arbiter, and 23505 is a re-partition
// ─────────────────────────────────────────────────────────────────────────────

const poSrc = read("lib/purchase-orders.ts");
/** The body of one exported function, from its signature to the first column-0 `}`. */
function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  const rest = src.slice(start);
  const end = rest.indexOf("\n}\n");
  expect(end, `${signature} body not closed`).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

describe("updateDraftLines treats 23505 on the line INSERT as already-present", () => {
  const body = bodyOf(poSrc, "export async function updateDraftLines(");

  it("names the code and does not re-throw it as a 500", () => {
    // Without this branch the loser of a double-tap gets `updateDraftLines insert: duplicate
    // key…` as a bare Error → an unhandled 500, which is a WORSE outcome than today's silent
    // duplicate: the manager retries and the order is still wrong.
    expect(body).toMatch(/"23505"/);
  });

  it("re-reads the existing SKU set instead of trusting the pre-read", () => {
    // The pre-read is exactly what was stale. Re-partitioning against a FRESH read is the
    // only thing that can see the winner's row and route our submit to the UPDATE leg.
    expect(body).toMatch(/partitionDraftLines\(/);
    const partitions = body.match(/partitionDraftLines\(/g) ?? [];
    expect(partitions.length).toBe(1); // one call site, inside the lap — not one per leg
    expect(body).toMatch(/for \(let lap = 0/);
  });

  it("bounds the retry rather than spinning", () => {
    expect(body).toMatch(/DRAFT_LINE_LAPS/);
  });

  it("refuses with a named 409 when the laps are exhausted, never a silent success", () => {
    expect(body).toMatch(/"lines_contended"/);
  });

  it("still keeps the rowcount check on the UPDATE leg (the silent-UPDATE law)", () => {
    expect(body).toMatch(/\{ count: "exact" \}/);
    expect(body).toMatch(/count === 0/);
  });

  it("still has NO delete path — append-only is untouched by the fix", () => {
    expect(body).not.toMatch(/\.delete\(/);
  });
});

describe("migration 0190 puts the index behind the create-if-absent", () => {
  const sql = () => read("supabase/migrations/0190_po_lines_po_sku_unique.sql");

  it("creates the unique index the 23505 branch depends on", () => {
    expect(sql()).toMatch(/CREATE UNIQUE INDEX[\s\S]*po_lines_po_sku_uq[\s\S]*po_lines[\s\S]*\(po_id, sku_id\)/i);
  });

  it("is authored-not-applied, per the house gate header", () => {
    expect(sql()).toMatch(/NOT YET APPLIED — GATE \(LEAD\/JUAN\)/);
  });

  it("records the live duplicate count, and tells the gate to re-run the check", () => {
    // The index build FAILS on a non-conforming table, so "0 duplicates today" is the
    // whole precondition — and it is a fact with a DATE on it, not a permanent one.
    expect(sql()).toMatch(/0 duplicate/i);
    expect(sql()).toMatch(/RE-RUN THAT QUERY AT THE GATE/);
  });
});
