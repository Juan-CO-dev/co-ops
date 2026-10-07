/**
 * Behaviour spine — a mid-day Phase 1 COUNT is never a Phase 2 save (lib/mid-day-shared.ts).
 *
 * Astra Phase A review P1 #2 (BC-013/034), reproduced on the branch: 0215's Phase 1 RPC derives
 * `inputs.total` for a batch item (LINE + BACK UP), and the Phase 2 page read any total as "the
 * opener prepped this" — counting 2 + 8 initialised the row as a SAVED bottling of 10 and
 * finalize could close the instance with no batch save at all. The rule is one pure function
 * the page, the form and finalize share.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { midDayFinalizeBlockers, midDayPhase2RowSeed } from "@/lib/mid-day-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

/** What 0215's Phase 1 RPC writes for a batch item counted 2 (LINE) + 8 (bulk BACK UP). */
const PHASE1_COUNT = { inputs: { onHand: 2, backUp: 8, total: 10 }, snapshot: { section: "sauces", itemName: "Hot Peppers", parValue: 4, parUnit: "qt", specialInstruction: null } };
/** What the Phase 2 RPC writes after a batch save (bottled 2 from the counted backup). */
const PHASE2_BATCH_SAVE = {
  ...PHASE1_COUNT,
  inputs: { onHand: 2, backUp: 8, total: 2 },
  batch: { batches: 0, came_out_to: 0, bottled: 2, tossed: 0, backup_before: 8, backup_after: 6, yield_at_time: 4, need_for_line: 2, min_batches: 0 },
};

describe("midDayPhase2RowSeed", () => {
  it("a batch item counted 2 + 8 shows NOTHING saved — the derived total 10 is not a bottling", () => {
    expect(midDayPhase2RowSeed(PHASE1_COUNT, true)).toEqual({ initialPrepped: null, initialBatch: null, saved: false });
  });
  it("a batch item with a Phase 2 batch save is saved, with its bottled number and batch half", () => {
    const seed = midDayPhase2RowSeed(PHASE2_BATCH_SAVE, true);
    expect(seed.saved).toBe(true);
    expect(seed.initialPrepped).toBe(2);
    expect(seed.initialBatch).toEqual({ batches: 0, cameOutTo: 0, tossed: 0, overBatchReason: null });
  });
  it("a non-batch item keeps the pre-0215 rule: inputs.total IS the Phase 2 save", () => {
    expect(midDayPhase2RowSeed({ inputs: { onHand: 3 }, snapshot: {} }, false)).toEqual({ initialPrepped: null, initialBatch: null, saved: false });
    expect(midDayPhase2RowSeed({ inputs: { onHand: 3, total: 7 }, snapshot: {} }, false)).toEqual({ initialPrepped: 7, initialBatch: null, saved: true });
  });
});

