import { describe, expect, it } from "vitest";
import { resolveLandingLanguage, landingLanguageHref } from "@/lib/landing/language-shared";

describe("anonymous landing language", () => {
  it.each([["es","en-US","es"],["en","es","en"],[null,"es-MX, en;q=0.8","es"],["fr","en-US","en"],[undefined,null,"en"],[['es','en'],"en","en"]])("resolves %j with %j", (query, header, expected) => {
    expect(resolveLandingLanguage(query,header as string|null)).toBe(expected);
  });
  it("toggle preserves only approved attribution and removes arbitrary data", () => {
    const href = landingLanguageHref("es", new URLSearchParams("ad=subsim-photo&email=private%40example.com&utm_source=facebook&lang=en"));
    expect(href).toContain("lang=es");
    expect(href).toContain("ad=subsim-photo");
    expect(href).not.toContain("email");
  });
});
