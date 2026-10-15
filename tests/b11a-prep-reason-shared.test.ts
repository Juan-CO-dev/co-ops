/**
 * B11a-floor item 4 — the off-need prep reason runs on the SERVER for mid-day Phase 2 too,
 * through the one validator opening's route uses (lib/prep-reason-shared.ts), and the closing
 * confirm refuses a blank reason.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  checkOffNeedCapture,
  requiredOffNeedReason,
  validateOverReason,
  validateUnderReason,
} from "@/lib/prep-reason-shared";

const MGR = "11111111-2222-3333-4444-555555555555";

describe("validateOverReason (opening's rule, moved)", () => {
  it("accepts a known category", () => {
    expect(validateOverReason({ reasonCategory: "forecast_busy", directedBy: null, freeText: null })).toEqual({
      ok: true,
      value: { reasonCategory: "forecast_busy", directedBy: null, freeText: null },
    });
  });
  it("refuses an unknown category", () => {
    expect(validateOverReason({ reasonCategory: "vibes" })).toEqual({ ok: false, field: "reasonCategory" });
  });
  it("management_directive names who directed it (a uuid)", () => {
    expect(validateOverReason({ reasonCategory: "management_directive", directedBy: null })).toEqual({ ok: false, field: "directedBy" });
    expect(validateOverReason({ reasonCategory: "management_directive", directedBy: "bob" })).toEqual({ ok: false, field: "directedBy" });
    expect(validateOverReason({ reasonCategory: "management_directive", directedBy: MGR }).ok).toBe(true);
  });
  it("'other' needs a non-blank note", () => {
    expect(validateOverReason({ reasonCategory: "other", freeText: "   " })).toEqual({ ok: false, field: "freeText" });
    expect(validateOverReason({ reasonCategory: "other", freeText: "event" }).ok).toBe(true);
  });
});

describe("validateUnderReason", () => {
  it("always needs a note", () => {
    expect(validateUnderReason({ reasonCategory: "time_constraint", freeText: "" })).toEqual({ ok: false, field: "freeText" });
    expect(validateUnderReason({ reasonCategory: "time_constraint", freeText: "slammed" }).ok).toBe(true);
  });
  it("refuses an over category on the under side", () => {
    expect(validateUnderReason({ reasonCategory: "forecast_busy", freeText: "x" })).toEqual({ ok: false, field: "reasonCategory" });
  });
});

describe("requiredOffNeedReason — batch rows match opening (over exempt, under not)", () => {
  it("no numeric need → none", () => {
    expect(requiredOffNeedReason({ prepped: 3, need: null, isBatch: false })).toBeNull();
  });
  it("at the need → none", () => {
    expect(requiredOffNeedReason({ prepped: 4, need: 4, isBatch: false })).toBeNull();
  });
  it("over / under on a single-box row", () => {
    expect(requiredOffNeedReason({ prepped: 5, need: 4, isBatch: false })).toBe("over");
    expect(requiredOffNeedReason({ prepped: 3, need: 4, isBatch: false })).toBe("under");
  });
  it("a batch row is exempt over the line need, never under it", () => {
    expect(requiredOffNeedReason({ prepped: 5, need: 4, isBatch: true })).toBeNull();
    expect(requiredOffNeedReason({ prepped: 3, need: 4, isBatch: true })).toBe("under");
  });
});

describe("checkOffNeedCapture (mid-day wire shape)", () => {
  const under = { kind: "under" as const, reasonCategory: "staff_shortage", directedBy: null, freeText: "two out" };
  it("required and missing → overUnder", () => {
    expect(checkOffNeedCapture({ prepped: 2, need: 4, isBatch: false, capture: null })).toEqual({ ok: false, field: "overUnder" });
  });
  it("wrong kind → overUnder.kind", () => {
    expect(checkOffNeedCapture({ prepped: 6, need: 4, isBatch: false, capture: under })).toEqual({ ok: false, field: "overUnder.kind" });
  });
  it("a present capture is shape-checked", () => {
    expect(checkOffNeedCapture({ prepped: 2, need: 4, isBatch: false, capture: { ...under, freeText: " " } })).toEqual({ ok: false, field: "overUnder.freeText" });
  });
  it("valid → ok; at par with nothing → ok; batch over with nothing → ok", () => {
    expect(checkOffNeedCapture({ prepped: 2, need: 4, isBatch: false, capture: under })).toEqual({ ok: true });
    expect(checkOffNeedCapture({ prepped: 4, need: 4, isBatch: false, capture: null })).toEqual({ ok: true });
    expect(checkOffNeedCapture({ prepped: 9, need: 4, isBatch: true, capture: null })).toEqual({ ok: true });
  });
});

describe("wiring", () => {
  const prep = readFileSync("lib/prep.ts", "utf8");
  const midRoute = readFileSync("app/api/prep/mid-day/phase2/item/route.ts", "utf8");
  const openRoute = readFileSync("app/api/opening/prep/item/route.ts", "utf8");
  const checklists = readFileSync("lib/checklists.ts", "utf8");
  const helpers = readFileSync("app/api/checklist/_helpers.ts", "utf8");
  const modal = readFileSync("components/auth/PinConfirmModal.tsx", "utf8");

  it("mid-day save runs the shared check BEFORE the RPC, with the page's need expression", () => {
    const fn = prep.slice(prep.indexOf("export async function saveMidDayPhase2Item("));
    const checkAt = fn.indexOf("checkOffNeedCapture({");
    const rpcAt = fn.indexOf('service.rpc("save_mid_day_phase2_item_atomic"');
    expect(checkAt).toBeGreaterThan(-1);
    expect(checkAt).toBeLessThan(rpcAt);
    expect(fn).toContain("Math.max(par - onHand, 0)");
    expect(fn).toContain('isBatch: state.batchContext[args.templateItemId]?.eligibility === "batched"');
    expect(midRoute).toContain('jsonError(400, "off_need_reason_required"');
  });

  it("opening's route uses the same validators (no second copy of the sets)", () => {
    expect(openRoute).toContain('from "@/lib/prep-reason-shared"');
    expect(openRoute).not.toContain("const OVER_REASONS");
    expect(openRoute).not.toContain("const UNDER_REASONS");
  });

  it("confirmInstance refuses a blank reason; the route maps it to 400; the modal says why (en + es)", () => {
    expect(checklists).toContain('"blank_reason"');
    expect(checklists).toMatch(/r\.reason\.trim\(\) === ""/);
    expect(helpers).toContain("err instanceof ChecklistBlankReasonError");
    expect(helpers).toMatch(/ChecklistBlankReasonError\) \{\s*return jsonError\(400/);
    expect(modal).toContain('case "blank_reason":');
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      expect(dict["auth.pin_modal.error_blank_reason"], lang).toBeTruthy();
    }
  });
});
