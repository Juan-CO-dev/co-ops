import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// B3 source-shape pins: #53 (floating user button) and #54 (language save).
const layout = readFileSync("app/(authed)/layout.tsx", "utf8");
const userMenu = readFileSync("components/UserMenu.tsx", "utf8");
const langCard = readFileSync("components/settings/LanguageSettingCard.tsx", "utf8");

/** Strip comments so prose describing the old class can't trip a pin. */
function code(src: string): string {
  return src.replace(/\/\*[^]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("#53 the user menu is in-flow, not a floating overlay", () => {
  it("the (authed) layout no longer fixes the menu to the top-right", () => {
    const c = code(layout);
    expect(c).not.toMatch(/fixed\s+top-4\s+right-4/);
    expect(c).not.toMatch(/\bfixed\b/);
  });

  it("renders UserMenu in its own flex row above the page children", () => {
    const c = code(layout);
    expect(c).toMatch(/<div className="relative z-30 flex justify-end px-4 pt-3 sm:px-6">\s*<UserMenu/);
    expect(c.indexOf("<UserMenu")).toBeLessThan(c.indexOf("{children}"));
  });

  it("keeps the dropdown above sticky bars (z-30 row, absolute panel)", () => {
    expect(userMenu).toMatch(/absolute right-0 top-12 z-30/);
  });

  it("the trigger stays a sized-both-axes, centred 44px control", () => {
    expect(userMenu).toMatch(/inline-flex h-11 w-11 items-center justify-center rounded-full/);
  });
});

describe("#54 a language save refreshes server-rendered strings", () => {
  for (const [name, src] of [
    ["UserMenu", userMenu],
    ["LanguageSettingCard", langCard],
  ] as const) {
    it(`${name} calls router.refresh() right after setLanguage(next)`, () => {
      expect(src).toMatch(/useRouter/);
      expect(code(src)).toMatch(/setLanguage\(next\);\s*router\.refresh\(\);/);
    });
  }
});