describe("IDENTITY, not eligibility (Astra r2 P1) — an UNRESOLVED batch recipe is still a batch recipe", () => {
  /**
   * A single-output batch_mode recipe with an ingredient the graph cannot convert: the context
   * loader reports batchMode true, isBatch false, eligibility blocked, blockedReason unresolved.
   * Phase 1 counted LINE 2 + BACK UP 8 (0215's Phase 1 RPC derives total only when is_batch, but
   * the stored count must never read as a save either way).
   */
  const UNRESOLVED_CTX = { batchMode: true, isBatch: false, eligibility: "blocked" as const, blockedReason: "unresolved" as const };
  it("the row keyed on batchMode is UNSAVED after the 2 + 8 count — keyed on isBatch it would have read as '10 saved'", () => {
    const seed = midDayPhase2RowSeed(PHASE1_COUNT, UNRESOLVED_CTX.batchMode);
    expect(seed).toEqual({ initialPrepped: null, initialBatch: null, saved: false });
    // The bug, pinned as the counter-example: eligibility would hide the count as production.
    expect(midDayPhase2RowSeed(PHASE1_COUNT, UNRESOLVED_CTX.isBatch).saved).toBe(true);
  });
  it("finalize is REFUSED for the unresolved batch row (keyed on batchMode) until it is explicitly saved", () => {
    const items = [{ id: "hp" }];
    const live = [{ templateItemId: "hp", completedAt: "2026-10-07T12:00:00Z", prepData: PHASE1_COUNT }];
    expect(midDayFinalizeBlockers(items, live, { hp: UNRESOLVED_CTX.batchMode })).toEqual(["hp"]);
    // ...and the eligibility key would have let it through (the counter-example).
    expect(midDayFinalizeBlockers(items, live, { hp: UNRESOLVED_CTX.isBatch })).toEqual([]);
  });
  it("every decision site keys on batchMode, never isBatch", () => {
    const page = read("app", "(authed)", "operations", "mid-day", "page.tsx");
    expect(page).toContain("midDayPhase2RowSeed(comp?.prepData, ctx?.batchMode === true)");
    expect(page).toContain("batchMode: state.batchContext[item.id]?.batchMode === true");
    expect(page).not.toMatch(/\?\.isBatch\b/);
    const lib = read("lib", "prep.ts");
    expect(lib).toContain("batchModeByItem[id] = ctx.batchMode;");
    expect(lib).toContain("if (state.batchContext[entry.templateItemId]?.batchMode === true) {");
    expect(lib).toContain("if (ctx?.batchMode) batchModeByItem[tItem.id] = true;");
    expect(read("app", "(authed)", "operations", "opening", "opening-client.tsx")).toContain("m.set(templateItemId, ctx.batchMode);");
    expect(read("lib", "mid-day-shared.ts")).not.toMatch(/isBatch/);
  });
});

describe("midDayFinalizeBlockers", () => {
  const items = [{ id: "hp" }, { id: "mayo" }];
  const isBatch = { hp: true };
  it("finalize is refused while the batch row only has its count; a single-box row never blocks", () => {
    const live = [{ templateItemId: "hp", completedAt: "2026-10-07T12:00:00Z", prepData: PHASE1_COUNT }, { templateItemId: "mayo", completedAt: "2026-10-07T12:00:00Z", prepData: { inputs: { onHand: 1 }, snapshot: {} } }];
    expect(midDayFinalizeBlockers(items, live, isBatch)).toEqual(["hp"]);
  });
  it("after the batch row is saved (the NEWEST live row carries the batch object) finalize is allowed", () => {
    const live = [
      { templateItemId: "hp", completedAt: "2026-10-07T12:00:00Z", prepData: PHASE1_COUNT },
      { templateItemId: "hp", completedAt: "2026-10-07T12:30:00Z", prepData: PHASE2_BATCH_SAVE },
    ];
    expect(midDayFinalizeBlockers(items, live, isBatch)).toEqual([]);
  });
  it("a batch item with no completion at all is also a blocker", () => {
    expect(midDayFinalizeBlockers(items, [], isBatch)).toEqual(["hp"]);
  });
});

describe("wiring", () => {
  it("the page seeds the row through midDayPhase2RowSeed and no longer reads inputs.total as prepped", () => {
    const page = read("app", "(authed)", "operations", "mid-day", "page.tsx");
    expect(page).toContain("midDayPhase2RowSeed(comp?.prepData, ctx?.batchMode === true)");
    expect(page).not.toContain("comp?.prepData?.inputs.total");
    expect(page).toContain("initialSaved: seed.saved,");
  });
  it("the form marks a row saved from initialSaved, and finalize consults the blockers before the status write", () => {
    expect(read("components", "MidDayPhase2Form.tsx")).toContain('(it.initialSaved ?? it.initialPrepped !== null) ? "saved" : "idle"');
    const lib = read("lib", "prep.ts");
    const fn = lib.slice(lib.indexOf("export async function finalizeMidDayPhase2("));
    const blockersAt = fn.indexOf("midDayFinalizeBlockers(");
    const updateAt = fn.indexOf('.update({ status: "phase2_complete"');
    expect(blockersAt).toBeGreaterThan(-1);
    expect(blockersAt).toBeLessThan(updateAt);
    expect(fn).toContain('reason: "batch_rows_unsaved", missing');
    const route = read("app", "api", "prep", "mid-day", "phase2", "finalize", "route.ts");
    expect(route).toMatch(/result\.reason === "batch_rows_unsaved"/);
    expect(route).toMatch(/jsonError\(422, "batch_rows_unsaved"/);
  });
});
