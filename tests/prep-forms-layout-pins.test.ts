import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// B1 (guide-testing triage 2026-10-13) source pins for the prep forms.
// #1 — on a phone the mid-day Phase 2 Sauces rows pushed SAVE / FINALIZE off-screen:
// `<main class="mx-auto …">` is a flex child of `body.flex-col`, so the auto margin turned
// off stretch and main sized to its widest nowrap line ("Uses: …"). The inputs were 14 px,
// which makes iOS Safari / Chromium mobile zoom on focus.

const read = (p: string) => readFileSync(p, "utf8");

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

/** Every `<main className="…">` class string in a source file. */
function mainClasses(src: string): string[] {
  return Array.from(src.matchAll(/<main\s+className="([^"]*)"/g), (m) => m[1]!);
}

/** Class strings of every `<input …>` element (template-literal or string className). */
function inputClasses(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<input\b[\s\S]*?\/>/g)) {
    const cls = /className=(?:"([^"]*)"|\{?`([^`]*)`\}?)/.exec(m[0]);
    if (cls) out.push((cls[1] ?? cls[2] ?? "").replace(/\s+/g, " "));
  }
  return out;
}

describe("#1 operations mains fill the viewport width", () => {
  const files = filesUnder("app/(authed)/operations").filter((f) => /<main\s+className=/.test(read(f)));

  it("finds the operations mains (sanity)", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("every auto-margin main also carries w-full", () => {
    for (const f of files) {
      for (const cls of mainClasses(read(f))) {
        if (/\bmx-auto\b/.test(cls)) expect(`${f}: ${cls}`).toMatch(/\bw-full\b/);
      }
    }
  });

  it("both mid-day mains carry w-full", () => {
    const mains = mainClasses(read("app/(authed)/operations/mid-day/page.tsx"));
    expect(mains.length).toBe(2);
    for (const cls of mains) expect(cls).toMatch(/\bw-full\b/);
  });
});

describe("#1 the long consumption line cannot widen its row", () => {
  it("ProductionConsumptionPanel's root is min-w-0", () => {
    const src = read("components/production/ProductionConsumptionPanel.tsx");
    const root = /return \(\s*<div className="([^"]*)"/.exec(src.slice(src.indexOf("const summaryParts")));
    expect(root?.[1]).toMatch(/\bmin-w-0\b/);
  });

  it("the mid-day Phase 2 row <li> is min-w-0", () => {
    const src = read("components/MidDayPhase2Form.tsx");
    const li = /<li\s+key=\{it\.id\}\s+className="([^"]*)"/.exec(src);
    expect(li?.[1]).toMatch(/\bmin-w-0\b/);
  });
});

describe("#1 number inputs are 16 px (no focus zoom on phones)", () => {
  for (const f of [
    "components/MidDayPhase1Form.tsx",
    "components/MidDayPhase2Form.tsx",
    "components/production/ProductionConsumptionPanel.tsx",
  ]) {
    it(`${f}: no input is text-sm`, () => {
      const classes = inputClasses(read(f));
      expect(classes.length).toBeGreaterThan(0);
      for (const cls of classes) {
        expect(cls).not.toMatch(/\btext-sm\b/);
        expect(cls).toMatch(/\btext-base\b/);
      }
    });
  }
});
