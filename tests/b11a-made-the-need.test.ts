/**
 * B11a-floor item 2 — "Made the need" one-tap on opening + mid-day Phase 2 prep rows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canMakeTheNeed } from "@/lib/made-the-need-shared";

const base = { need: 4, isBatch: false, readOnly: false, current: null, saved: false };

describe("canMakeTheNeed", () => {
  it("offered on an unsaved single-box row with a numeric need", () => {
    expect(canMakeTheNeed(base)).toBe(true);
    expect(canMakeTheNeed({ ...base, need: 0 })).toBe(true);
  });
  it("hidden with no numeric need", () => {
    expect(canMakeTheNeed({ ...base, need: null })).toBe(false);
    expect(canMakeTheNeed({ ...base, need: Number.NaN })).toBe(false);
  });
  it("hidden once the row is SAVED at the need; offered again when the box moves off it", () => {
    expect(canMakeTheNeed({ ...base, current: 4, saved: true })).toBe(false);
    expect(canMakeTheNeed({ ...base, current: 3, saved: true })).toBe(true);
    expect(canMakeTheNeed({ ...base, current: 4, saved: false })).toBe(true);
  });
  it("never on a batch row, never read-only", () => {
    expect(canMakeTheNeed({ ...base, isBatch: true })).toBe(false);
    expect(canMakeTheNeed({ ...base, readOnly: true })).toBe(false);
  });
});

describe("wiring — the same save, no new field", () => {
  const opening = readFileSync("components/opening/OpeningPrepEntry.tsx", "utf8");
  const midday = readFileSync("components/MidDayPhase2Form.tsx", "utf8");

  it("opening: sets openerPrepped to the need and calls the row's existing onSave", () => {
    expect(opening).toContain("const next = { ...value, openerPrepped: prepNeed, overPar: null, underPar: null };");
    expect(opening).toMatch(/onChange\(next\);\s*onSave\(next\);/);
    expect(opening).toContain("isBatch: batch !== null,");
  });

  it("mid-day: fills the box and triggers that row's onSave with the filled value", () => {
    expect(midday).toContain('const fill = { value: String(it.need), overUnder: null };');
    expect(midday).toContain("void onSave(it, fill);");
    expect(midday).toContain("const st = { ...(states[it.id] ?? EMPTY), ...override };");
    expect(midday).toContain("isBatch: !!it.batch,");
  });

  it("no 'entered via' marker reaches the wire or the DB", () => {
    for (const src of [opening, midday]) expect(src).not.toMatch(/entered_via|enteredVia|made_the_need['"]?\s*:/);
  });

  it("strings exist in en + es", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      expect(dict["prep.made_the_need"], lang).toBeTruthy();
      expect(dict["prep.made_the_need_aria"], lang).toContain("{item}");
    }
  });
});
