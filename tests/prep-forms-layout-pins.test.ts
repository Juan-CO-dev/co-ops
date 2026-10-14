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

describe("#6 no-par rows say so instead of 'verify section first'", () => {
  it("the null prep-need branch asks prepNeedLabel and has a no-par line", () => {
    const opening = read("components/opening/OpeningPrepEntry.tsx");
    expect(opening).toMatch(/prepNeedLabel\(\{ parValue, groundTruth \}\) === "no_par"\s*\?\s*t\("opening\.phase2\.prep_need_no_par"\)/);
  });
});

describe("#8 Phase 2 section headers are a static Verified chip", () => {
  const opening = read("components/opening/OpeningPrepEntry.tsx");
  it("OpeningPrepEntry (Phase 2 only) does not render OpeningSectionVerify or take a toggle", () => {
    expect(opening).not.toMatch(/OpeningSectionVerify/);
    expect(opening).not.toMatch(/onSectionVerifyToggle/);
    expect(opening).not.toMatch(/sectionDisabledMap/);
    expect(opening).toContain('t("opening.section_verify.verified_button")');
  });
  it("opening-client no longer hands Phase 2 a verify toggle (Phase 1 still has it)", () => {
    const client = read("app/(authed)/operations/opening/opening-client.tsx");
    const prep = client.slice(client.indexOf("<OpeningPrepEntry"), client.indexOf("/>", client.indexOf("<OpeningPrepEntry")));
    expect(prep).not.toContain("onSectionVerifyToggle");
    const station = client.slice(client.indexOf("<OpeningVerificationStation"), client.indexOf("/>", client.indexOf("<OpeningVerificationStation")));
    expect(station).toContain("onSectionVerifyToggle={handleSectionVerifyToggle}");
  });
});

describe("#9 recount boxes are red only while empty", () => {
  const item = read("components/opening/OpeningChecklistItem.tsx");
  it("needsRecount folds in the entered recount (both boxes on a batch item)", () => {
    expect(item).toMatch(/const needsRecount =\s*isNullSource &&/);
    expect(item).toContain("value.openerRecount === null");
    expect(item).toContain("(value.openerRecountLine ?? null) === null || (value.openerRecountBackUp ?? null) === null");
  });
  it("no red class condition is on isNullSource alone; aria-required still is", () => {
    // every ternary that picks a red class keys off needsRecount (or a per-box empty check)
    for (const m of item.matchAll(/(\S[^\n?]*)\?\s*"[^"]*(?:border-co-cta-text|text-co-cta-text)/g)) {
      expect(m[1]).toMatch(/needsRecount|current === null|hasMissingCountError/);
    }
    expect(item.match(/aria-required=\{isNullSource\}/g)?.length).toBe(2);
  });
});

describe("#7 the opening title follows the active tab", () => {
  it("the header branches on activePhase for the title and the subtitle", () => {
    const client = read("app/(authed)/operations/opening/opening-client.tsx");
    expect(client).toContain('{activePhase === "prep" ? t("opening.phase.tab_phase2") : t("opening.page.title")}');
    expect(client).toContain('{activePhase === "prep" ? t("opening.page.subtitle_phase2") : t("opening.page.subtitle")}');
  });
  it("the scaffold header keeps the report label only", () => {
    const page = read("app/(authed)/operations/opening/page.tsx");
    const scaffold = page.slice(page.indexOf("function ScaffoldHeader"), page.indexOf("function FooterActions"));
    expect(scaffold).toContain('"opening.page.label"');
    expect(scaffold).not.toContain('"opening.page.title"');
  });
});

describe("#10 the opening footer names the blocker", () => {
  const client = read("app/(authed)/operations/opening/opening-client.tsx");
  it("the hint is chosen by openingFooterHint, fed the attestation state", () => {
    expect(client).toContain("const footerHint = openingFooterHint({");
    expect(client).toContain("attestationMissing: needsAttestation && attestationReason === null,");
    expect(client).toContain('t("opening.submit.gate_disabled_reason_required")');
  });
  it("the missing-temp hint is a button that reveals its station", () => {
    expect(client).toMatch(/footerHint\.kind === "temps_required" \? \(\s*<button\s+type="button"\s+onClick=\{\(\) => stationCollapse\.reveal\(\[footerHint\.station\]\)\}/);
  });
});
