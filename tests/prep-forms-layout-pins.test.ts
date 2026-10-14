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

describe("#3/#4 quantities render through the prep display helpers", () => {
  const opening = read("components/opening/OpeningPrepEntry.tsx");
  const p1 = read("components/MidDayPhase1Form.tsx");
  const p2 = read("components/MidDayPhase2Form.tsx");

  it("opening par / closer count / prep need never print a raw `${n} ${parUnit}`", () => {
    expect(opening).toContain("formatPrepQty(parValue, parUnit)");
    expect(opening).toContain("prepQtyParts(groundTruth, parUnit)");
    expect(opening).toContain("prepQtyParts(prepNeed, parUnit)");
    expect(opening).not.toMatch(/\$\{parValue\}\$\{parUnit/);
    expect(opening).not.toMatch(/\{(groundTruth|prepNeed)\}\s*\{parUnit \?/);
  });

  it("the over/under prompts round their delta for display (#4)", () => {
    expect(opening.match(/over_prep", \{ delta: roundQty\(overDelta\) \}/g)?.length).toBe(2);
    expect(opening.match(/under_prep", \{ delta: roundQty\(underDelta\) \}/g)?.length).toBe(2);
    expect(opening).not.toMatch(/delta: (over|under)Delta \}/);
  });

  it("mid-day par / need lines go through formatPrepQty", () => {
    for (const src of [p1, p2]) {
      expect(src).toMatch(/formatPrepQty\(it\.parValue, it\.parUnit\)/);
      expect(src).not.toMatch(/it\.parUnit \? ` \$\{it\.parUnit\}`/);
    }
    expect(p1).toContain("formatPrepQty(need, it.parUnit)");
    expect(p2).toContain("formatPrepQty(it.need, it.parUnit)");
  });
});

describe("#5 the opening prep box keeps what was typed", () => {
  const opening = read("components/opening/OpeningPrepEntry.tsx");
  const body = opening.slice(opening.indexOf("function NumericInput("));

  it("renders a local draft parsed by parseDecimalDraft, not String(value)", () => {
    expect(body).toContain("const [draft, setDraft] = useState(");
    expect(body).toContain("value={draft}");
    expect(body).toContain("parseDecimalDraft(raw)");
    expect(body).not.toContain("String(value)}");
  });

  it("re-syncs from the prop during render (prev-compare), never in an effect", () => {
    expect(body).toMatch(/if \(value !== prevValue\) \{\s*setPrevValue\(value\);/);
    expect(body).not.toMatch(/useEffect/);
  });

  it("says so when the text is not a number", () => {
    expect(body).toContain("{invalidHint}");
    expect(opening).toContain('invalidHint={t("opening.phase2.numbers_only")}');
  });
});
