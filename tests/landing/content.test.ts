import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const read = (path:string) => readFileSync(path,"utf8");
describe("landing content and progressive enhancement contracts", () => {
  it("ships nonempty distinct translations for every landing label", () => {
    const entries = Object.entries(en).filter(([key]) => key.startsWith("landing."));
    expect(entries.length).toBeGreaterThan(25);
    for (const [key,value] of entries) {
      const translated = (es as Record<string,string>)[key];
      expect(translated, key).toBeTruthy();
      expect(translated, key).not.toBe(value);
    }
  });
  it("starts Reveal visible and never hides content without an observer", () => {
    const source = read("components/portal/Reveal.tsx");
    expect(source).toContain("useState(true)");
    expect(source).toContain('typeof IntersectionObserver === "undefined"');
    expect(source).toContain("prefers-reduced-motion");
  });
  it("uses native FAQ disclosure operable without JavaScript", () => {
    const source = read("components/portal/FaqItem.tsx");
    expect(source).toContain("<details");
    expect(source).toContain("<summary");
    expect(source).toContain("min-h-11");
    expect(source).toContain("items-center");
  });
  it("retains all known Reveal consumers and the separate staff vault boundary", () => {
    for (const path of ["app/order/page.tsx","app/order/review/page.tsx","components/portal/StorefrontOrderTray.tsx","components/portal/StorefrontPackages.tsx"]) expect(read(path)).toContain("Reveal");
    expect(read("app/(authed)/vault/vault-client.tsx")).toContain("@/components/vault/SecretReveal");
    expect(read("app/(authed)/vault/vault-client.tsx")).not.toContain("@/components/portal/Reveal");
  });
});
