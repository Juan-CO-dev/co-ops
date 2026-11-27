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

// Digest round 3 polish (1b, A4 follow-up): a pending scroll belongs to the URL that asked for it. A deferred open that
// commits after the person navigated elsewhere opens the section but never scrolls to the stale anchor.
describe("digest round 3 polish: a deferred open never scrolls to a stale anchor", () => {
  const strict = (el: ReactNode) => createElement(StrictMode, null, el);
  function Deferred({ spy }: { spy: () => void }): ReactNode {
    const [open, setOpen] = useState(false);
    return section({ anchorId: "ctl", open, onToggle: () => { spy(); setTimeout(() => setOpen((v) => !v), 50); } }, "Controlled");
  }
  const deferredRun = async (el: ReactNode, navigate: () => void) => {
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/page#ctl");
      render(el);
      navigate();
      await act(async () => { vi.advanceTimersByTime(60); });
    } finally {
      vi.useRealTimers();
    }
  };

  it.each([["plain", false], ["StrictMode", true]] as const)("%s: a hashchange to another anchor before the open commits: it opens, asked ONCE, and does NOT scroll", async (_n, isStrict) => {
    const spy = vi.fn();
    const el = createElement(Deferred, { spy });
    await deferredRun(isStrict ? strict(el) : el, () => setHash("#other"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls).toEqual([]);
  });

  it("the new hash names ANOTHER section: that one opens and is scrolled to once; the deferred one opens later without a jump", async () => {
    const spy = vi.fn();
    const el = createElement("div", null, createElement(Deferred, { spy }), section({ anchorId: "b" }, "Bee"));
    await deferredRun(el, () => setHash("#b"));
    expect(header("Bee").getAttribute("aria-expanded")).toBe("true");
    expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(scrolls).toEqual([{ id: "b", openAtScroll: true }]);
  });

  it("a pushState that keeps the hash but changes the query (no hashchange): no stale scroll, one toggle", async () => {
    const spy = vi.fn();
    await deferredRun(createElement(Deferred, { spy }), () => act(() => { window.history.pushState(null, "", "/page?location=b#ctl"); }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
    expect(scrolls).toEqual([]);
  });

  it("an unmount before the deferred open commits: no scroll, no error (a guard: this also held before the change)", async () => {
    vi.useFakeTimers();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      window.history.replaceState(null, "", "/page#ctl");
      const spy = vi.fn();
      const { unmount } = render(createElement(Deferred, { spy }));
      expect(spy).toHaveBeenCalledTimes(1);
      unmount();
      await act(async () => { vi.advanceTimersByTime(60); });
      expect(scrolls).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the section's anchor changes (revealOnMount off) before the deferred open commits: the old request owes no scroll", async () => {
    // Fix round (Opus P3 #1): this is the case the effect cleanup's reset exists for. The element is the same, so
    // without the reset the old request would scroll to it under its NEW id, with no hashchange or URL change.
    function Renamed({ spy, anchorId }: { spy: () => void; anchorId: string }): ReactNode {
      const [open, setOpen] = useState(false);
      return section({ anchorId, revealOnMount: anchorId === "ctl", open, onToggle: () => { spy(); setTimeout(() => setOpen((v) => !v), 50); } }, "Controlled");
    }
    vi.useFakeTimers();
    try {
      window.history.replaceState(null, "", "/page#ctl");
      const spy = vi.fn();
      const { rerender } = render(createElement(Renamed, { spy, anchorId: "ctl" }));
      expect(spy).toHaveBeenCalledTimes(1);
      rerender(createElement(Renamed, { spy, anchorId: "renamed" }));
      await act(async () => { vi.advanceTimersByTime(60); });
      expect(header("Controlled").getAttribute("aria-expanded")).toBe("true");
      expect(scrolls).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("no navigation: the deferred open still scrolls once after it commits (A4 unchanged)", async () => {
    const spy = vi.fn();
    await deferredRun(createElement(Deferred, { spy }), () => {});
    expect(scrolls).toEqual([{ id: "ctl", openAtScroll: true }]);
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

// Digest round 3 polish (1b O1 guard): ONE reveal per navigation, history traversal included. A day reached by Back /
// Forward while the Prep tab is not shown opens when the person comes back to Prep — once.
describe("digest round 3 polish: Back / Forward to a Prep day while on another tab", () => {
  const PAGE = "/admin/catering/prep-demand?location=a&tab=prep";
  const expanded = (date: string) => document.getElementById(`prep-day-${date}`)?.querySelector("button")?.getAttribute("aria-expanded") ?? null;
  /** A REAL history traversal: the browser's own hashchange, awaited. */
  const traverse = async (go: () => void) => {
    const fired = new Promise<void>((resolve) => window.addEventListener("hashchange", () => resolve(), { once: true }));
    await act(async () => { go(); await fired; });
  };
  const run = async (isStrict: boolean) => {
    // History: [#day-27, #day-28]; the page is on #day-28 (pushed), so Back goes to day 27.
    window.history.replaceState(null, "", `${PAGE}#prep-day-2026-11-27`);
    window.history.pushState(null, "", `${PAGE}#prep-day-2026-11-28`);
    const el = prepDemand("prep");
    render(isStrict ? createElement(StrictMode, null, el) : el);
    expect(expanded("2026-11-28")).toBe("true");
    const first = scrolls.length;
    expect(scrolls.at(-1)).toEqual({ id: "prep-day-2026-11-28", openAtScroll: true });
    fireEvent.click(screen.getByRole("tab", { name: /SKU/i }));
    await traverse(() => window.history.back());
    expect(window.location.hash).toBe("#prep-day-2026-11-27");
    expect(screen.getByRole("tab", { name: /SKU/i }).getAttribute("aria-selected")).toBe("true"); // Back alone keeps the tab
    fireEvent.click(screen.getAllByRole("tab")[0]!);
    expect(expanded("2026-11-27")).toBe("true"); // the day Back went to opens
    expect(expanded("2026-11-28")).toBe("false"); // the earlier day is at its default (5 days start closed)
    expect(scrolls.slice(first)).toEqual([{ id: "prep-day-2026-11-27", openAtScroll: true }]); // scrolled ONCE
    // A second tab round trip with the URL untouched: no re-open, no second jump.
    fireEvent.click(document.querySelector(`#prep-day-2026-11-27 button`)!); // the person closes it
    fireEvent.click(screen.getByRole("tab", { name: /SKU/i }));
    fireEvent.click(screen.getAllByRole("tab")[0]!);
    expect(expanded("2026-11-27")).toBe("false");
    expect(scrolls.slice(first)).toHaveLength(1);
    // Forward again, this time while on Prep: the section's own listener reveals day 28.
    await traverse(() => window.history.forward());
    expect(expanded("2026-11-28")).toBe("true");
    expect(scrolls.slice(first)).toEqual([{ id: "prep-day-2026-11-27", openAtScroll: true }, { id: "prep-day-2026-11-28", openAtScroll: true }]);
  };

  it("plain", async () => { await run(false); });
  it("StrictMode", async () => { await run(true); });
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
