/**
 * Unit spine — lib/written-reports-shared.ts (pure).
 * Pins: category membership, draft validation + normalization, the
 * visibility-floor option set (integer levels >= 3, canonical labels), and the
 * 3-hour self-edit window (mirrors the RLS UPDATE policy).
 */
import { describe, it, expect } from "vitest";
import {
  WRITTEN_REPORT_CATEGORIES,
  WRITTEN_REPORT_LIMITS,
  WRITTEN_REPORT_DEFAULT_VISIBILITY,
  isWrittenReportCategory,
  validateWrittenReportDraft,
  visibilityFloorOptions,
  isWithinEditWindow,
} from "@/lib/written-reports-shared";

describe("category membership", () => {
  it("accepts every declared category, rejects strays", () => {
    for (const c of WRITTEN_REPORT_CATEGORIES) expect(isWrittenReportCategory(c)).toBe(true);
    expect(isWrittenReportCategory("urgent")).toBe(false);
    expect(isWrittenReportCategory("")).toBe(false);
    expect(isWrittenReportCategory(null)).toBe(false);
    expect(isWrittenReportCategory(3)).toBe(false);
  });

  it("the five council-named categories are exactly present", () => {
    expect([...WRITTEN_REPORT_CATEGORIES]).toEqual([
      "incident",
      "observation",
      "request",
      "feedback",
      "other",
    ]);
  });
});

describe("visibilityFloorOptions", () => {
  const opts = visibilityFloorOptions();

  it("only integer levels >= the default floor (3), ascending", () => {
    for (const o of opts) {
      expect(o.level).toBeGreaterThanOrEqual(WRITTEN_REPORT_DEFAULT_VISIBILITY);
      expect(Number.isInteger(o.level)).toBe(true);
    }
    const levels = opts.map((o) => o.level);
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
  });

  it("floor 3 maps to employee; 6 to the AGM-tier canonical role", () => {
    const l3 = opts.find((o) => o.level === 3);
    const l6 = opts.find((o) => o.level === 6);
    expect(l3?.role).toBe("employee");
    // shared-level ties resolve to the highest-listed role at that level (agm).
    expect(l6?.role).toBe("agm");
  });

  it("no duplicate levels", () => {
    const levels = opts.map((o) => o.level);
    expect(new Set(levels).size).toBe(levels.length);
  });
});

describe("validateWrittenReportDraft — required body + normalization", () => {
  it("body_required when body is empty/whitespace/missing", () => {
    expect(validateWrittenReportDraft({ body: "" }).error).toBe("body_required");
    expect(validateWrittenReportDraft({ body: "   \n\t" }).error).toBe("body_required");
    expect(validateWrittenReportDraft({}).error).toBe("body_required");
  });

  it("trims body and title; whitespace-only title normalizes to null", () => {
    const r = validateWrittenReportDraft({ title: "   ", body: "  the walk-in was warm  " });
    expect(r.ok).toBe(true);
    expect(r.draft?.title).toBeNull();
    expect(r.draft?.body).toBe("the walk-in was warm");
  });

  it("keeps a real title trimmed", () => {
    const r = validateWrittenReportDraft({ title: "  Fridge issue ", body: "x" });
    expect(r.draft?.title).toBe("Fridge issue");
  });

  it("enforces length limits", () => {
    expect(
      validateWrittenReportDraft({ body: "a".repeat(WRITTEN_REPORT_LIMITS.bodyMax + 1) }).error,
    ).toBe("body_too_long");
    expect(
      validateWrittenReportDraft({
        title: "a".repeat(WRITTEN_REPORT_LIMITS.titleMax + 1),
        body: "x",
      }).error,
    ).toBe("title_too_long");
  });
});

describe("validateWrittenReportDraft — category + visibility", () => {
  it("null/empty category passes and normalizes to null", () => {
    expect(validateWrittenReportDraft({ body: "x", category: null }).draft?.category).toBeNull();
    expect(validateWrittenReportDraft({ body: "x", category: "" }).draft?.category).toBeNull();
    expect(validateWrittenReportDraft({ body: "x" }).draft?.category).toBeNull();
  });

  it("valid category survives; invalid rejected", () => {
    expect(validateWrittenReportDraft({ body: "x", category: "incident" }).draft?.category).toBe(
      "incident",
    );
    expect(validateWrittenReportDraft({ body: "x", category: "nope" }).error).toBe(
      "invalid_category",
    );
  });

  it("visibility defaults to 3 when omitted", () => {
    expect(validateWrittenReportDraft({ body: "x" }).draft?.visibilityMinLevel).toBe(
      WRITTEN_REPORT_DEFAULT_VISIBILITY,
    );
  });

  it("visibility must be an offered floor level", () => {
    expect(validateWrittenReportDraft({ body: "x", visibilityMinLevel: 6 }).ok).toBe(true);
    expect(validateWrittenReportDraft({ body: "x", visibilityMinLevel: 2 }).error).toBe(
      "invalid_visibility",
    );
    expect(validateWrittenReportDraft({ body: "x", visibilityMinLevel: 99 }).error).toBe(
      "invalid_visibility",
    );
    // decimal / non-offered level rejected
    expect(validateWrittenReportDraft({ body: "x", visibilityMinLevel: 6.5 }).error).toBe(
      "invalid_visibility",
    );
  });
});

describe("isWithinEditWindow — mirrors the RLS 3h UPDATE window", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("true just inside 3h, false just outside", () => {
    expect(isWithinEditWindow("2026-07-29T09:00:01Z", now)).toBe(true);
    expect(isWithinEditWindow("2026-07-29T08:59:59Z", now)).toBe(false);
    expect(isWithinEditWindow("2026-07-29T11:59:00Z", now)).toBe(true);
  });

  it("false for an unparseable timestamp", () => {
    expect(isWithinEditWindow("not-a-date", now)).toBe(false);
  });

  it("accepts Date instances", () => {
    expect(isWithinEditWindow(new Date("2026-07-29T11:00:00Z"), now)).toBe(true);
  });
});
