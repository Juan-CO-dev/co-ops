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

import { phase2BlankOutcome, phase2RevokeSettle, phase2SaveGate, phase2SaveSettle, type Phase2GateContext } from "@/lib/opening-phase2-gate";

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

/**
 * Audit W14 / B180 (owner decision W14-2 b: deleting a saved amount is an Undo). Clearing an
 * amount that was already saved used to be a silent no-op: the box read empty, the row still
 * read Saved, the finalize counter still counted it, and finalize submitted the old number.
 */
describe("phase2BlankOutcome — clearing a saved amount is an Undo (B180)", () => {
  const row = (over: Partial<Parameters<typeof phase2BlankOutcome>[0] & object>) =>
    ({ status: "unsaved" as const, completionId: null, incompleteReason: null, ...over });
  it("clearing an untouched row is ignored", () => {
    expect(phase2BlankOutcome(undefined)).toBe("ignore");
    expect(phase2BlankOutcome(row({}))).toBe("ignore");
    expect(phase2BlankOutcome(row({ status: "incomplete", incompleteReason: "needs_reason" }))).toBe("ignore");
    expect(phase2BlankOutcome(row({ status: "failed" }))).toBe("ignore");
  });
  it("clearing a saved row undoes it", () => {
    expect(phase2BlankOutcome(row({ status: "saved", completionId: "c1" }))).toBe("undo");
  });
  it("a row with a live saved entry behind a failed or blocked re-save is undone too", () => {
    expect(phase2BlankOutcome(row({ status: "failed", completionId: "c1" }))).toBe("undo");
    expect(phase2BlankOutcome(row({ status: "incomplete", incompleteReason: "needs_reason", completionId: "c1" }))).toBe("undo");
  });
  it("a row already waiting on its Undo is not undone a second time on the next blur", () => {
    expect(phase2BlankOutcome(row({ status: "incomplete", incompleteReason: "cleared_saved", completionId: "c1" }))).toBe("ignore");
  });
  it("a save in flight: the clear is queued behind it (fix round 1), never an Undo of the entry being replaced", () => {
    expect(phase2BlankOutcome(row({ status: "saving", completionId: "c1" }))).toBe("after_save");
    expect(phase2BlankOutcome(row({ status: "saving", completionId: null }))).toBe("after_save");
  });
  it("saved but the row id is unknown: the row stops counting as done, nothing to undo by id", () => {
    expect(phase2BlankOutcome(row({ status: "saved", completionId: null }))).toBe("mark_cleared");
  });

  it("the dispatcher and the row both read the one rule; the cleared row offers Undo", () => {
    const page = readFileSync(join(ROOT, "app", "(authed)", "operations", "opening", "opening-client.tsx"), "utf8");
    const blank = page.slice(page.indexOf('if (gate.kind === "blank")'), page.indexOf('if (gate.kind === "incomplete")'));
    expect(blank).toContain("phase2BlankOutcome(");
    expect(blank).toContain('markIncomplete("cleared_saved")');
    const entry = readFileSync(join(ROOT, "components", "opening", "OpeningPrepEntry.tsx"), "utf8");
    // The row fires the ordinary revoke (server decides silent vs reason) on an "undo" outcome.
    expect(entry).toMatch(/phase2BlankOutcome\([^)]*\) === "undo"\) void handleRevokeClick\(item\.id\)/);
    // One reason vocabulary: the component imports the lib's type instead of redeclaring it.
    expect(entry).not.toMatch(/export type Phase2IncompleteReason =\s*"needs_ground_truth"/);
    expect(entry).toContain('saveState.incompleteReason === "cleared_saved"');
    expect(entry).toContain('t("opening.phase2.save.incomplete_cleared")');
    const cleared = entry.slice(entry.indexOf('saveState.incompleteReason === "cleared_saved"'));
    expect(cleared.slice(0, 1600)).toContain("<TwoTapUndoButton");
  });

  it("the cleared message exists in en and es", () => {
    const en = JSON.parse(readFileSync(join(ROOT, "lib", "i18n", "en.json"), "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync(join(ROOT, "lib", "i18n", "es.json"), "utf8")) as Record<string, string>;
    expect(en["opening.phase2.save.incomplete_cleared"]).toBeTruthy();
    expect(es["opening.phase2.save.incomplete_cleared"]).toBeTruthy();
    expect(es["opening.phase2.save.incomplete_cleared"]).not.toBe(en["opening.phase2.save.incomplete_cleared"]);
  });
});

