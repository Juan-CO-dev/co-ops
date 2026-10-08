import { describe, expect, it } from "vitest";
import { FONT_STACK, renderEmailLayout } from "@/lib/email-templates/_layout";

// Digest polish item 8: "Segoe UI" in double quotes inside the double-quoted body style attribute
// ended the attribute early, so the font stack never applied in ANY email.
describe("email layout font stack", () => {
  const html = renderEmailLayout({
    preheader: "p", heading: "h", bodyHtml: "<p>b</p>",
    cta: { label: "Go", url: "https://example.test/x" }, footerNote: "f",
  });

  it("the stack carries no double quote, so it is safe inside a style attribute", () => {
    expect(FONT_STACK).not.toContain('"');
    expect(FONT_STACK).toContain("'Segoe UI'");
  });

  it("the body style attribute holds the WHOLE stack (it is not cut short)", () => {
    const body = /<body style="([^"]*)">/.exec(html);
    expect(body).not.toBeNull();
    expect(body![1]).toContain(`font-family:${FONT_STACK};`);
    expect(body![1]).toContain("Roboto, sans-serif");
  });

  it("no attribute is cut short by the stack (no stray fragment after a closing quote)", () => {
    expect(html).not.toMatch(/Segoe UI"/);
    // A cut attribute leaves `", Roboto` style debris between attributes.
    expect(html).not.toMatch(/"\s*,\s*Roboto/);
  });
});
