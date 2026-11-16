// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { TranslationProvider } from "@/lib/i18n/provider";

// W27 / B228: the catering inbox mounted a second provider inside the (authed) layout's, and every provider's unmount
// hardcoded <html lang="en"> — so leaving the inbox told screen readers the still-Spanish page was English.
afterEach(() => { cleanup(); document.documentElement.lang = ""; });

const tree = (inner: boolean, outerLang: "en" | "es" = "es") => createElement(TranslationProvider, {
  initialLanguage: outerLang,
  children: inner ? createElement(TranslationProvider, { initialLanguage: "es", children: "inner" as ReactNode }) : "outer",
});

describe("<html lang> with nested providers", () => {
  it("unmounting a nested provider keeps the outer language", () => {
    const r = render(tree(true));
    expect(document.documentElement.lang).toBe("es");
    r.rerender(tree(false));
    expect(document.documentElement.lang).toBe("es");
    r.unmount();
    expect(document.documentElement.lang).toBe("en");
  });

  it("an inner provider's language shows while it is mounted, the outer's after it leaves", () => {
    const r = render(tree(true, "en"));
    expect(document.documentElement.lang).toBe("es");
    r.rerender(tree(false, "en"));
    expect(document.documentElement.lang).toBe("en");
  });

  it("the catering inbox page mounts no provider of its own (the (authed) layout owns it)", () => {
    expect(readFileSync("app/(authed)/catering/inbox/page.tsx", "utf8")).not.toMatch(/import \{[^}]*TranslationProvider/);
  });
});
