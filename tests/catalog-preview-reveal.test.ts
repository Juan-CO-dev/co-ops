/** Sim walk 2026-10-15: a preview opened by a tap must be seen — it scrolls to the nearest edge and its heading takes focus. */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const PANELS = [
  "components/catalog/RecipePreviewPanel.tsx",
  "components/catalog/MenuPreviewPanel.tsx",
  "components/catalog/ChangePreviewPanel.tsx",
];

describe("preview panels reveal themselves when they open", () => {
  it.each(PANELS)("%s wires useRevealOnOpen onto its section and a focusable heading", (path) => {
    const src = readFileSync(path, "utf8");
    expect(src).toContain('import { useRevealOnOpen } from "@/components/catalog/useRevealOnOpen";');
    expect(src).toMatch(/const \{ panelRef, headingRef \} = useRevealOnOpen<HTMLElement, HTMLHeadingElement>\(\);/);
    expect(src).toMatch(/<section ref=\{panelRef\} aria-label=/);
    expect(src).toMatch(/<h3 ref=\{headingRef\} tabIndex=\{-1\} /);
  });

  it("the effect scrolls the panel to the nearest edge (no jump when already visible) and focuses the heading without scrolling", async () => {
    const effects: Array<() => void> = [];
    vi.resetModules();
    vi.doMock("react", async (importOriginal) => {
      const real = await importOriginal<typeof import("react")>();
      return { ...real, useRef: (v: unknown) => ({ current: v }), useEffect: (fn: () => void) => { effects.push(fn); } };
    });
    const { useRevealOnOpen } = await import("@/components/catalog/useRevealOnOpen");
    const { panelRef, headingRef } = useRevealOnOpen<HTMLElement, HTMLHeadingElement>();
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    (panelRef as { current: unknown }).current = { scrollIntoView };
    (headingRef as { current: unknown }).current = { focus };
    expect(effects).toHaveLength(1);
    effects[0]!();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    vi.doUnmock("react");
  });
});
