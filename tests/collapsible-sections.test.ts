/**
 * Wave 1 B - collapsible checklist sections. Pure logic + SSR markup of the shared
 * wrapper (the vitest spine runs in node: no DOM, no hook runtime). Interactive
 * wiring (toggle writes storage, reveal opens) is covered through the pure helpers
 * the hook is a thin shell over.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  applyStoredOpen,
  collapseStorageKey,
  defaultOpenMap,
  getBrowserStorage,
  isSectionFinished,
  readStoredOpen,
  revealOpenMap,
  scrollSectionIntoView,
  sectionDomKey,
  toggledOpen,
  unfinishedSectionIds,
  writeStoredOpen,
  type StorageLike,
} from "@/lib/collapsible-sections";
import { CollapsibleChecklistSection } from "@/components/ui/CollapsibleChecklistSection";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const data = { ...seed };
  return {
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const throwingStorage: StorageLike = {
  getItem() {
    throw new Error("SecurityError: storage blocked");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("done-count + initial-open rule", () => {
  it("a section is finished when done >= total (empty counts as finished)", () => {
    expect(isSectionFinished({ done: 8, total: 8 })).toBe(true);
    expect(isSectionFinished({ done: 3, total: 8 })).toBe(false);
    expect(isSectionFinished({ done: 0, total: 0 })).toBe(true);
  });

  it("opens ONLY the first unfinished section; finished and later ones collapse", () => {
    const m = defaultOpenMap([
      { id: "veg", done: 5, total: 5 },
      { id: "sauces", done: 1, total: 4 },
      { id: "cooks", done: 0, total: 6 },
    ]);
    expect(m).toEqual({ veg: false, sauces: true, cooks: false });
  });

  it("collapses everything when everything is finished", () => {
    expect(
      defaultOpenMap([
        { id: "a", done: 2, total: 2 },
        { id: "b", done: 1, total: 1 },
      ]),
    ).toEqual({ a: false, b: false });
  });

  it("unfinishedSectionIds lists the sections a refused submit should open", () => {
    expect(
      unfinishedSectionIds([
        { id: "a", done: 2, total: 2 },
        { id: "b", done: 0, total: 3 },
        { id: "c", done: 2, total: 3 },
      ]),
    ).toEqual(["b", "c"]);
  });
});

describe("toggle + remembered state", () => {
  it("toggledOpen flips open/closed and treats a missing id as closed", () => {
    expect(toggledOpen({ a: true }, "a")).toBe(false);
    expect(toggledOpen({ a: false }, "a")).toBe(true);
    expect(toggledOpen({}, "zzz")).toBe(true);
  });

  it("keys by form + section", () => {
    expect(collapseStorageKey("am-prep", "veg")).not.toBe(
      collapseStorageKey("closing", "veg"),
    );
    expect(collapseStorageKey("am-prep", "veg")).not.toBe(
      collapseStorageKey("am-prep", "cooks"),
    );
  });

  it("round-trips through storage and overrides the computed default", () => {
    const st = memoryStorage();
    writeStoredOpen(st, collapseStorageKey("closing", "Walk-Out"), true);
    writeStoredOpen(st, collapseStorageKey("closing", "Front"), false);
    const base = { Front: true, "Walk-Out": false, Other: true };
    expect(
      applyStoredOpen(base, "closing", ["Front", "Walk-Out", "Other"], st),
    ).toEqual({
      Front: false,
      "Walk-Out": true,
      Other: true,
    });
  });

  it("ignores garbage values", () => {
    const st = memoryStorage({ [collapseStorageKey("f", "s")]: "maybe" });
    expect(readStoredOpen(st, collapseStorageKey("f", "s"))).toBeUndefined();
  });
});

describe("storage that throws or is blocked", () => {
  it("read returns undefined, write does not throw, defaults stand", () => {
    expect(readStoredOpen(throwingStorage, "k")).toBeUndefined();
    expect(() => writeStoredOpen(throwingStorage, "k", true)).not.toThrow();
    const base = { a: true, b: false };
    expect(applyStoredOpen(base, "f", ["a", "b"], throwingStorage)).toEqual(
      base,
    );
  });

  it("null storage (unavailable) is a no-op both ways", () => {
    expect(readStoredOpen(null, "k")).toBeUndefined();
    expect(() => writeStoredOpen(null, "k", false)).not.toThrow();
  });

  it("getBrowserStorage returns null when touching window.localStorage throws", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(getBrowserStorage()).toBeNull();
  });

  it("getBrowserStorage returns null on the server (no window)", () => {
    expect(getBrowserStorage()).toBeNull();
  });
});

describe("open-on-error", () => {
  it("revealOpenMap opens the listed sections and leaves the rest alone", () => {
    expect(revealOpenMap({ a: false, b: false, c: true }, ["b"])).toEqual({
      a: false,
      b: true,
      c: true,
    });
  });

  it("scrolls the matching section into view after the un-hide frames", () => {
    const scrollIntoView = vi.fn();
    const target = {
      getAttribute: () => sectionDomKey("am-prep", "veg"),
      scrollIntoView,
    };
    const other = {
      getAttribute: () => sectionDomKey("am-prep", "cooks"),
      scrollIntoView: vi.fn(),
    };
    vi.stubGlobal("document", { querySelectorAll: () => [other, target] });
    const frames: Array<() => void> = [];
    vi.stubGlobal("window", {
      requestAnimationFrame: (cb: () => void) => frames.push(cb),
    });
    scrollSectionIntoView("am-prep", "veg");
    // Two nested frames before the scroll runs.
    frames.shift()!();
    frames.shift()!();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(other.scrollIntoView).not.toHaveBeenCalled();
  });

  it("scrolling is safe when the DOM lookup throws", () => {
    vi.stubGlobal("document", {
      querySelectorAll: () => {
        throw new Error("boom");
      },
    });
    const frames: Array<() => void> = [];
    vi.stubGlobal("window", {
      requestAnimationFrame: (cb: () => void) => frames.push(cb),
    });
    scrollSectionIntoView("f", "s");
    frames.shift()!();
    expect(() => frames.shift()!()).not.toThrow();
  });
});

describe("CollapsibleChecklistSection markup", () => {
  function render(
    open: boolean,
    language: "en" | "es" = "en",
    done = 3,
    total = 8,
  ) {
    return renderToStaticMarkup(
      createElement(TranslationProvider, {
        initialLanguage: language,
        children: createElement(CollapsibleChecklistSection, {
          formKey: "am-prep",
          sectionId: "veg",
          title: "Veg",
          done,
          total,
          open,
          onToggle: () => {},
          children: createElement("input", { id: "child-input" }),
        }),
      }),
    );
  }

  it("renders a >=44px button with aria-expanded + aria-controls pointing at the panel", () => {
    const html = render(true);
    const btn = /<button[^>]*>/.exec(html)![0];
    expect(btn).toContain('aria-expanded="true"');
    expect(btn).toContain("min-h-[44px]");
    const controls = /aria-controls="([^"]+)"/.exec(btn)![1]!;
    expect(html).toContain(`id="${controls}"`);
  });

  it("closed: aria-expanded false, panel hidden, children STAY mounted", () => {
    const html = render(false);
    expect(html).toContain('aria-expanded="false"');
    expect(/<div[^>]*role="region"[^>]*hidden/.test(html)).toBe(true);
    expect(html).toContain('id="child-input"');
  });

  it("shows the done count in English and Spanish", () => {
    expect(render(true, "en", 3, 8)).toContain("3 of 8 done");
    expect(render(true, "es", 3, 8)).toContain("3 de 8 listos");
  });

  it("marks the section for scroll-into-view lookup", () => {
    expect(render(true)).toContain(
      `data-collapsible-section="${sectionDomKey("am-prep", "veg")}"`,
    );
  });

  it("hides the progress line when a section has no items", () => {
    expect(render(true, "en", 0, 0)).not.toContain("data-section-progress");
  });
});

describe("i18n parity", () => {
  it("both languages carry the new keys", () => {
    for (const key of [
      "checklist.section.progress",
      "checklist.section.show_problems",
    ] as const) {
      expect(en[key]).toBeTruthy();
      expect((es as Record<string, string>)[key]).toBeTruthy();
    }
  });
});

describe("review fixes (PR 384)", () => {
  function renderHeading(level?: 2 | 3) {
    return renderToStaticMarkup(
      createElement(TranslationProvider, {
        initialLanguage: "en",
        children: createElement(CollapsibleChecklistSection, {
          formKey: "f",
          sectionId: "s",
          title: "T",
          done: 1,
          total: 2,
          open: true,
          onToggle: () => {},
          headingLevel: level,
          headerExtras: createElement("button", { id: "extra" }),
          children: null,
        }),
      }),
    );
  }

  it("puts the toggle button INSIDE a heading at the requested level, extras beside it", () => {
    for (const [lvl, tag] of [[2, "h2"], [3, "h3"], [undefined, "h3"]] as const) {
      const html = renderHeading(lvl);
      const start = html.indexOf("<" + tag + " ");
      const end = html.indexOf("</" + tag + ">");
      const m = [null, html.slice(start, end)];
      expect(m[1]!).toContain("<button");
      expect(m[1]!).not.toContain('id="extra"');
      expect(html).toContain('id="extra"');
    }
  });

  it("opening: ticked with a missing count is NOT done; the station stays open", async () => {
    const { openingStationProgress } = await import("@/components/opening/OpeningVerificationStation");
    const items = [
      { id: "a", expectsCount: true, prepMeta: null },
      { id: "b", expectsCount: false, prepMeta: null },
    ] as never;
    const v = (ticked: boolean, countValue: number | null) => ({
      ticked,
      countValue,
      photoId: null,
      notes: null,
      openerRecount: null,
    });
    const snaps = new Map() as never;
    const ver = new Map<string, boolean>();
    const noCount = new Map([["a", v(true, null)], ["b", v(true, null)]]);
    const p1 = openingStationProgress("S", items, noCount, snaps, ver, false);
    expect(p1).toEqual({ id: "S", done: 1, total: 2 });
    const withCount = new Map([["a", v(true, 38)], ["b", v(true, null)]]);
    expect(openingStationProgress("S", items, withCount, snaps, ver, false).done).toBe(2);
    // collapsed invalid station: the problem list names it and reveal opens it.
    const collapsed = defaultOpenMap([
      { id: "first", done: 0, total: 1 },
      p1,
    ]);
    expect(collapsed.S).toBe(false);
    const ids = unfinishedSectionIds([{ id: "first", done: 1, total: 1 }, p1]);
    expect(ids).toEqual(["S"]);
    expect(revealOpenMap(collapsed, ids).S).toBe(true);
  });
});
