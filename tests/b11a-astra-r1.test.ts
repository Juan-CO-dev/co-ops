/**
 * B11a-floor — Astra round 1 (two P2s).
 *   P2-1: an edit made while a closing count save is pending is never discarded.
 *   P2-2: "Made the need" after editing the box is exactly ONE at-need save.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { afterCountSaveSuccess, draftChangedSince } from "@/lib/closing-count-shared";
import { blurLeavesForMadeTheNeed, isDuplicateInFlight, MADE_THE_NEED_ATTR } from "@/lib/made-the-need-shared";

describe("P2-1 draftChangedSince / afterCountSaveSuccess", () => {
  const sent = { count: "38", notes: "" };
  it("unchanged (or the same number spelled differently) → close", () => {
    expect(draftChangedSince(sent, { count: "38", notes: "" })).toBe(false);
    expect(draftChangedSince(sent, { count: "38.0", notes: "  " })).toBe(false);
    expect(afterCountSaveSuccess(sent, { count: "38", notes: "" }, true)).toBe("close");
  });
  it("typed 39 mid-save → resave on a count-only line, keep open on a photo line", () => {
    expect(afterCountSaveSuccess(sent, { count: "39", notes: "" }, true)).toBe("resave");
    expect(afterCountSaveSuccess(sent, { count: "39", notes: "" }, false)).toBe("keep_open");
  });
  it("a note added mid-save is a change", () => {
    expect(afterCountSaveSuccess(sent, { count: "38", notes: "door ajar" }, true)).toBe("resave");
  });
  it("a box cleared or made invalid mid-save is a change (kept open, never discarded)", () => {
    expect(draftChangedSince(sent, { count: "", notes: "" })).toBe(true);
    expect(draftChangedSince(sent, { count: "3a", notes: "" })).toBe(true);
  });
});

describe("P2-1 wiring", () => {
  const item = readFileSync("components/ChecklistItem.tsx", "utf8");
  it("every draft write goes through the ref-tracking setters", () => {
    expect(item).toContain('const [countDraft, setCountDraftState] = useState<string>("");');
    expect(item).toContain("draftRef.current = { ...draftRef.current, count: v };");
    expect(item).toContain("draftRef.current = { ...draftRef.current, notes: v };");
  });
  it("success compares the sent draft with the latest and resaves the newer revision", () => {
    expect(item).toContain("afterCountSaveSuccess(sentDraft, draftRef.current, countOnly)");
    expect(item).toContain("if (resaveLatest) saveLatestCountDraft();");
    expect(item).toContain("{ count: countDraft, notes: notesDraft },");
  });
});

describe("P2-2 blurLeavesForMadeTheNeed / isDuplicateInFlight", () => {
  const el = (attrs: Record<string, string>) => ({ getAttribute: (n: string) => attrs[n] ?? null });
  it("focus leaving for the shortcut skips the box's blur-save", () => {
    expect(blurLeavesForMadeTheNeed(el({ [MADE_THE_NEED_ATTR]: "" }))).toBe(true);
    expect(blurLeavesForMadeTheNeed(el({}))).toBe(false);
    expect(blurLeavesForMadeTheNeed(null)).toBe(false);
  });
  it("the same value already in flight is a duplicate; a different one is not", () => {
    expect(isDuplicateInFlight("sig-5", "sig-5")).toBe(true);
    expect(isDuplicateInFlight("sig-8", "sig-5")).toBe(false);
    expect(isDuplicateInFlight(undefined, "sig-5")).toBe(false);
  });
});

describe("P2-2 wiring", () => {
  const entry = readFileSync("components/opening/OpeningPrepEntry.tsx", "utf8");
  const client = readFileSync("app/(authed)/operations/opening/opening-client.tsx", "utf8");
  it("the shortcut keeps focus in the box (no blur-save first) and is marked for the fallback", () => {
    const btn = entry.slice(entry.indexOf("{...{ [MADE_THE_NEED_ATTR]: \"\" }}"), entry.indexOf('{t("prep.made_the_need")}'));
    expect(btn).toContain("onPointerDown={(e) => e.preventDefault()}");
    expect(btn).toContain("onMouseDown={(e) => e.preventDefault()}");
    expect(entry).toContain("if (blurLeavesForMadeTheNeed(related)) return;");
  });
  it("the opening save drops a duplicate in-flight request for the same value", () => {
    expect(client).toContain("if (isDuplicateInFlight(phase2InFlightSigRef.current.get(templateItemId), newSig)) return;");
    expect(client).toContain("phase2InFlightSigRef.current.delete(templateItemId);");
  });
  it("mid-day has no blur-save race; its distinct tap/edit race uses a synchronous per-item rule", () => {
    const midday = readFileSync("components/MidDayPhase2Form.tsx", "utf8");
    const input = midday.slice(midday.indexOf('type="number"'), midday.indexOf("<ActionButton", midday.indexOf('type="number"')));
    expect(input).not.toContain("onBlur");
    expect(midday).toContain("saveOrderRef.current.set(id, result.state)");
  });
});
