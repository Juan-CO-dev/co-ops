/**
 * B11a-floor item 1 — closing temp/count lines save themselves (Enter, or leaving the panel),
 * refuse negatives, keep the note behind "Add a note", and warn above the fridge's safe max.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { isAboveSafeMax, parseCountDraft, sanitizeCountInput, shouldAutoSaveCount } from "@/lib/closing-count-shared";

describe("sanitizeCountInput / parseCountDraft", () => {
  it("strips every minus sign", () => {
    expect(sanitizeCountInput("-38")).toBe("38");
    expect(sanitizeCountInput("3-8")).toBe("38");
  });
  it("empty → null; finite ≥ 0 → number; else invalid", () => {
    expect(parseCountDraft("  ")).toBeNull();
    expect(parseCountDraft("38.5")).toBe(38.5);
    expect(parseCountDraft("0")).toBe(0);
    expect(parseCountDraft("-1")).toBe("invalid");
    expect(parseCountDraft("abc")).toBe("invalid");
    expect(parseCountDraft("Infinity")).toBe("invalid");
  });
});

describe("shouldAutoSaveCount — leaving the box", () => {
  const base = { draft: "38", notesDraft: "", liveCount: null, liveNotes: null, saving: false };
  it("saves a new value", () => {
    expect(shouldAutoSaveCount(base)).toBe(true);
  });
  it("does nothing on an empty box (no missing_count error)", () => {
    expect(shouldAutoSaveCount({ ...base, draft: "" })).toBe(false);
  });
  it("does nothing on an invalid box", () => {
    expect(shouldAutoSaveCount({ ...base, draft: "abc" })).toBe(false);
  });
  it("does nothing when unchanged (Enter then blur never double-saves)", () => {
    expect(shouldAutoSaveCount({ ...base, liveCount: 38 })).toBe(false);
    expect(shouldAutoSaveCount({ ...base, draft: "38.0", liveCount: 38 })).toBe(false);
  });
  it("does nothing while a save is in flight", () => {
    expect(shouldAutoSaveCount({ ...base, saving: true })).toBe(false);
  });
  it("saves when only the note changed", () => {
    expect(shouldAutoSaveCount({ ...base, liveCount: 38, notesDraft: "door was open" })).toBe(true);
    expect(shouldAutoSaveCount({ ...base, liveCount: 38, notesDraft: " x ", liveNotes: "x" })).toBe(false);
  });
});

describe("isAboveSafeMax", () => {
  it("strictly above the line's max (isHotReading's comparison)", () => {
    expect(isAboveSafeMax(42, 41)).toBe(true);
    expect(isAboveSafeMax(41, 41)).toBe(false);
    expect(isAboveSafeMax(null, 41)).toBe(false);
    expect(isAboveSafeMax("invalid", 41)).toBe(false);
    expect(isAboveSafeMax(99, null)).toBe(false);
  });
});

describe("wiring", () => {
  const item = readFileSync("components/ChecklistItem.tsx", "utf8");
  const client = readFileSync("app/(authed)/operations/closing/closing-client.tsx", "utf8");
  const page = readFileSync("app/(authed)/operations/closing/page.tsx", "utf8");

  it("the count box focuses, strips '-', saves on Enter, and the panel saves on leave", () => {
    expect(item).toContain("autoFocus={countOnly}");
    expect(item).toContain("setCountDraft(sanitizeCountInput(e.target.value))");
    expect(item).toContain("onKeyDown={countOnly ? handleCountKeyDown : undefined}");
    expect(item).toContain("onBlur={countOnly ? handleCountPanelBlur : undefined}");
    expect(item).toContain("if (savingRef.current) return;");
  });
  it("count-only lines hide Save/Cancel; photo lines keep them", () => {
    expect(item).toContain("const countOnly = templateItem.expectsCount && !templateItem.expectsPhoto;");
    expect(item).toMatch(/\{countOnly \? \(\s*<div className="mt-1 flex items-center justify-between gap-2">/);
    expect(item).toContain('t("closing.expand.add_note")');
  });
  it("the safe max comes from the fridge registry owner, through the page", () => {
    expect(page).toContain("tempSafeMaxF[item.id] = owner.safeMaxF;");
    expect(client).toContain("tempSafeMaxF={tempSafeMaxF[it.id] ?? null}");
    expect(item).toContain('t("closing.expand.temp_above_max", { max: tempSafeMaxF ?? "" })');
  });
  it("new strings exist in en + es", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      for (const k of ["closing.expand.add_note", "closing.expand.autosave_hint", "closing.expand.temp_above_max"]) {
        expect(dict[k], `${lang} ${k}`).toBeTruthy();
      }
      expect(dict["closing.expand.temp_above_max"]).toContain("{max}");
    }
  });
});
