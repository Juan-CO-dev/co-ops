/**
 * B11a-floor item 3 — closing review reason shortcuts + station names on the confirmed view.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { applyReasonToEmptyDrafts, countEmptyDrafts, groupIdsByStation } from "@/lib/closing-review-shared";

describe("applyReasonToEmptyDrafts", () => {
  it("fills only the empty (or whitespace) drafts among the given ids", () => {
    const drafts = new Map([["a", "fryer down"], ["b", "  "]]);
    const next = applyReasonToEmptyDrafts(drafts, ["a", "b", "c"], "  short staffed ");
    expect([...next]).toEqual([["a", "fryer down"], ["b", "short staffed"], ["c", "short staffed"]]);
    // the input is not mutated
    expect(drafts.get("b")).toBe("  ");
  });
  it("never touches ids outside the set (a station Apply stays in its station)", () => {
    const next = applyReasonToEmptyDrafts(new Map(), ["a"], "x");
    expect(next.has("b")).toBe(false);
  });
  it("a blank reason, or nothing empty, returns the same map", () => {
    const drafts = new Map([["a", "done"]]);
    expect(applyReasonToEmptyDrafts(drafts, ["a"], "   ")).toBe(drafts);
    expect(applyReasonToEmptyDrafts(drafts, ["a"], "other")).toBe(drafts);
  });
  it("countEmptyDrafts", () => {
    expect(countEmptyDrafts(new Map([["a", "x"], ["b", " "]]), ["a", "b", "c"])).toBe(2);
  });
});

describe("groupIdsByStation", () => {
  it("groups in first-appearance order", () => {
    const st: Record<string, string> = { a: "Grill", b: "Line", c: "Grill", d: "Dish" };
    expect(groupIdsByStation(["a", "b", "c", "d"], (id) => st[id]!)).toEqual([
      { station: "Grill", ids: ["a", "c"] },
      { station: "Line", ids: ["b"] },
      { station: "Dish", ids: ["d"] },
    ]);
  });
});

describe("wiring", () => {
  const client = readFileSync("app/(authed)/operations/closing/closing-client.tsx", "utf8");
  it("the review groups by the SYSTEM-KEY station and offers both shortcuts", () => {
    expect(client).toContain("groupIdsByStation(incompleteRequiredIds, (id) => itemsById.get(id)?.station ?? STATION_FALLBACK)");
    expect(client).toContain('t("closing.review.same_reason_all")');
    expect(client).toContain('t("closing.review.same_reason_station")');
    expect(client).toContain("applyReasonToEmptyDrafts(prev, incompleteRequiredIds, reason)");
    expect(client).toContain("applyReasonToEmptyDrafts(prev, group.ids, reason)");
  });
  it("Continue still requires every line's own non-blank draft", () => {
    expect(client).toContain("if (!r || r.trim().length === 0) return false;");
  });
  it("the confirmed view shows Station · Label — reason · who", () => {
    const view = client.slice(client.indexOf("{shownReasons.map((r) => {"), client.indexOf("{/* Sticky top progress bar */}"));
    expect(view).toContain("resolveTemplateItemContent(item, language)");
    expect(view).toContain('t("closing.review.station_label_separator")');
    expect(view.indexOf("{station}")).toBeLessThan(view.indexOf("{label}"));
    expect(view).toContain("{r.reason}");
    expect(view).toContain("{r.byName ?");
  });
  it("new strings exist in en + es", () => {
    for (const lang of ["en", "es"]) {
      const dict = JSON.parse(readFileSync(`lib/i18n/${lang}.json`, "utf8")) as Record<string, string>;
      for (const k of [
        "closing.review.same_reason_all",
        "closing.review.same_reason_station",
        "closing.review.same_reason_station_aria",
        "closing.review.apply_reason",
        "closing.review.apply_reason_hint",
      ]) expect(dict[k], `${lang} ${k}`).toBeTruthy();
    }
  });
});
