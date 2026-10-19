import { describe, expect, it } from "vitest";
import { resolveLandingLanguage, landingLanguageHref } from "@/lib/landing/language-shared";

describe("anonymous landing language", () => {
  it.each([["es","en-US","es"],["en","es","en"],[null,"es-MX, en;q=0.8","es"],["fr","en-US","en"],[undefined,null,"en"],[['es','en'],"en","en"]])("resolves %j with %j", (query, header, expected) => {
    expect(resolveLandingLanguage(query,header as string|null)).toBe(expected);
  });
  it("toggle preserves only approved attribution and removes arbitrary data", () => {
    const href = landingLanguageHref("es", new URLSearchParams("ad=subsim-photo&email=private%40example.com&utm_source=facebook&lang=en"), {ads:["subsim-photo"]});
    expect(href).toContain("lang=es");
    expect(href).toContain("ad=subsim-photo");
    expect(href).not.toContain("email");
  });
});

it('toggle retains only the request-resolved campaign, not stale configured seeds',()=>{
 expect(landingLanguageHref('es',new URLSearchParams('ad=new-campaign'),{ads:['new-campaign']})).toContain('ad=new-campaign');
 expect(landingLanguageHref('es',new URLSearchParams('ad=subsim-photo'))).not.toContain('ad=');
});
