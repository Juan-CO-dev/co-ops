import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// B3 source-shape pins: #53 (the floating user button) and #54 (language save). Nav PR 9: the user menu is gone; the
// top bar (components/nav/NavFrame → NavShell) is the global chrome in BOTH layouts, and these pins moved to it.
const authedLayout = readFileSync("app/(authed)/layout.tsx", "utf8");
const adminLayout = readFileSync("app/admin/layout.tsx", "utf8");
const shell = readFileSync("components/nav/NavShell.tsx", "utf8");
const goTo = readFileSync("components/nav/GoToButton.tsx", "utf8");
const bell = readFileSync("components/nav/BellIsland.tsx", "utf8");
const me = readFileSync("components/nav/MeControls.tsx", "utf8");
const langCard = readFileSync("components/settings/LanguageSettingCard.tsx", "utf8");

/** Strip comments so prose describing the old class can't trip a pin. */
function code(src: string): string {
  return src.replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[^]*?\*\/\}/g, "");
}

describe("#53 the global chrome is in-flow, never a floating overlay", () => {
  it.each([["(authed)", authedLayout], ["admin", adminLayout]])("the %s layout fixes nothing (the admin menu stopped floating)", (_n, src) => {
    const c = code(src);
    expect(c).not.toMatch(/fixed\s+top-4\s+right-4/);
    expect(c).not.toMatch(/\bfixed\b/);
    expect(c).not.toMatch(/UserMenu/);
  });

  it.each([["(authed)", authedLayout], ["admin", adminLayout]])("the %s layout wraps the page in NavFrame (the bar before the page)", (_n, src) => {
    const c = code(src);
    const open = c.indexOf("<NavFrame");
    const close = c.indexOf("</NavFrame>");
    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(c.indexOf("{children}"));
    expect(c.indexOf("{children}")).toBeLessThan(close);
  });

  it("the bar row renders before the page children, with no fixed, sticky, z-index, transform or filter", () => {
    const c = code(shell);
    const row = c.match(/<nav aria-label=\{t\("nav\.topbar\.aria"\)\}[^>]*className="([^"]+)"/);
    expect(row).not.toBeNull();
    expect(row![1]).not.toMatch(/\b(fixed|sticky|absolute)\b|\bz-|transform|filter|backdrop/);
    expect(row![1]).toMatch(/min-h-\[44px\] items-center/);
    expect(c.indexOf("<nav aria-label")).toBeLessThan(c.indexOf("{children}"));
  });

  it("the triggers stay centred 44px controls (the bell sized on both axes)", () => {
    expect(goTo).toMatch(/inline-flex h-11 min-w-11 items-center justify-center/);
    expect(bell).toMatch(/relative inline-flex h-11 w-11 items-center justify-center rounded-full/);
  });
});

describe("#54 a language save refreshes server-rendered strings", () => {
  for (const [name, src] of [
    ["MeControls (Go to's Me)", me],
    ["LanguageSettingCard", langCard],
  ] as const) {
    it(`${name} calls router.refresh() right after setLanguage(next)`, () => {
      expect(src).toMatch(/useRouter/);
      expect(code(src)).toMatch(/setLanguage\(next\);\s*router\.refresh\(\);/);
    });
  }
});
