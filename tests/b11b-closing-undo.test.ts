import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TwoTapUndoButton, twoTapStep } from "@/components/prep/TwoTapUndoButton";

describe("closing Undo reuses the two-tap rule with closing grammar", () => {
  it("first tap arms, second fires; expiry never fires", () => {
    expect(twoTapStep(false, "tap").fire).toBe(false);
    expect(twoTapStep(true, "tap").fire).toBe(true);
    expect(twoTapStep(true, "timeout")).toEqual({ armed: false, fire: false });
  });
  it("renders the closing 48px rounded rectangle", () => {
    const html = renderToStaticMarkup(createElement(TwoTapUndoButton, {
      onConfirm: () => {}, disabled: false, pending: false, variant: "closing", resetKey: "completion-a",
      label: "Undo", armedLabel: "Tap again to undo", pendingLabel: "Undoing",
      ariaLabel: "Undo completion", armedAriaLabel: "Tap again to undo completion",
    }));
    expect(html).toMatch(/min-h-\[48px\].*rounded-lg/);
    expect(html).toContain('data-armed="false"');
  });
  it("closing gates the existing server handler, while refusal restores the row", () => {
    const src = readFileSync("components/ChecklistItem.tsx", "utf8");
    expect(src).toContain("onConfirm={() => void handleUndoClick()}");
    expect(src).toContain("key={liveCompletion?.id}");
    expect(src).toContain("setRevoked(false);");
    expect(src).toContain("QUICK_WINDOW_MS");
    expect(src).not.toContain("function UndoButton(");
  });
  it("a collapsed closing station still exposes its failed-row count", () => {
    const src = readFileSync("app/(authed)/operations/closing/closing-client.tsx", "utf8");
    expect(src).toContain("onErrorChange={onRowErrorChange}");
    expect(src).toContain('t("save_status.failed_count", { n: failedCount })');
  });
});
