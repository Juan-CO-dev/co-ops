/**
 * B11a-floor — Astra round 2: the "Made the need" blur guard must suppress the box's save ONLY
 * for an activation. Tabbing past the shortcut still saves the typed amount (once); clicking it
 * is exactly one at-need save.
 *
 * The event flow is modelled with the REAL decision helpers and a parent save that mirrors
 * opening-client's guards (saved-signature skip + isDuplicateInFlight), then the source is
 * pinned to the same wiring.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { blurLeavesForMadeTheNeed, isDuplicateInFlight, MADE_THE_NEED_ATTR } from "@/lib/made-the-need-shared";

type Row = { openerPrepped: number | null; overPar: string | null; underPar: string | null };
const sig = (v: Row) => JSON.stringify(v);

function harness(initial: Row) {
  let value = initial;
  let savedSig: string | null = null;
  let inFlight: string | undefined;
  const posted: Row[] = [];
  // opening-client handlePhase2ItemSave guards (the network part is a push + manual settle).
  const onSave = (v: Row) => {
    const s = sig(v);
    if (savedSig === s) return;
    if (isDuplicateInFlight(inFlight, s)) return;
    inFlight = s;
    posted.push(v);
  };
  const settle = () => {
    savedSig = inFlight ?? savedSig;
    inFlight = undefined;
  };
  const button = { getAttribute: (n: string) => (n === MADE_THE_NEED_ATTR ? "" : null) };
  const elsewhere = { getAttribute: () => null };
  return {
    type: (n: number) => { value = { ...value, openerPrepped: n }; },
    // NumericInput onBlur → PrepEntryRow: skip when focus went to the shortcut, else save.
    inputBlur: (related: typeof button | null) => { if (!blurLeavesForMadeTheNeed(related)) onSave(value); },
    // The shortcut's click (pointer, or Enter/Space on a focused button).
    click: (need: number) => { value = { ...value, openerPrepped: need, overPar: null, underPar: null }; onSave(value); },
    // The shortcut's onBlur flushes the row's current value.
    buttonBlur: () => onSave(value),
    settle,
    posted,
    button,
    elsewhere,
  };
}

describe("Astra r2 — the guard fires only for an activation", () => {
  it("Tab onto the shortcut, Tab away → the typed 8 saves exactly once", () => {
    const h = harness({ openerPrepped: 3, overPar: "forecast_busy", underPar: null });
    h.type(8);
    h.inputBlur(h.button); // Tab onto "Made the need": skipped
    h.buttonBlur(); // Tab away without activating
    h.settle();
    expect(h.posted.map((r) => r.openerPrepped)).toEqual([8]);
  });

  it("pointer click (box keeps focus) → exactly one at-need save, even after the box later blurs", () => {
    const h = harness({ openerPrepped: 3, overPar: "forecast_busy", underPar: null });
    h.type(8);
    h.click(5); // pointerdown preventDefault: no box blur before the click
    h.inputBlur(h.elsewhere); // later, while the at-need save is still in flight
    h.settle();
    h.inputBlur(h.elsewhere); // and after it landed
    expect(h.posted).toEqual([{ openerPrepped: 5, overPar: null, underPar: null }]);
  });

  it("Tab onto the shortcut, press Enter, Tab away → exactly one at-need save", () => {
    const h = harness({ openerPrepped: 3, overPar: "forecast_busy", underPar: null });
    h.type(8);
    h.inputBlur(h.button);
    h.click(5);
    h.buttonBlur();
    h.settle();
    h.buttonBlur();
    expect(h.posted.map((r) => r.openerPrepped)).toEqual([5]);
  });
});

describe("Astra r2 wiring", () => {
  const entry = readFileSync("components/opening/OpeningPrepEntry.tsx", "utf8");
  it("the shortcut flushes the row's value when focus leaves it, and still prevents the pointer blur", () => {
    const btn = entry.slice(entry.indexOf('{...{ [MADE_THE_NEED_ATTR]: "" }}'), entry.indexOf('{t("prep.made_the_need")}'));
    expect(btn).toContain("onBlur={() => onSave(value)}");
    expect(btn).toContain("onPointerDown={(e) => e.preventDefault()}");
    expect(entry).toContain("if (blurLeavesForMadeTheNeed(related)) return;");
  });
});
