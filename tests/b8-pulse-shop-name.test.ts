import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// B8 #9 (sim walk 2026-10-14): Mid-Shift Pulse named its shop only for single-shop viewers, so
// someone working at two shops saw no shop name in the header (only a tinted tab).
// The name is read from the locations rows the page already loaded — no literals.

describe("B8 #9 Pulse names the shop it shows", () => {
  it("v2 (PulseHome) shows code · name whenever one shop is on screen", () => {
    const src = readFileSync("components/pulse/PulseHome.tsx", "utf8");
    expect(src).toContain('{!both && <span className="text-sm font-semibold text-co-text-muted">{shops[0]!.code} &middot; {shops[0]!.name}</span>}');
    expect(src).not.toMatch(/accessible\.length === 1 &&/);
  });
  it("v1 (mid-shift page) does the same", () => {
    const src = readFileSync("app/(authed)/mid-shift/page.tsx", "utf8");
    expect(src).toMatch(/\{loc && \(\s*<span className="text-sm font-semibold text-co-text-muted">\s*\{loc\.code\} &middot; \{loc\.name\}/);
    expect(src).not.toMatch(/loc && accessible\.length === 1/);
  });
});