/**
 * Fix round 1 (Astra W14-r1, P2). The amount box stays enabled while a save is in flight; a
 * clear committed then used to be ignored, and the save's late answer marked the row Saved
 * behind an empty box. The clear is queued behind the save and judged at its answer.
 * The whole sequence against the real page: tests/opening-phase2-clear-during-save.test.ts.
 */
describe("phase2SaveSettle — a save's answer after the amount was cleared in flight (B180, fix round 1)", () => {
  const saving = { status: "saving" as const, completionId: "c1", incompleteReason: null };
  const base = { answer: "saved" as const, clearedSince: true, preppedNow: null, otherSaveInFlight: false, row: saving, completionOnFile: "c2" };
  it("nothing was cleared since the save left: the row takes the answer as before", () => {
    expect(phase2SaveSettle({ ...base, clearedSince: false })).toBe("as_answered");
    expect(phase2SaveSettle({ ...base, clearedSince: false, answer: "failed" })).toBe("as_answered");
  });
  it("cleared, then an amount typed again: the newest word is an amount, the answer stands", () => {
    expect(phase2SaveSettle({ ...base, preppedNow: 7 })).toBe("as_answered");
  });
  it("cleared and still blank: the entry the save just wrote is undone", () => {
    expect(phase2SaveSettle(base)).toBe("undo");
  });
  it("cleared and still blank, the save FAILED: the entry it failed to replace is undone; with nothing on file the failure stands", () => {
    expect(phase2SaveSettle({ ...base, answer: "failed", completionOnFile: "c1" })).toBe("undo");
    expect(phase2SaveSettle({ ...base, answer: "failed", completionOnFile: null })).toBe("as_answered");
  });
  it("another save of the row is still in flight: the row waits for that answer, never Saved", () => {
    expect(phase2SaveSettle({ ...base, otherSaveInFlight: true })).toBe("wait");
    expect(phase2SaveSettle({ ...base, otherSaveInFlight: true, answer: "failed", completionOnFile: null })).toBe("wait");
  });
  it("saved but the entry's id is unknown: the row stops counting as done, nothing to undo by id", () => {
    expect(phase2SaveSettle({ ...base, completionOnFile: null })).toBe("cleared");
  });
  it("an Undo already ran on the row meanwhile (a stale answer): cleared and offered, not undone on its own", () => {
    for (const row of [
      { status: "unsaved" as const, completionId: null, incompleteReason: null },
      { status: "incomplete" as const, completionId: "c9", incompleteReason: "cleared_saved" as const },
      null,
    ]) {
      expect(phase2SaveSettle({ ...base, row })).toBe("cleared");
    }
  });
  it("no verdict but as_answered may mark the row Saved, in the dispatcher too", () => {
    const page = readFileSync(join(ROOT, "app", "(authed)", "operations", "opening", "opening-client.tsx"), "utf8");
    const fn = page.slice(page.indexOf("const handlePhase2ItemSave = async ("), page.indexOf("const handlePhase2ItemRevoke = async ("));
    // Every place the save's answer writes "saved" is gated on the verdict …
    const savedWrites = fn.split(/\r?\n/).filter((line) => /^\s*status: .*"saved"/.test(line));
    expect(savedWrites).toHaveLength(3);
    expect(savedWrites.filter((line) => line.includes('verdict === "as_answered" ? "saved"'))).toHaveLength(2);
    // … but the 409 that ADOPTS the winner's amount into the box (the box is not blank then).
    const adopt = fn.slice(fn.indexOf("const adopted = hydrated.formValue;"), fn.indexOf("} else {", fn.indexOf("const adopted = hydrated.formValue;")));
    expect(adopt).toContain("updated.set(templateItemId, adopted);");
    expect(adopt).toContain('status: "saved",');
    // Every committed blank is counted, and each save remembers the count it left with.
    const blank = fn.slice(fn.indexOf('if (gate.kind === "blank")'), fn.indexOf('if (gate.kind === "incomplete")'));
    expect(blank).toContain("phase2BlankBlurRef.current.set(templateItemId");
    expect(fn).toContain("const blankBlursAtRequest = phase2BlankBlurRef.current.get(templateItemId) ?? 0;");
    expect(fn).toContain("phase2SaveSettle({");
    // The queued clear's Undo names the entry: the success hands back the id it just wrote.
    expect(fn).toContain('if (verdict === "undo" && writtenId !== null) return { undoCompletionId: writtenId };');
  });
  it("the row runs the ordinary Undo on the entry a settled save names", () => {
    const entry = readFileSync(join(ROOT, "components", "opening", "OpeningPrepEntry.tsx"), "utf8");
    expect(entry).toContain("void handleRevokeClick(itemId, settled.undoCompletionId);");
    // Every save of a row leaves through the one wrapper (the box, the shortcut, both modals).
    expect(entry.match(/\bonSaveItem\(/g)).toHaveLength(1);
    expect(entry.match(/\bsaveItem\(/g)!.length).toBeGreaterThanOrEqual(3);
  });
});

describe("phase2RevokeSettle — an Undo's answer never wipes what was typed meanwhile (B180)", () => {
  const saved = (completionId: string | null, status: "saved" | "saving" | "incomplete" = "saved") =>
    ({ status, completionId, incompleteReason: status === "incomplete" ? ("cleared_saved" as const) : null });
  it("the Undo button: the row re-opens and the box is emptied", () => {
    expect(phase2RevokeSettle({ revokedCompletionId: "c1", row: saved("c1"), preppedAtRequest: 12, preppedNow: 12 }))
      .toEqual({ row: "reopen", clearForm: true });
  });
  it("clearing a saved amount: the row re-opens; the box was already empty", () => {
    expect(phase2RevokeSettle({ revokedCompletionId: "c1", row: saved("c1", "incomplete"), preppedAtRequest: null, preppedNow: null }))
      .toEqual({ row: "reopen", clearForm: true });
  });
  it("an amount typed during the round trip is kept", () => {
    expect(phase2RevokeSettle({ revokedCompletionId: "c1", row: saved("c1", "incomplete"), preppedAtRequest: null, preppedNow: 15 }))
      .toEqual({ row: "reopen", clearForm: false });
  });
  it("a save in flight keeps the row saving and its amount; only the revoked id is forgotten", () => {
    expect(phase2RevokeSettle({ revokedCompletionId: "c1", row: saved("c1", "saving"), preppedAtRequest: null, preppedNow: 15 }))
      .toEqual({ row: "forget_id", clearForm: false });
  });
  it("a newer save that already landed owns the row: nothing is reset", () => {
    expect(phase2RevokeSettle({ revokedCompletionId: "c1", row: saved("c2"), preppedAtRequest: null, preppedNow: 15 }))
      .toEqual({ row: "keep", clearForm: false });
  });
  it("the revoke dispatcher settles through it, against the row as it is now", () => {
    const page = readFileSync(join(ROOT, "app", "(authed)", "operations", "opening", "opening-client.tsx"), "utf8");
    const fn = page.slice(page.indexOf("const handlePhase2ItemRevoke = async ("), page.indexOf("const handleTabClick ="));
    expect(fn).toContain("phase2RevokeSettle({");
    expect(fn).toContain("const live = phase2LiveRef.current;");
    expect(fn.indexOf("phase2RevokeSettle({")).toBeLessThan(fn.indexOf("setSaveStates("));
    // …and again inside the updater, on the freshest row: a save that just landed is never overwritten.
    const updater = fn.slice(fn.indexOf("setSaveStates((prev) => {"));
    expect(updater.slice(0, 260)).toContain("const fresh = phase2RevokeSettle({ revokedCompletionId: completionId, row: cur, preppedAtRequest, preppedNow });");
    expect(fn).toContain('if (fresh.row === "keep") return prev;');
    expect(fn).toContain("if ((cur?.openerPrepped ?? null) !== preppedAtRequest) return prev;");
  });
});
