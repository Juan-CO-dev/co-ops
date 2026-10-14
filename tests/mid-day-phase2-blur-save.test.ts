/**
 * D-14 (Juan 2026-10-13) — mid-day Phase 2 saves each row when you leave the box, like
 * opening Phase 2. The per-row Save button is gone; the over/under reason gate and the
 * batch checks are unchanged, and finalize waits for in-flight row saves.
 *
 * The rule is the pure midDayPhase2SaveGate + midDayPhase2Signature (lib/mid-day-shared.ts);
 * the form wiring is pinned at source (the house posture for client components).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";
import { emptyBatchFormValue, type BatchRowContext } from "@/lib/batch-prep-shared";
import {
  midDayPhase2SaveGate,
  midDayPhase2Signature,
  type MidDayOverUnderValue,
} from "@/lib/mid-day-shared";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

const OVER: MidDayOverUnderValue = { kind: "over", reasonCategory: "busy_day", directedBy: null, freeText: null };
const UNDER: MidDayOverUnderValue = { kind: "under", reasonCategory: "ran_out", directedBy: null, freeText: "no bread" };

const single = (need: number | null) => ({ need, batch: null });
const row = (value: string, overUnder: MidDayOverUnderValue | null = null) => ({
  value,
  overUnder,
  batch: emptyBatchFormValue(),
});

const BATCH_CTX: BatchRowContext = {
  recipeName: "Mayo",
  yieldPerBatch: 4,
  shelfLifeDays: 5,
  backupBefore: 2,
  lineCount: 1,
  need: 3,
  parUnit: "Bottle",
  madeOn: null,
  blocked: false,
  blockedReason: null,
};

describe("midDayPhase2SaveGate — what leaving the box does", () => {
  it("an empty box saves nothing and nudges nothing", () => {
    expect(midDayPhase2SaveGate(row(""), single(4))).toEqual({ kind: "blank" });
    expect(midDayPhase2SaveGate(row("   "), single(4))).toEqual({ kind: "blank" });
  });

  it("a negative or non-number amount is invalid", () => {
    expect(midDayPhase2SaveGate(row("-1"), single(4))).toEqual({ kind: "invalid" });
    expect(midDayPhase2SaveGate(row("abc"), single(4))).toEqual({ kind: "invalid" });
  });

  it("an amount at the need saves with no reason (and drops a stale one)", () => {
    expect(midDayPhase2SaveGate(row("4"), single(4))).toEqual({ kind: "ok", prepped: 4, overUnder: null, batchEntry: null });
    expect(midDayPhase2SaveGate(row("4", OVER), single(4))).toEqual({ kind: "ok", prepped: 4, overUnder: null, batchEntry: null });
  });

  it("an amount off the need waits for the over/under reason, then saves with it", () => {
    expect(midDayPhase2SaveGate(row("6"), single(4))).toEqual({ kind: "incomplete", reason: "needs_reason", batchErrorCode: null });
    expect(midDayPhase2SaveGate(row("2"), single(4))).toEqual({ kind: "incomplete", reason: "needs_reason", batchErrorCode: null });
    expect(midDayPhase2SaveGate(row("6", OVER), single(4))).toEqual({ kind: "ok", prepped: 6, overUnder: OVER, batchEntry: null });
    expect(midDayPhase2SaveGate(row("2", UNDER), single(4))).toEqual({ kind: "ok", prepped: 2, overUnder: UNDER, batchEntry: null });
  });

  it("a row with no need (no par or no count) never asks for a reason", () => {
    expect(midDayPhase2SaveGate(row("7"), single(null))).toEqual({ kind: "ok", prepped: 7, overUnder: null, batchEntry: null });
  });

  it("a batch row runs the batch checks and names the failing code", () => {
    // Bottling 3 from a backup of 2 with no batch made: not enough on hand.
    expect(midDayPhase2SaveGate(row("3"), { need: 3, batch: BATCH_CTX })).toEqual({
      kind: "incomplete",
      reason: "needs_batch",
      batchErrorCode: "bottled_exceeds_available",
    });
    const ok = midDayPhase2SaveGate({ value: "3", overUnder: null, batch: { ...emptyBatchFormValue(), batches: 1 } }, { need: 3, batch: BATCH_CTX });
    expect(ok.kind).toBe("ok");
    if (ok.kind === "ok") expect(ok.batchEntry).toEqual({ batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null });
  });

  it("a blocked batch recipe or an unknown backup blocks the save with the RPC's code", () => {
    expect(midDayPhase2SaveGate(row("3"), { need: 3, batch: { ...BATCH_CTX, blocked: true } })).toMatchObject({
      kind: "incomplete",
      batchErrorCode: "batch_recipe_unresolved",
    });
    expect(midDayPhase2SaveGate(row("3"), { need: 3, batch: { ...BATCH_CTX, backupBefore: null } })).toMatchObject({
      kind: "incomplete",
      batchErrorCode: "backup_unknown",
    });
  });

  it("the reason gate runs before the batch checks (same order as the old Save button)", () => {
    expect(midDayPhase2SaveGate(row("5"), { need: 3, batch: BATCH_CTX })).toEqual({
      kind: "incomplete",
      reason: "needs_reason",
      batchErrorCode: null,
    });
  });
});

describe("midDayPhase2Signature — a blur that changes nothing is not re-sent", () => {
  const base = { prepped: 6, overUnder: OVER, confirmedConsumption: null, batchEntry: null };

  it("is stable for the same beats, whatever the key order of the stored reason", () => {
    const reordered = { freeText: null, directedBy: null, reasonCategory: "busy_day", kind: "over" } as MidDayOverUnderValue;
    expect(midDayPhase2Signature({ ...base, overUnder: reordered })).toBe(midDayPhase2Signature(base));
  });

  it("changes with the amount, the reason, the panel and the batch half", () => {
    const sig = midDayPhase2Signature(base);
    expect(midDayPhase2Signature({ ...base, prepped: 7 })).not.toBe(sig);
    expect(midDayPhase2Signature({ ...base, overUnder: { ...OVER, freeText: "catering" } })).not.toBe(sig);
    expect(midDayPhase2Signature({ ...base, confirmedConsumption: [{ skuId: "x", qty: 1 }] })).not.toBe(sig);
    expect(midDayPhase2Signature({ ...base, batchEntry: { batches: 1, cameOutTo: 4, tossed: 0, overBatchReason: null } })).not.toBe(sig);
  });
});

describe("the form saves on blur — no per-row Save button", () => {
  const form = read("components", "MidDayPhase2Form.tsx");

  it("the prepped box persists on blur", () => {
    expect(form).toContain("onBlur={() => void persist(it, st)}");
  });

  it("the per-row Save button and its key are gone", () => {
    expect(form).not.toContain("onSave(it)");
    expect(form).not.toContain('"mid_day_prep.phase2.save"');
    expect((en as Record<string, string>)["mid_day_prep.phase2.save"]).toBeUndefined();
    expect((es as Record<string, string>)["mid_day_prep.phase2.save"]).toBeUndefined();
  });

  it("saving an over/under reason persists the row with that reason", () => {
    expect(form).toContain("void persist(it, { ...st, overUnder: overToOU(c) });");
    expect(form).toContain("void persist(it, { ...st, overUnder: underToOU(c) });");
  });

  it("a panel edit and a batch commit persist themselves", () => {
    expect(form).toContain("void persist(it, { ...st, confirmedConsumption: rows });");
    expect(form).toContain("onCommit={(next) => void persist(it, { ...st, batch: next })}");
  });

  it("finalize waits for every in-flight row save before posting", () => {
    const fin = form.slice(form.indexOf("const onFinalize"));
    const waitAt = fin.indexOf("await Promise.all([...chains.current.values()]);");
    expect(waitAt).toBeGreaterThan(-1);
    expect(waitAt).toBeLessThan(fin.indexOf('fetch("/api/prep/mid-day/phase2/finalize"'));
  });

  it("one row's saves are chained, never raced", () => {
    expect(form).toContain("const next = pending.then(run);");
  });

  it("new strings ship in en and es", () => {
    for (const k of ["mid_day_prep.phase2.autosave_hint", "mid_day_prep.phase2.retry", "mid_day_prep.phase2.retry_aria"]) {
      expect((en as Record<string, string>)[k], k).toBeTruthy();
      expect((es as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
