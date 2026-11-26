// @vitest-environment jsdom
/**
 * Digests round 3, PR 1b (plan §3.2): a deep link opens the section it names. `CollapsibleSection` with an `anchorId`
 * reveals itself when the page's hash is `#<anchorId>` — after mount and on every `hashchange` to it — opening only a
 * CLOSED section (in controlled mode by one `onToggle`, never closing it), then scrolling it into view AFTER the open
 * has rendered. Also pinned: the screens that carry the new ids (Prep demand's day sections with the first tab from
 * `?tab=`, Ordering's parts).
 */
import { createElement, StrictMode, useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { PrepDemandClient } from "@/components/admin/catering/prep-demand/PrepDemandClient";
import { OrderingSurfaces } from "@/components/ordering/OrderingSurfaces";
import { TranslationProvider } from "@/lib/i18n/provider";
import { isPrepDemandTab } from "@/lib/catering/prep-demand-shared";
import type { PrepDemandDay } from "@/lib/catering/prep-demand";
import { OpenCreditsPanel } from "@/components/receiving/OpenCreditsPanel";
import { DIGEST_ANCHORS } from "@/lib/report-digests-anchors-shared";

/** Every scrollIntoView call, with whether the section's panel was open at that moment. */
let scrolls: Array<{ id: string; openAtScroll: boolean }> = [];
beforeEach(() => {
  scrolls = [];
  window.history.replaceState(null, "", "/page");
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    const button = this.querySelector("button[aria-expanded]");
    scrolls.push({ id: this.id, openAtScroll: button?.getAttribute("aria-expanded") === "true" });
  } as Element["scrollIntoView"];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const section = (props: Record<string, unknown>, title = "Section") =>
  createElement(CollapsibleSection, { title, idBase: `${title}-panel`, ...props } as never, createElement("p", null, `${title} body`));
const header = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const setHash = (hash: string) => act(() => {
  window.history.replaceState(null, "", `/page${hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
});

describe("uncontrolled", () => {
  it("reveals after mount when the page arrives with its hash, then scrolls to it with the panel open", () => {
    window.history.replaceState(null, "", "/page#target");
    render(section({ anchorId: "target" }));
    expect(header("Section").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Section body")).toBeTruthy();
    expect(scrolls).toEqual([{ id: "target", openAtScroll: true }]);
  });

  it("reveals on a hashchange to it; a hash naming another section changes nothing", () => {
    render(createElement("div", null, section({ anchorId: "one" }, "One"), section({ anchorId: "two" }, "Two")));
    expect(header("One").getAttribute("aria-expanded")).toBe("false");
    setHash("#two");
    expect(header("Two").getAttribute("aria-expanded")).toBe("true");
    expect(header("One").getAttribute("aria-expanded")).toBe("false");
    expect(scrolls).toEqual([{ id: "two", openAtScroll: true }]);
  });

  it("an open section stays open (it is only scrolled to); a section the person closes is not re-opened by a re-render", () => {
    window.history.replaceState(null, "", "/page#target");
    const { rerender } = render(section({ anchorId: "target", defaultOpen: true }));
    expect(header("Section").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls).toHaveLength(1);
    fireEvent.click(header("Section"));
    expect(header("Section").getAttribute("aria-expanded")).toBe("false");
    rerender(section({ anchorId: "target", defaultOpen: true, count: "2" }));
    expect(header("Section").getAttribute("aria-expanded")).toBe("false");
    expect(scrolls).toHaveLength(1);
  });

  it("no anchorId, or no hash: nothing happens", () => {
    window.history.replaceState(null, "", "/page#target");
    render(section({}));
    expect(header("Section").getAttribute("aria-expanded")).toBe("false");
    cleanup();
    window.history.replaceState(null, "", "/page");
    render(section({ anchorId: "target" }));
    expect(header("Section").getAttribute("aria-expanded")).toBe("false");
    expect(scrolls).toEqual([]);
  });
});

describe("controlled mode: the reveal asks the parent to open, once, and never closes it", () => {
  function Parent({ startOpen, onToggleSpy }: { startOpen: boolean; onToggleSpy: () => void }): ReactNode {
    const [open, setOpen] = useState(startOpen);
    return section({ anchorId: "ctl", open, onToggle: () => { onToggleSpy(); setOpen((v) => !v); } }, "Controlled");
  }

  it("closed: onToggle is called once; the panel opens; the scroll comes after the open rendered", () => {
    window.history.replaceState(null, "", "/page#ctl");
    const spy = vi.fn();
    render(createElement(Parent, { startOpen: false, onToggleSpy: spy }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls).toEqual([{ id: "ctl", openAtScroll: true }]);
  });

  it("already open (a dirty editor holding it open): onToggle is NEVER called, on mount or on hashchange", () => {
    window.history.replaceState(null, "", "/page#ctl");
    const spy = vi.fn();
    render(createElement(Parent, { startOpen: true, onToggleSpy: spy }));
    setHash("#elsewhere");
    setHash("#ctl");
    expect(spy).not.toHaveBeenCalled();
    expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls.map((s) => s.openAtScroll)).toEqual([true, true]);
  });

  it("a parent that keeps it closed: asked once, never toggled twice (not even on a later hashchange), and no scroll", () => {
    // Fix round 1, A4: the scroll waits for the COMMITTED open; a parent that never opens gets none from the reveal.
    window.history.replaceState(null, "", "/page#ctl");
    const onToggle = vi.fn();
    render(section({ anchorId: "ctl", open: false, onToggle }, "Locked"));
    setHash("#elsewhere");
    setHash("#ctl");
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(header("Locked").getAttribute("aria-expanded")).toBe("false");
    expect(scrolls).toEqual([]);
  });
});

// Fix round 1, A4: React StrictMode runs mount effects twice before any re-render; the reveal must ask ONCE and end
// OPEN, and the scroll must wait for the committed open, whether the parent opens at once or later.
describe("fix round 1, A4: StrictMode and a parent that opens at once or later", () => {
  const strict = (el: ReactNode) => createElement(StrictMode, null, el);
  function Immediate({ spy }: { spy: () => void }): ReactNode {
    const [open, setOpen] = useState(false);
    return section({ anchorId: "ctl", open, onToggle: () => { spy(); setOpen((v) => !v); } }, "Controlled");
  }
  function Deferred({ spy }: { spy: () => void }): ReactNode {
    const [open, setOpen] = useState(false);
    return section({ anchorId: "ctl", open, onToggle: () => { spy(); setTimeout(() => setOpen((v) => !v), 50); } }, "Controlled");
  }

  it("StrictMode, a parent toggling at once (setOpen(v => !v)): onToggle once, ends OPEN, one scroll after it opened", () => {
    window.history.replaceState(null, "", "/page#ctl");
    const spy = vi.fn();
    render(strict(createElement(Immediate, { spy })));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls).toEqual([{ id: "ctl", openAtScroll: true }]);
  });

  it.each([["plain", false], ["StrictMode", true]] as const)("%s, a parent that opens LATER: no scroll before the open commits, one scroll after", async (_n, isStrict) => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/page#ctl");
      const spy = vi.fn();
      const el = createElement(Deferred, { spy });
      render(isStrict ? strict(el) : el);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(header("Controlled").getAttribute("aria-expanded")).toBe("false");
      expect(scrolls).toEqual([]); // the parent has not opened yet: nothing to scroll to
      await act(async () => { vi.advanceTimersByTime(60); });
      expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
      expect(scrolls).toEqual([{ id: "ctl", openAtScroll: true }]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("StrictMode, uncontrolled: opens and scrolls once it rendered open", () => {
    window.history.replaceState(null, "", "/page#target");
    render(strict(section({ anchorId: "target" })));
    expect(header("Section").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls.length).toBeGreaterThanOrEqual(1);
    expect(scrolls.every((s) => s.openAtScroll)).toBe(true);
  });

  it("the person's own tap ends a deferred reveal: it does not scroll later", async () => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/page#ctl");
      const spy = vi.fn();
      render(createElement(Deferred, { spy }));
      fireEvent.click(header("Controlled")); // a second (deferred) toggle from the person: open, then closed again
      await act(async () => { vi.advanceTimersByTime(60); });
      expect(scrolls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("revealOnMount={false} (fix round 1, O1): no reveal after mount; a hashchange still reveals", () => {
  it("arriving with the hash: stays closed, no scroll; then a hashchange to it opens and scrolls", () => {
    window.history.replaceState(null, "", "/page#target");
    render(section({ anchorId: "target", revealOnMount: false }));
    expect(header("Section").getAttribute("aria-expanded")).toBe("false");
    expect(scrolls).toEqual([]);
    setHash("#other");
    setHash("#target");
    expect(header("Section").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls).toEqual([{ id: "target", openAtScroll: true }]);
  });
});

describe("fix round 1, A3: Receiving's #open-credits OPENS the credits on arrival (the real OpenCreditsPanel)", () => {
  const credits = (lang: "en" | "es" = "en") => createElement(TranslationProvider, { initialLanguage: lang, children: createElement(OpenCreditsPanel, {
    summary: [
      { vendorId: "v1", vendorName: "Baldor", openCount: 2, totalCents: 4200, oldestDays: 3 },
      { vendorId: "v2", vendorName: "Sysco", openCount: 1, totalCents: null, oldestDays: 9 },
    ],
  }) } as never);

  it("with the hash: the disclosure itself carries the id, it opens, the vendors show, then it is scrolled to", () => {
    window.history.replaceState(null, "", `/operations/receiving?location=a#${DIGEST_ANCHORS.receivingCredits}`);
    render(credits());
    const target = document.getElementById(DIGEST_ANCHORS.receivingCredits)!;
    expect(target.tagName).toBe("SECTION");
    expect(target.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Baldor")).toBeTruthy();
    expect(screen.getByText("Sysco")).toBeTruthy();
    expect(scrolls).toEqual([{ id: DIGEST_ANCHORS.receivingCredits, openAtScroll: true }]);
    // Exactly one element carries the anchor.
    expect(document.querySelectorAll(`#${DIGEST_ANCHORS.receivingCredits}`)).toHaveLength(1);
  });

  it("without the hash: collapsed as before (Disclosure Doctrine D3)", () => {
    render(credits("es"));
    expect(document.getElementById(DIGEST_ANCHORS.receivingCredits)!.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Baldor")).toBeNull();
    expect(scrolls).toEqual([]);
  });
});

// ── The screens ───────────────────────────────────────────────────────────────────────────────
const day = (needDate: string): PrepDemandDay => ({
  needDate,
  lines: [{ key: `k-${needDate}`, refKind: "item", name: `Item ${needDate}`, qty: 2, portion: null, overPar: false, parValue: null, wholeEquivDemand: 2, leads: [] }],
} as never);
const prepDemand = (initialTab?: "prep" | "sku") => createElement(TranslationProvider, { initialLanguage: "en", children: createElement(PrepDemandClient, {
  days: [day("2026-11-26"), day("2026-11-27"), day("2026-11-28"), day("2026-11-29"), day("2026-11-30")],
  locations: [{ id: "a", name: "Shop A" }], locationId: "a", from: "2026-11-26", to: "2026-12-10", lang: "en",
  skuDemand: { rows: [], unresolvedChoiceLines: 0, noRecipeLines: 0 }, surplus: [], canPull: false, ...(initialTab ? { initialTab } : {}),
} as never) } as never);

describe("Prep demand: the first tab from ?tab=, then the day section from the hash", () => {
  it("?tab= accepts the page's own tabs only", () => {
    for (const ok of ["prep", "sku", "surplus", "sales"]) expect(isPrepDemandTab(ok)).toBe(true);
    for (const no of ["SKU", "", "orders", null, undefined, ["sku"]]) expect(isPrepDemandTab(no)).toBe(false);
  });

  it("tab=sku opens on the SKU tab; no tab = Prep", () => {
    render(prepDemand("sku"));
    expect(screen.getByRole("tab", { name: /SKU/i }).getAttribute("aria-selected")).toBe("true");
    cleanup();
    render(prepDemand());
    expect(screen.getAllByRole("tab")[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("#prep-day-<date> on the Prep tab: that day opens (5 days start closed) and is scrolled to after it opened", () => {
    window.history.replaceState(null, "", "/admin/catering/prep-demand?location=a&tab=prep#prep-day-2026-11-28");
    render(prepDemand("prep"));
    const target = document.getElementById("prep-day-2026-11-28")!;
    expect(target.querySelector("button")!.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("prep-day-2026-11-27")!.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
    expect(scrolls).toEqual([{ id: "prep-day-2026-11-28", openAtScroll: true }]);
  });

  it("fix round 1, O1: back on the Prep tab with the hash still in the URL, the day does not re-open or jump", () => {
    window.history.replaceState(null, "", "/admin/catering/prep-demand?location=a&tab=prep#prep-day-2026-11-28");
    render(prepDemand("prep"));
    const expanded = () => document.getElementById("prep-day-2026-11-28")!.querySelector("button")!.getAttribute("aria-expanded");
    expect(expanded()).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: /SKU/i }));
    expect(document.getElementById("prep-day-2026-11-28")).toBeNull(); // the Prep sections are unmounted
    fireEvent.click(screen.getAllByRole("tab")[0]!);
    expect(expanded()).toBe("false"); // its default (5 days start closed), not re-opened from the hash
    expect(scrolls).toEqual([{ id: "prep-day-2026-11-28", openAtScroll: true }]); // no second jump
    // A real navigation to the hash still reveals.
    setHash("#elsewhere");
    setHash("#prep-day-2026-11-28");
    expect(expanded()).toBe("true");
    expect(scrolls).toHaveLength(2);
  });
});

describe("Ordering: the digest's anchors are ids on the existing parts", () => {
  it("today's orders, the missed-cutoff alert and the cutoff list carry their ids", () => {
    render(createElement(TranslationProvider, { initialLanguage: "en", children: createElement(OrderingSurfaces, {
      todaysOrders: [], history: [], locationId: "a", actorLevel: 7, language: "en", shopLabel: "A", vendorDateLabel: "Thu",
      cutoffAttention: [{ vendorId: "v", vendorName: "Baldor", cutoffTime: "10:00", hasDraft: false, missed: true }],
    } as never) } as never));
    for (const id of ["todays-orders", "missed-cutoffs", "order-cutoffs"]) expect(document.getElementById(id), id).not.toBeNull();
  });
});
