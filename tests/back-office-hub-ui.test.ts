// @vitest-environment jsdom
/**
 * Nav PR 4 (plan r2, 7.5 with amendment A2): the Back office's disclosures in a browser DOM.
 *  - a closed group opens and closes on its header; aria-expanded / aria-controls are set (D10); a row is one <a>;
 *  - nothing is stored (D9): no localStorage or sessionStorage write;
 *  - System status opens when the page loads with #system-status, and on a hashchange to it;
 *  - A2: every tap on a fix link opens System status, including a second tap with the same hash after the person
 *    closed it by hand (no hashchange fires then);
 *  - CollapsibleSection's new `description` renders inside the button; a caller without it renders as before.
 */
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackOfficeHub } from "@/components/admin/back-office/BackOfficeHub";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { FIXTURES } from "./fixtures/back-office-hub";

// The retry panel needs the admin layout's providers (translation, step-up, router); it has its own tests.
vi.mock("@/components/admin/InboundSettings", () => ({ InboundHealthPanel: () => null }));

const hub = (name: keyof typeof FIXTURES, lang: "en" | "es" = "en") => render(createElement(BackOfficeHub, { view: FIXTURES[name]!(lang) }));
const header = (name: string | RegExp) => screen.getByRole("button", { name });
const systemStatus = () => header(/^System status/);

let setItem: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.history.replaceState(null, "", "/admin");
  setItem = vi.spyOn(Storage.prototype, "setItem");
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("groups", () => {
  it("a closed group's header shows its rows, and hides them again; aria-expanded and aria-controls are set", () => {
    hub("gm-issue");
    const ordering = header(/^Ordering and stock/);
    expect(ordering.getAttribute("aria-expanded")).toBe("false");
    expect(ordering.getAttribute("aria-controls")).toBe("backoffice-ordering-and-stock");
    expect(document.getElementById("backoffice-ordering-and-stock")).toBeNull();
    fireEvent.click(ordering);
    expect(ordering.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById("backoffice-ordering-and-stock")!;
    expect(within(panel).getByRole("link", { name: /Vendors/ }).getAttribute("href")).toBe("/admin/vendors");
    fireEvent.click(ordering);
    expect(document.getElementById("backoffice-ordering-and-stock")).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("every row is one link: the whole row (name, line, badge, chevron) is the tap target", () => {
    hub("gm-issue");
    const recipes = document.querySelector('[data-backoffice-row="recipes"]')!;
    expect(recipes.tagName).toBe("A");
    expect(recipes.querySelectorAll("a")).toHaveLength(0);
    expect(recipes.textContent).toContain("Recipes");
    expect(recipes.textContent).toContain("How we make things.");
    expect(recipes.textContent).toContain("3 not ready");
    expect(recipes.querySelector('[aria-label="Step 4"]')).not.toBeNull();
  });

  it("the first two groups are open, a group's count and its issue badge show while it is closed", () => {
    hub("gm-issue");
    expect(header(/^People and schedule/).getAttribute("aria-expanded")).toBe("true");
    expect(header(/^Menu and recipes/).getAttribute("aria-expanded")).toBe("true");
    expect(header(/^Ordering and stock/).textContent).toContain("7 pages");
    expect(header(/^Menu and recipes/).textContent).toContain("2 issues");
  });
});

describe("System status (A2)", () => {
  it("is closed by default", () => {
    hub("moo-all");
    expect(systemStatus().getAttribute("aria-expanded")).toBe("false");
  });

  it("opens when the page loads with #system-status", () => {
    window.history.replaceState(null, "", "/admin#system-status");
    hub("moo-all");
    expect(systemStatus().getAttribute("aria-expanded")).toBe("true");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("opens on a hashchange to #system-status", () => {
    hub("moo-all");
    act(() => {
      window.history.replaceState(null, "", "/admin#system-status");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(systemStatus().getAttribute("aria-expanded")).toBe("true");
  });

  it("a fix link opens it; closed by hand, the same link opens it again (no hashchange fires on a same-hash tap)", () => {
    hub("moo-all");
    fireEvent.click(header(/^Needs attention/));
    const fix = screen.getByRole("link", { name: "Sales pull" });
    expect(fix.getAttribute("href")).toBe("#system-status");
    fireEvent.click(fix);
    expect(systemStatus().getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(systemStatus());
    expect(systemStatus().getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fix);
    expect(systemStatus().getAttribute("aria-expanded")).toBe("true");
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("CollapsibleSection's description", () => {
  it("renders inside the header button, under the title", () => {
    // eslint-disable-next-line react/no-children-prop -- a .ts test: the typed props require children
    render(createElement(CollapsibleSection, { idBase: "x", title: "Title", description: "One line.", children: "body" }));
    expect(header(/^Title/).textContent).toContain("One line.");
  });

  it("a caller without it renders exactly as before", () => {
    // eslint-disable-next-line react/no-children-prop -- a .ts test: the typed props require children
    const html = renderToStaticMarkup(createElement(CollapsibleSection, { idBase: "x", title: "T", count: "3", children: "b" }));
    expect(html).toBe('<section class="co-card p-0"><button type="button" aria-expanded="false" aria-controls="x" id="«R0»" class="flex min-h-[44px] w-full items-center justify-between gap-3 px-4 py-3 text-left"><span class="flex flex-wrap items-center gap-2"><span class="text-sm font-bold text-co-text">T</span><span class="text-xs text-co-text-muted">3</span></span><span aria-hidden="true" class="text-xs text-co-text-dim">▸</span></button></section>'.replace("«R0»", html.match(/id="([^"]+)"/)![1]!));
  });
});
