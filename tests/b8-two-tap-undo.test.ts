import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  TwoTapUndoButton,
  twoTapStep,
  UNDO_CONFIRM_WINDOW_MS,
} from "@/components/prep/TwoTapUndoButton";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

// B8 #1 (sim walk 2026-10-14): a tap meant for blank space landed on the previous
// row's one-tap Undo and revoked a saved Phase 2 entry (quick_reenter, no confirm).

const read = (p: string) => readFileSync(p, "utf8");

describe("B8 #1 two-tap undo rule", () => {
  it("the first tap only arms; it never fires", () => {
    expect(twoTapStep(false, "tap")).toEqual({ armed: true, fire: false });
  });
  it("the second tap fires and disarms", () => {
    expect(twoTapStep(true, "tap")).toEqual({ armed: false, fire: true });
  });
  it("the window timing out disarms without firing", () => {
    expect(twoTapStep(true, "timeout")).toEqual({ armed: false, fire: false });
    expect(twoTapStep(false, "timeout")).toEqual({ armed: false, fire: false });
  });
  it("tap → timeout → tap arms again instead of firing", () => {
    let armed = twoTapStep(false, "tap").armed;
    armed = twoTapStep(armed, "timeout").armed;
    expect(twoTapStep(armed, "tap")).toEqual({ armed: true, fire: false });
  });
  it("the confirm window is about four seconds", () => {
    expect(UNDO_CONFIRM_WINDOW_MS).toBe(4000);
  });
  it("renders idle at the 44px floor with the plain label", () => {
    const html = renderToStaticMarkup(
      createElement(TwoTapUndoButton, {
        onConfirm: () => {},
        disabled: false,
        pending: false,
        label: "Undo",
        armedLabel: "Tap again to undo",
        pendingLabel: "Undoing…",
        ariaLabel: "Undo x",
        armedAriaLabel: "Tap again x",
      }),
    );
    expect(html).toContain(">Undo<");
    expect(html).toContain('data-armed="false"');
    expect(html).toMatch(/min-h-\[44px\] items-center/);
  });
});

describe("B8 #1 opening Phase 2 row pins", () => {
  const src = read("components/opening/OpeningPrepEntry.tsx");
  it("the row Undo is the two-tap button, never a bare onClick={onRevoke}", () => {
    expect(src).toContain("<TwoTapUndoButton");
    expect(src).toContain("onConfirm={onRevoke}");
    expect(src).not.toMatch(/onClick=\{onRevoke\}/);
  });
  it("the save-status line reserves the 44px height so saving never shifts rows", () => {
    expect(src).toContain("<SaveStatusFrame>");
    expect(read("components/ui/SaveStatus.tsx")).toContain("flex min-h-[44px] flex-wrap items-center");
  });
  it("the armed copy exists in en and es", () => {
    expect(en["opening.phase2.revoke.cta_confirm"]).toBe("Tap again to undo");
    expect(es["opening.phase2.revoke.cta_confirm"]).toBe("Toca otra vez para deshacer");
    expect(en["opening.phase2.revoke.cta_confirm_aria"]).toContain("{item}");
    expect(es["opening.phase2.revoke.cta_confirm_aria"]).toContain("{item}");
  });
  it("mid-day Phase 2 has no one-tap row revoke to guard", () => {
    expect(read("components/MidDayPhase2Form.tsx")).not.toMatch(/onRevoke|revoke\.cta/);
  });
});
