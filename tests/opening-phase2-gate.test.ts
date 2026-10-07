/**
 * Behaviour spine — the opening Phase 2 save gate (lib/opening-phase2-gate.ts).
 *
 * Astra Phase A review P1 #1 (BC-013/042), reproduced on the branch: LINE 2, BACK UP 8, par 4,
 * bottled 2 → the dispatcher demanded an over-prep reason because it measured bottled against
 * Phase 1's TOTAL-based prep_need (par 4 − total 10 → 0), while the row showed the LINE need
 * (par 4 − LINE 2 = 2) and offered no reason button. The gate is now one pure function shared
 * by the dispatcher and this test: a batch row measures BOTTLED against the LINE need and never
 * asks an over-prep question (bottling more from the backup asks nothing — addendum 2); under-
 * prep capture is kept; single-box rows keep today's gates exactly.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { phase2SaveGate, type Phase2GateContext } from "@/lib/opening-phase2-gate";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
import type { BatchRowContext } from "@/lib/batch-prep-shared";

/** The reproduced scenario: LINE 2, BACK UP 8, par 4 → need_for_line 2; yield 4/batch. */
const HOT_PEPPERS: BatchRowContext = {
  recipeName: "Hot Peppers",
  yieldPerBatch: 4,
  shelfLifeDays: 5,
  backupBefore: 8,
  lineCount: 2,
  need: 2,
  parUnit: "qt",
  madeOn: null,
  blocked: false,
  blockedReason: null,
};

/** Phase 1 persisted the TOTAL-based numbers: ground truth 10 (2 + 8), prep_need 0. */
const CTX: Phase2GateContext = {
  sectionVerified: true,
  closerCount: 10,
  parValue: 4,
  resolved: { groundTruth: 10, prepNeed: 0 },
  batch: HOT_PEPPERS,
};

const noBatch = { batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null };

describe("batch row — BOTTLED vs the LINE need (Astra P1 #1)", () => {
  it("LINE 2, BACK UP 8, par 4, bottled 2 saves with NO reason", () => {
    const out = phase2SaveGate({ openerPrepped: 2, openerRecount: null, overPar: null, underPar: null, batch: noBatch }, CTX);
    expect(out).toEqual({ kind: "ok", batchEntry: { batches: 0, cameOutTo: null, tossed: 0, overBatchReason: null } });
  });
  it("bottling MORE than the line need from the backup (3 of 8) asks nothing either", () => {
    const out = phase2SaveGate({ openerPrepped: 3, openerRecount: null, overPar: null, underPar: null, batch: noBatch }, CTX);
    expect(out.kind).toBe("ok");
  });
  it("bottling LESS than the line need keeps the under-prep reason", () => {
    const out = phase2SaveGate({ openerPrepped: 1, openerRecount: null, overPar: null, underPar: null, batch: noBatch }, CTX);
    expect(out).toEqual({ kind: "incomplete", reason: "needs_reason" });
    const withReason = phase2SaveGate({ openerPrepped: 1, openerRecount: null, overPar: null, underPar: { freeText: "ran out of peppers" }, batch: noBatch }, CTX);
    expect(withReason.kind).toBe("ok");
  });
  it("an extra batch above today's minimum still needs its one-tap reason; a blocked or unknown-backup row is needs_batch", () => {
    const extra = phase2SaveGate({ openerPrepped: 2, openerRecount: null, overPar: null, underPar: null, batch: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null } }, CTX);
    expect(extra).toEqual({ kind: "incomplete", reason: "needs_reason" });
    const unknown = phase2SaveGate({ openerPrepped: 2, openerRecount: null, overPar: null, underPar: null, batch: noBatch }, { ...CTX, batch: { ...HOT_PEPPERS, backupBefore: null } });
    expect(unknown).toEqual({ kind: "incomplete", reason: "needs_batch" });
    const blocked = phase2SaveGate({ openerPrepped: 2, openerRecount: null, overPar: null, underPar: null, batch: noBatch }, { ...CTX, batch: { ...HOT_PEPPERS, blocked: true, blockedReason: "unresolved" } });
    expect(blocked).toEqual({ kind: "incomplete", reason: "needs_batch" });
  });
  it("a blank row is blank; a row without ground truth needs it first", () => {
    expect(phase2SaveGate({ openerPrepped: null, openerRecount: null, overPar: null, underPar: null, batch: noBatch }, CTX)).toEqual({ kind: "blank" });
    expect(phase2SaveGate({ openerPrepped: 2, openerRecount: null, overPar: null, underPar: null, batch: noBatch }, { ...CTX, resolved: null, sectionVerified: false, closerCount: null }))
      .toEqual({ kind: "incomplete", reason: "needs_ground_truth" });
  });
});

describe("single-box row — today's gates, unchanged", () => {
  const single: Phase2GateContext = { sectionVerified: true, closerCount: 3, parValue: 10, resolved: { groundTruth: 3, prepNeed: 7 }, batch: null };
  it("over the prep need without an over reason is needs_reason; with one it saves", () => {
    expect(phase2SaveGate({ openerPrepped: 9, openerRecount: null, overPar: null, underPar: null, batch: null }, single)).toEqual({ kind: "incomplete", reason: "needs_reason" });
    expect(phase2SaveGate({ openerPrepped: 9, openerRecount: null, overPar: { reasonCategory: "forecast_busy" }, underPar: null, batch: null }, single)).toEqual({ kind: "ok", batchEntry: null });
  });
  it("under needs its reason with text; at par saves; a par-null item saves any amount", () => {
    expect(phase2SaveGate({ openerPrepped: 5, openerRecount: null, overPar: null, underPar: null, batch: null }, single)).toEqual({ kind: "incomplete", reason: "needs_reason" });
    expect(phase2SaveGate({ openerPrepped: 5, openerRecount: null, overPar: null, underPar: { freeText: "  " }, batch: null }, single)).toEqual({ kind: "incomplete", reason: "needs_reason" });
    expect(phase2SaveGate({ openerPrepped: 7, openerRecount: null, overPar: null, underPar: null, batch: null }, single)).toEqual({ kind: "ok", batchEntry: null });
    expect(phase2SaveGate({ openerPrepped: 99, openerRecount: null, overPar: null, underPar: null, batch: null }, { ...single, parValue: null, resolved: { groundTruth: 3, prepNeed: null } })).toEqual({ kind: "ok", batchEntry: null });
  });
  it("the dispatcher calls the shared gate and no longer inlines the total-based over gate", () => {
    const src = readFileSync(join(ROOT, "app", "(authed)", "operations", "opening", "opening-client.tsx"), "utf8");
    expect(src).toContain("phase2SaveGate(");
    expect(src).not.toContain("const prepNeed = resolved?.prepNeed ?? Math.max(0, parValue - groundTruth);");
  });
});
