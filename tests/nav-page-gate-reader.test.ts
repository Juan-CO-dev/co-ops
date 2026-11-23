/**
 * Nav PR 3, guard (d), the reader on its own (plan r5, 4.4.6, 4.4.7, 4.4.10).
 *
 *  - The census: the implemented reader's census of the 87 census files IS the committed reviewed-entry list
 *    (tests/fixtures/nav-reviewed-entries.json). It fails on any unclassified, stale, ambiguous or unreviewed construct.
 *    NAV_CENSUS_WRITE=1 (CI unset) rewrites the file from the census: a new construct gets meaning null (which then
 *    fails), an existing record keeps its human-written meaning. The census never writes a meaning.
 *  - The negative fixtures (N1-N27): each must make the reader throw, with its code. Positive controls show the
 *    closure is not a reader that rejects everything.
 *  - A real-source fixture for every one of the 85 destination pages: the entries it consumes, and the roles it
 *    admits under every switch combination and the facts it reads, against a hand-written expectation (Appendix B),
 *    independent of the destination list.
 *  - The hard shapes: PM report's submitted day (the per-record restriction view), AM prep in edit mode, Mid-day's
 *    zero / one / many instances, and Astra r5 P3 (Station setup's sync call).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TaskType } from "@/lib/assignments-shared";
import type { Facts, SwitchName, Switches } from "@/lib/nav/types";
import { ROLES, type RoleCode } from "@/lib/roles";
import {
  CONSTANTS, LAYOUT_FILE, MEMBERSHIP, PULSE_HOME_FILE, PageGateError, ROLE_PREDICATES, S, SWITCH_CALLS, SWITCH_COMBOS, admitMatrix,
  entryKey, loadReviewedEntries, runCensus, type ForceArm, type ReaderOptions, type ReviewedEntry,
} from "./helpers/page-gate";
import { censusFiles, destinationPages, newReader } from "./helpers/page-gate-census";

const ENTRIES = loadReviewedEntries();
const ALL_ROLES = Object.keys(ROLES) as RoleCode[];
const FIXTURE_FILE = "app/(authed)/fixture/page.tsx";
const FIXTURE_PAGE = { route: "/fixture", file: FIXTURE_FILE, takesShop: false, admin: false };

/** Run the reader on an in-memory page and return the error it throws (or undefined). */
function readerError(source: string, opts: { entries?: ReviewedEntry[]; role?: RoleCode } = {}): PageGateError | undefined {
  const reader = newReader({ sources: { [FIXTURE_FILE]: source }, pages: [FIXTURE_PAGE], entries: [...ENTRIES, ...(opts.entries ?? [])] });
  try {
    reader.admits("/fixture", { role: opts.role ?? "gm", switches: {} });
    return undefined;
  } catch (e) {
    if (e instanceof PageGateError) return e;
    throw e;
  }
}

/** Load a real census file with an in-memory edit and return the error it throws. */
function editedError(file: string, from: string, to: string, extra: Record<string, string> = {}): PageGateError | undefined {
  const source = readFileSync(file, "utf8");
  expect(source.includes(from), `${file} still contains the text the fixture edits`).toBe(true);
  const reader = newReader({ sources: { [file]: source.replace(from, to), ...extra } });
  try {
    reader.load(file);
    return undefined;
  } catch (e) {
    if (e instanceof PageGateError) return e;
    throw e;
  }
}

const page = (body: string, imports = "") => `import { redirect, notFound } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
${imports}
export default async function FixturePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const auth = await requireSessionFromHeaders("/fixture");
${body}
  return null;
}
`;

const codes = (e: PageGateError | undefined) => (e?.problems ?? []).map((p) => p.code);

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The census IS the list (4.4.10)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("the census of the 87 census files is the committed reviewed-entry list", () => {
  const reader = newReader();
  const files = censusFiles();
  const result = runCensus(reader, files);

  it("the census files are the 85 destination pages, the admin layout and PulseHome", () => {
    expect(files).toHaveLength(87);
    expect(new Set(files).size).toBe(87);
    expect(files).toEqual(expect.arrayContaining([LAYOUT_FILE, PULSE_HOME_FILE]));
  });

  it("census write mode (NAV_CENSUS_WRITE=1, CI unset) rewrites the list from the census, meanings untouched", () => {
    if (process.env.NAV_CENSUS_WRITE !== "1" || process.env.CI) return;
    writeFileSync("tests/fixtures/nav-reviewed-entries.json", JSON.stringify(result.records, null, 1) + "\n");
  });

  it("0 unclassified, 0 stale, 0 ambiguous, 0 unreviewed: every construct has exactly one reviewed entry", () => {
    expect(result.unclassified).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.ambiguous).toEqual([]);
    expect(result.unreviewed).toEqual([]);
    expect(result.problems.map((p) => `${p.code} ${p.file}:${p.line} ${p.detail}`)).toEqual([]);
  });

  it("the committed file is exactly the census output (lines are for humans and not compared)", () => {
    const strip = (r: ReviewedEntry) => ({ ...r, line: undefined });
    expect(result.records.map(strip)).toEqual(ENTRIES.map(strip));
  });

  it("185 entries (nav PR 7: the Dashboard 14 → 3): refuse 28, admit 75, success-redirect 2, operational error 80, in 47 of the 87 files", () => {
    const by = (k: string) => ENTRIES.filter((e) => e.meaning?.kind === k).length;
    expect(ENTRIES).toHaveLength(185);
    expect({ refuse: by("refuse"), admit: by("admit"), "success-redirect": by("success-redirect"), "operational-error": by("operational-error") })
      .toEqual({ refuse: 28, admit: 75, "success-redirect": 2, "operational-error": 80 });
    expect(new Set(ENTRIES.map((e) => e.file)).size).toBe(47);
  });

  it("every committed record carries its full binding (fn, anchor, kind, text) and a human-written meaning with a reason", () => {
    for (const e of ENTRIES) {
      expect(e.fn, entryKey(e)).toBeTruthy();
      expect(e.anchor, entryKey(e)).toBeTruthy();
      expect(e.text, entryKey(e)).toBeTruthy();
      expect(e.meaning, entryKey(e)).not.toBeNull();
      expect(e.meaning!.why.length, entryKey(e)).toBeGreaterThan(10);
    }
  });

  it("the two PM report `throw e;` bind by function and anchor (the one text that is not unique in its file)", () => {
    const pm = ENTRIES.filter((e) => e.file === "app/(authed)/pm-report/page.tsx" && e.text === "throw e;");
    expect(pm.map((e) => [e.fn, e.anchor])).toEqual([
      ["callback of loadDayResults(sb, { actor, locationId, date }).catch", "fn:callback of loadDayResults(sb, { actor, locationId, date }).catch"],
      ["renderV2", "catch of try { await openMyCopy(sb, { actor, locationId, date }); }"],
    ]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// Negative fixtures (4.4.6): each must make the reader throw
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

describe("negative fixtures: the reader fails closed", () => {
  it("N1 / N11: an unknown predicate is not core, and a page whose only gate is one never reads as 'admits everyone'", () => {
    const e = readerError(page(`  if (!canDoThing(auth.role)) redirect("/x");`, `import { canDoThing } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("N2: an alias to an unknown helper", () => {
    const e = readerError(page(`  const allowed = await canDoThing(auth);\n  if (!allowed) redirect("/x");`, `import { canDoThing } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("N3: a spoofed import name (another export renamed to canViewPars)", () => {
    const e = readerError(page(`  if (!canViewPars(auth.user.role)) redirect("/x");`, `import { other as canViewPars } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("N4: a gate nested under an undecided branch", () => {
    const e = readerError(page(`  const someFlag = await loadFlag();\n  if (someFlag) { if (auth.level < 7) redirect("/x"); }`, `import { loadFlag } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it.each([
    ["switch", `  switch (auth.role) { case "gm": redirect("/x"); }`],
    ["ternary", `  auth.level < 7 ? redirect("/x") : null;`],
    ["callback", `  [1].forEach(() => notFound());`],
  ])("N5: an exit in a %s", (_name, body) => {
    expect(readerError(page(body))?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("N6: an early return is never core", () => {
    const e = readerError(page(`  if (auth.level < 7) return <div />;`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("N7: Schedule with its canViewSchedule filter removed (the refuse entry's pin breaks)", () => {
    const e = editedError("app/(authed)/schedule/page.tsx", ".filter((l) => canViewSchedule(actor, l.id))", "");
    expect(codes(e)).toContain("ENTRY_TEXT_MISMATCH");
    expect(e?.problems.some((p) => p.code === "ENTRY_TEXT_MISMATCH" && /canViewSchedule/.test(p.detail))).toBe(true);
  });

  it("N8: an entry whose text no longer occurs in its file is stale", () => {
    const stale: ReviewedEntry = { file: "app/(authed)/assignments/page.tsx", fn: "AssignmentsPage", anchor: "fn:AssignmentsPage", kind: "throw", text: "throw nothing;", meaning: { kind: "operational-error", why: "a fixture entry that binds nothing" } };
    const reader = newReader({ entries: [...ENTRIES, stale] });
    expect(() => reader.load("app/(authed)/assignments/page.tsx")).toThrow(/STALE_ENTRY/);
  });

  it("N9: a return that hands the page to an imported function", () => {
    const e = readerError(page(`  if (auth.level < 0) redirect("/x");\n  return renderElsewhere(await searchParams);`, `import { renderElsewhere } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("N10: Shop pulse with <PulseHome replaced by <PulseHomeV3", () => {
    expect(codes(editedError("app/(authed)/mid-shift/page.tsx", "return <PulseHome ", "return <PulseHomeV3 "))).toContain("ENTRY_TEXT_MISMATCH");
  });

  it("N12: an unknown throwing gate", () => {
    const e = readerError(page(`  if (!allowed(auth)) throw new Error("forbidden");`, `import { allowed } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it.each([["assertCanOpen(auth);"], ["await requireThing(auth);"]])("N13: a standalone imported gate call: %s", (call) => {
    const e = readerError(page(`  ${call}`, `import { assertCanOpen, requireThing } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("N14: an unreviewed 403 catch: the redirect and the rethrow are both unreviewed", () => {
    const e = readerError(page(`  try { await loadX(auth); } catch (e) { if (e instanceof XError && e.status === 403) redirect("/x"); throw e; }`, `import { loadX, XError } from "@/lib/x";`));
    expect(codes(e).filter((c) => c === "UNREVIEWED_CONSTRUCT").length).toBeGreaterThanOrEqual(2);
    expect(e?.problems.some((p) => /redirect/.test(p.detail))).toBe(true);
    expect(e?.problems.some((p) => /throw e;/.test(p.detail))).toBe(true);
  });

  it("N15: a reviewed throw with one character changed", () => {
    expect(codes(editedError("app/(authed)/assignments/page.tsx", "if (error) throw error;", "if (error) throw errors;"))).toContain("ENTRY_TEXT_MISMATCH");
  });

  it("N16: a gate filed as an operational error", () => {
    const src = page(`  if (auth.level < 7) throw new Error("x");`);
    const e = readerError(src, { entries: [{ file: FIXTURE_FILE, fn: "FixturePage", anchor: "fn:FixturePage", kind: "throw", text: `if (auth.level < 7) throw new Error("x");`, meaning: { kind: "operational-error", why: "mislabelled on purpose" } }] });
    expect(e?.code).toBe("OPERATIONAL_MENTIONS_SESSION");
  });

  it("N16b: the same through an alias", () => {
    const src = page(`  const blocked = auth.level < 7;\n  if (blocked) throw new Error("x");`);
    const e = readerError(src, { entries: [{ file: FIXTURE_FILE, fn: "FixturePage", anchor: "fn:FixturePage", kind: "throw", text: `if (blocked) throw new Error("x");`, meaning: { kind: "operational-error", why: "mislabelled on purpose" } }] });
    expect(e?.code).toBe("OPERATIONAL_MENTIONS_SESSION");
  });

  it("N17: a refuse entry whose `when` uses an unknown predicate", () => {
    const src = page(`  if (await mystery(auth)) redirect("/x");`, `import { mystery } from "@/lib/x";`);
    const e = readerError(src, { entries: [{ file: FIXTURE_FILE, fn: "FixturePage", anchor: "fn:FixturePage", kind: "redirect", text: `if (await mystery(auth)) redirect("/x");`, meaning: { kind: "refuse", when: "!canDoThing(auth.role)", why: "an unknown predicate" } }] });
    expect(e?.code).toBe("UNKNOWN_CONDITION");
  });

  it("N18: a success-redirect entry whose target resolves to no page", () => {
    const src = page(`  if (await mystery(auth)) redirect("/x");`, `import { mystery } from "@/lib/x";`);
    const e = readerError(src, { entries: [{ file: FIXTURE_FILE, fn: "FixturePage", anchor: "fn:FixturePage", kind: "redirect", text: `if (await mystery(auth)) redirect("/x");`, meaning: { kind: "success-redirect", target: "/no-such-page?x=1", why: "a fixture" } }] });
    expect(e?.code).toBe("BAD_REDIRECT_TARGET");
  });

  it("N19: a pinned helper text changed (the Catering inbox's role rule)", () => {
    const lib = readFileSync("lib/catering/inbox.ts", "utf8");
    const e = editedError("app/(authed)/catering/inbox/page.tsx", "redirect(", "redirect(", {
      "lib/catering/inbox.ts": lib.replace('role === "catering_mgr" || getRoleLevel(role) >= 8', 'role === "catering_mgr" || getRoleLevel(role) >= 7'),
    });
    expect(codes(e)).toContain("ENTRY_TEXT_MISMATCH");
  });

  it.each([
    ["!access.canEdit", "!access.canView"],
    ["redirect(`/operations/am-prep?", "redirect(`/dashboard?"],
  ])("N20: AM prep's edit-mode construct edited (%s → %s) must be re-reviewed", (from, to) => {
    expect(codes(editedError("app/(authed)/operations/am-prep/page.tsx", from, to))).toContain("ENTRY_TEXT_MISMATCH");
  });

  it("N21: PM report with the submitted-day wrapper removed (its body inlined)", () => {
    const file = "app/(authed)/pm-report/page.tsx";
    const src = readFileSync(file, "utf8");
    const start = src.indexOf('  if (state && state.status !== "open") {');
    const elseAt = src.indexOf("  } else {", start);
    expect(start).toBeGreaterThan(0);
    expect(elseAt).toBeGreaterThan(start);
    // `if (state && state.status !== "open") { A } else { B }` becomes `{ A } { B }`.
    const inlined = src.slice(0, start) + "  {" + src.slice(start + '  if (state && state.status !== "open") {'.length, elseAt) + "  }\n  {" + src.slice(elseAt + "  } else {".length);
    const reader = newReader({ sources: { [file]: inlined } });
    let err: PageGateError | undefined;
    try { reader.load(file); } catch (e) { err = e as PageGateError; }
    expect(err?.problems.some((p) => p.code === "STALE_ENTRY" && /enclosing-if \| if \(state && state\.status !== "open"\)/.test(p.detail)), JSON.stringify(codes(err))).toBe(true);
  });

  it("N22: PM report's per-record .catch turned into a navigation refusal", () => {
    expect(codes(editedError("app/(authed)/pm-report/page.tsx", 'e.code === "forbidden") return null;', 'e.code === "forbidden") redirect("/dashboard");'))).toContain("ENTRY_TEXT_MISMATCH");
  });

  it("N23: an exit only in the else arm of an opaque branch (no wrong-arm exemption): the whole branch is a construct", () => {
    const e = readerError(page(`  const someFlag = await loadFlag();\n  if (someFlag) { doWork(); } else { if (auth.level < 7) redirect("/x"); }`, `import { loadFlag, doWork } from "@/lib/x";`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
    expect(e?.problems.map((p) => p.detail), JSON.stringify(e?.problems)).toEqual(expect.arrayContaining([expect.stringContaining("if (someFlag) { doWork(); } else { if (auth.level < 7) redirect(")]));
  });

  it.each([
    ["app/(authed)/operations/am-prep/page.tsx", "if (state === null) {", "if (state == null) {"],
    ["app/(authed)/pm-report/page.tsx", 'if (day.format === "v2") return renderV2', 'if (day.format !== "v1") return renderV2'],
    ["app/(authed)/operations/vendor-mail/page.tsx", "if ([from, to].some(value =>", "if ([from, to].every(value =>"],
  ])("N24: a guarding condition is part of the bound text (%s)", (file, from, to) => {
    expect(codes(editedError(file, from, to))).toContain("ENTRY_TEXT_MISMATCH");
  });

  describe("N25: two identical `throw e;` in two catch clauses bind by their anchors", () => {
    const twin = page(`  if (auth.level >= 0) {
    try { await a(); } catch (e) { console.error(e); throw e; }
  }
  try { await b(); } catch (e) { console.error(e); throw e; }`, `import { a, b } from "@/lib/x";`);
    const op = { kind: "operational-error" as const, why: "a fixture rethrow" };
    const both = { kind: "admit" as const, why: "a fixture catch, both arms" };
    const catches: ReviewedEntry[] = [
      { file: FIXTURE_FILE, fn: "FixturePage", anchor: "if (auth.level >= 0)", kind: "enclosing-catch", text: "catch (e) { console.error(e); throw e; }", meaning: both },
      { file: FIXTURE_FILE, fn: "FixturePage", anchor: "fn:FixturePage", kind: "enclosing-catch", text: "catch (e) { console.error(e); throw e; }", meaning: both },
    ];
    it("with their anchors, both bind and the page reads", () => {
      const throws: ReviewedEntry[] = [
        { file: FIXTURE_FILE, fn: "FixturePage", anchor: "catch of try { await a(); }", kind: "throw", text: "throw e;", meaning: op },
        { file: FIXTURE_FILE, fn: "FixturePage", anchor: "catch of try { await b(); }", kind: "throw", text: "throw e;", meaning: op },
      ];
      expect(readerError(twin, { entries: [...catches, ...throws] })).toBeUndefined();
    });
    it("with the anchors removed, they are ambiguous", () => {
      const throws: ReviewedEntry[] = [
        { file: FIXTURE_FILE, fn: "", anchor: "", kind: "throw", text: "throw e;", meaning: op },
        { file: FIXTURE_FILE, fn: "", anchor: "", kind: "throw", text: "throw e;", meaning: op },
      ];
      const e = readerError(twin, { entries: [...catches, ...throws] });
      expect(e?.problems.some((p) => p.code === "AMBIGUOUS_ENTRY" && /throw e;/.test(p.detail))).toBe(true);
    });
  });

  it("N26: PM report's .catch rethrow removed: its entry is stale, the open-copy rethrow still binds", () => {
    const file = "app/(authed)/pm-report/page.tsx";
    const src = readFileSync(file, "utf8");
    const cut = '      if (e instanceof PmReportError && e.code === "forbidden") return null;\n      throw e;\n';
    expect(src.includes(cut)).toBe(true);
    const e = editedError(file, cut, '      if (e instanceof PmReportError && e.code === "forbidden") return null;\n      return null;\n');
    expect(e?.problems.some((p) => p.code === "STALE_ENTRY" && /callback of loadDayResults/.test(p.detail) && /\| throw \|/.test(p.detail))).toBe(true);
    expect(e?.problems.some((p) => /renderV2 \| catch of try \{ await openMyCopy/.test(p.detail))).toBe(false);
  });

  it("N27: Closing's :305 guard edited: that entry fails; the identical-shaped rethrows at :266 and :310 still bind", () => {
    const e = editedError("app/(authed)/operations/closing/page.tsx", "if (!(error instanceof ChecklistLineageTakenError)) throw error;", "if (!(error instanceof ChecklistLineageTakenErrorX)) throw error;");
    expect(e?.problems.some((p) => p.code === "ENTRY_TEXT_MISMATCH" && /ChecklistLineageTakenError\)\) throw error;/.test(p.detail))).toBe(true);
    expect(e?.problems.some((p) => /ChecklistActorNotAuthorizedError\)\) throw error;/.test(p.detail) && p.code !== "ENTRY_TEXT_MISMATCH")).toBe(false);
    expect(e?.problems.some((p) => /\| if \(!taken\) throw error;/.test(p.detail))).toBe(false);
  });
});

describe("Astra r1: a read's `error` stops the alias walk only with verified read provenance", () => {
  const ASSIGN = "app/(authed)/assignments/page.tsx";
  const READ = "const { data, error } = await query;";
  const load = (src: string) => {
    const reader = newReader({ sources: { [ASSIGN]: src } });
    try { reader.load(ASSIGN); return { reader, err: undefined }; } catch (e) { return { reader, err: e as PageGateError }; }
  };
  const real = readFileSync(ASSIGN, "utf8");

  it("the repro: an `error` built from the session, behind the reviewed `if (error) throw error;`, fails", () => {
    expect(real.includes(READ)).toBe(true);
    const forged = real.replace(READ, `const { data } = await query;
  const { error } = { error: auth.level < 7 ? new Error("forbidden") : null };`);
    const { err } = load(forged);
    expect(err?.code).toBe("OPERATIONAL_MENTIONS_SESSION");
  });

  it("the same through a property access on a non-read value fails too", () => {
    const forged = real.replace(READ, `const { data } = await query;
  const result = { error: auth.level < 7 ? new Error("forbidden") : null };`).replace("if (error) throw error;", "if (result.error) throw result.error;");
    const entries = ENTRIES.map((e) => (e.file === ASSIGN && e.kind === "throw" ? { ...e, text: "if (result.error) throw result.error;" } : e));
    const reader = newReader({ sources: { [ASSIGN]: forged }, entries });
    expect(() => reader.load(ASSIGN)).toThrow(/OPERATIONAL_MENTIONS_SESSION/);
  });

  it("a `let` alias is walked: `let blocked = auth.level < 7; if (blocked) throw ...` filed operational fails", () => {
    const src = page(`  let blocked = false;
  blocked = auth.level < 7;
  if (blocked) throw new Error("x");`);
    const e = readerError(src, { entries: [{ file: FIXTURE_FILE, fn: "FixturePage", anchor: "fn:FixturePage", kind: "throw", text: `if (blocked) throw new Error("x");`, meaning: { kind: "operational-error", why: "mislabelled on purpose" } }] });
    expect(e?.code).toBe("OPERATIONAL_MENTIONS_SESSION");
  });

  it("a real read's error passes in the destructured form (the page as it is, a let builder narrowed by the session)", () => {
    expect(load(real).err).toBeUndefined();
  });

  it("a real read's error passes in the property-access form", () => {
    const prop = real.replace(READ, `const result = await query;
  const data = result.data;`).replace("if (error) throw error;", "if (result.error) throw result.error;");
    const entries = ENTRIES.map((e) => (e.file === ASSIGN && e.kind === "throw" ? { ...e, text: "if (result.error) throw result.error;" } : e));
    const reader = newReader({ sources: { [ASSIGN]: prop }, entries });
    expect(() => reader.load(ASSIGN)).not.toThrow();
    expect(reader.admits("/assignments", { role: "employee", switches: {} }).admitted).toBe(true);
  });
});

describe("Astra r2 red team: read provenance is a closed grammar (client root, builder methods, awaited directly)", () => {
  const ASSIGN = "app/(authed)/assignments/page.tsx";
  const READ = "const { data, error } = await query;";
  const real = readFileSync(ASSIGN, "utf8");
  const loadError = (src: string) => {
    try { newReader({ sources: { [ASSIGN]: src } }).load(ASSIGN); return undefined; } catch (e) { return e as PageGateError; }
  };
  it.each([
    ["the r2 repro: a .then() that forges the error", `const { data, error } = await query.then((r) => ({ ...r, error: auth.level < 7 ? new Error("forbidden") : r.error }));`],
    ["a .catch() that forges it", `const { data, error } = await query.catch(() => ({ data: null, error: auth.level < 7 ? new Error("x") : null }));`],
    ["a .finally()", `const { data, error } = await query.finally(() => undefined);`],
    ["an unknown builder method", `const { data, error } = await query.order("name").transform((r) => r);`],
    ["an allowed method given a callback", `const { data, error } = await query.filter(() => auth.level < 7);`],
    ["an optional link", `const { data, error } = await query?.order("name");`],
    ["not awaited directly (Promise.resolve)", `const { data, error } = await Promise.resolve(query);`],
    ["a forged client", `const fake = { from: (_t: string) => ({ select: () => Promise.resolve({ data: [], error: auth.level < 7 ? new Error("x") : null }) }) };\n  const { data, error } = await fake.from("locations").select("id");`],
    ["a mutated client (sb.from re-assigned)", `(sb as unknown as { from: unknown }).from = () => ({ select: () => Promise.resolve({ data: [], error: auth.level < 7 ? new Error("x") : null }) });
  const { data, error } = await query;`],
    ["a conditional between a read and a forgery", `const { data, error } = await (auth.level < 7 ? Promise.resolve({ data: [], error: new Error("x") }) : query);`],
    ["a let builder later re-pointed through .then()", `query = query.then((r) => ({ ...r, error: auth.level < 7 ? new Error("x") : r.error }));\n  const { data, error } = await query;`],
  ])("%s: no provenance, so the session-built error fails", (_name, read) => {
    expect(real.includes(READ)).toBe(true);
    expect(loadError(real.replace(READ, read))?.code).toBe("OPERATIONAL_MENTIONS_SESSION");
  });
  it("the real read keeps its provenance (control)", () => {
    expect(loadError(real)).toBeUndefined();
  });
});

describe("Astra r3: a read result keeps provenance only while it is const and used read-only", () => {
  const ASSIGN = "app/(authed)/assignments/page.tsx";
  const READ = "const { data, error } = await query;";
  const real = readFileSync(ASSIGN, "utf8");
  const loadError = (src: string) => {
    try { newReader({ sources: { [ASSIGN]: src } }).load(ASSIGN); return undefined; } catch (e) { return e as PageGateError; }
  };
  const forge = `auth.level < 7 ? new Error("forbidden") : null`;
  it.each([
    ["the r3 repro: a member assignment on the result", `const result = await query;\n  result.error = auth.level < 7 ? new Error("forbidden") : result.error;\n  const { data, error } = result;`],
    ["Object.assign on the result", `const result = await query;\n  Object.assign(result, { error: ${forge} });\n  const { data, error } = result;`],
    ["an element-access assignment", `const result = await query;\n  (result as Record<string, unknown>)["error"] = ${forge};\n  const { data, error } = result;`],
    ["a compound assignment", `const result = await query;\n  result.error ??= ${forge};\n  const { data, error } = result;`],
    ["a delete", `const result = await query;\n  delete (result as { error?: unknown }).error;\n  const { data, error } = result;`],
    ["the result passed to a helper", `const result = await query;\n  forgeError(result, auth);\n  const { data, error } = result;`],
    ["the result spread and re-wrapped", `const result = await query;\n  const { data, error } = { ...result, error: ${forge} };`],
    ["a let result reassigned", `let result = await query;\n  result = { ...result, error: ${forge} };\n  const { data, error } = result;`],
    ["a let { error } that gets reassigned", `let { data, error } = await query;\n  error = ${forge};`],
  ])("%s: no provenance, the session-built error fails", (_name, read) => {
    expect(real.includes(READ)).toBe(true);
    // Since Astra r5 the file-wide ban also fires on the write / Object.assign / delete forms; either code fails it.
    const err = loadError(real.replace(READ, read));
    expect(err?.problems.some((p) => p.code === "OPERATIONAL_MENTIONS_SESSION" || p.code === "FORBIDDEN_MUTATION_PRIMITIVE"), read).toBe(true);
  });
  it.each([
    ["a const result destructured", `const result = await query;\n  const { data, error } = result;`],
    ["a const result read through .error / .data", `const result = await query;\n  const data = result.data;\n  const error = result.error;`],
  ])("control: %s keeps provenance", (_name, read) => {
    expect(loadError(real.replace(READ, read))).toBeUndefined();
  });
});

describe("Astra r4: a mutated dependency of an operational guard is fatal (MUTATED_DEPENDENCY), with a session-independent read", () => {
  const ASSIGN = "app/(authed)/assignments/page.tsx";
  const READ = "const { data, error } = await query;";
  const real = readFileSync(ASSIGN, "utf8");
  // A read that does NOT mention the session, so nothing but the mutation rule can fail these.
  const PLAIN = `const result = await sb.from("locations").select("id,name");`;
  const forged = `{ message: "forbidden", details: "", hint: "", code: "403", name: "PostgrestError" }`;
  const problemsOf = (src: string) => {
    try { newReader({ sources: { [ASSIGN]: src } }).load(ASSIGN); return []; } catch (e) { return (e as PageGateError).problems.map((p) => p.code); }
  };
  it.each([
    ["Astra's repro: a member write", `result.error = auth.level < 7 ? ${forged} : result.error;`],
    ["Object.assign", `Object.assign(result, { error: auth.level < 7 ? ${forged} : null });`],
    ["??=", `result.error ??= (auth.level < 7 ? ${forged} : null);`],
    ["||=", `result.error ||= (auth.level < 7 ? ${forged} : null);`],
    ["&&=", `result.data &&= null;`],
    ["an element-access write", `(result as Record<string, unknown>)["error"] = auth.level < 7 ? ${forged} : null;`],
    ["Object.defineProperty", `Object.defineProperty(result, "error", { value: auth.level < 7 ? ${forged} : null });`],
    ["Reflect.set", `Reflect.set(result, "error", auth.level < 7 ? ${forged} : null);`],
    ["delete", `delete (result as { error?: unknown }).error;`],
    ["++ on a member", `(result as unknown as { count: number }).count++;`],
    ["passed to a helper", `forgeError(result, auth);`],
    ["aliased, then the alias written", `const alias = result;\n  alias.error = auth.level < 7 ? ${forged} : null;`],
    ["put in an object", `const box = { result };\n  box.result.error = auth.level < 7 ? ${forged} : null;`],
  ])("%s: fails MUTATED_DEPENDENCY", (_name, mutation) => {
    expect(real.includes(READ)).toBe(true);
    const src = real.replace(READ, `${PLAIN}\n  ${mutation}\n  const { data, error } = result;`);
    const codes = problemsOf(src);
    expect(codes).toContain("MUTATED_DEPENDENCY");
    expect(codes).not.toContain("OPERATIONAL_MENTIONS_SESSION"); // the read is session-independent: only the mutation rule fires
  });

  it("a destructured error itself written by a compound assignment is fatal too", () => {
    const src = real.replace(READ, `const { data, error } = await sb.from("locations").select("id,name");\n  const blocked = { level: auth.level };\n  void blocked;\n  (error as unknown as { code: string }).code += "";`);
    expect(problemsOf(src)).toContain("MUTATED_DEPENDENCY");
  });

  it("control: the same session-independent read, const and read-only, passes", () => {
    expect(problemsOf(real.replace(READ, `${PLAIN}\n  const { data, error } = result;`))).toEqual([]);
    expect(problemsOf(real)).toEqual([]);
  });

  it("a mutation after the guard cannot change it and is not a dependency", () => {
    const src = real.replace("if (error) throw error;", "if (error) throw error;\n  (query as unknown as { note: string }).note = \"after\";");
    expect(problemsOf(src)).toEqual([]);
  });

  it("the read-only argument allowlist really only reads: parseReportRange on a frozen argument", async () => {
    const { parseReportRange } = await import("@/lib/report-range");
    const arg = Object.freeze({ range: "custom", from: "2026-11-01", to: "2026-11-07", location: "shop-S" });
    expect(() => parseReportRange(arg, "2026-11-18")).not.toThrow();
    expect(arg).toEqual({ range: "custom", from: "2026-11-01", to: "2026-11-07", location: "shop-S" });
  });
});

describe("Astra r5 and the lead's backstop: FORBIDDEN_MUTATION_PRIMITIVE anywhere in a census file", () => {
  const ASSIGN = "app/(authed)/assignments/page.tsx";
  const READ = "const { data, error } = await query;";
  const real = readFileSync(ASSIGN, "utf8");
  const PLAIN = `await sb.from("locations").select("id,name")`;
  const forged = `auth.level < 7 ? { message: "forbidden", details: "", hint: "", code: "403", name: "PostgrestError" } : null`;
  const codesOf = (src: string, file = ASSIGN, extra: ReaderOptions = {}) => {
    try { newReader({ sources: { [file]: src }, ...extra }).load(file); return []; } catch (e) { return (e as PageGateError).problems.map((p) => p.code); }
  };

  it.each([
    ["r5 (a): a member alias of a read result written", `const box = { result: ${PLAIN} };\n  const alias = box.result;\n  alias.error = ${forged};\n  const { data, error } = alias;`],
    ["r5 (b): [result].map(r => Object.assign(r, ...))", `const result = ${PLAIN};\n  [result].map((r) => Object.assign(r, { error: ${forged} }));\n  const { data, error } = result;`],
    ["r5 (b): [result].some(r => { r.error = ... })", `const result = ${PLAIN};\n  [result].some((r) => { r.error = ${forged}; return false; });\n  const { data, error } = result;`],
  ])("%s fails", (_name, read) => {
    expect(real.includes(READ)).toBe(true);
    expect(codesOf(real.replace(READ, read))).toContain("FORBIDDEN_MUTATION_PRIMITIVE");
  });

  it("exemption (3) is gone: an array holding a read result, even only as a read-only receiver, is an escape", () => {
    const src = real.replace(READ, `const result = ${PLAIN};\n  const hit = [result].some((r) => r.data === null);\n  void hit;\n  const { data, error } = result;`);
    const codes = codesOf(src);
    expect(codes).toContain("MUTATED_DEPENDENCY");
    expect(codes).not.toContain("FORBIDDEN_MUTATION_PRIMITIVE");
  });

  it("an array of primitives by construction stays a read (Vendor mail's `[from, to].some(...)`, `from` from a typeof-narrowed helper)", () => {
    expect(codesOf(readFileSync("app/(authed)/operations/vendor-mail/page.tsx", "utf8"), "app/(authed)/operations/vendor-mail/page.tsx")).toEqual([]);
  });

  const anywhere = (line: string) => page(`  const target: Record<string, unknown> = { a: 1 };\n  void target;\n  ${line}`);
  it.each([
    ["Object.assign", "Object.assign(target, { b: 2 });"],
    ["Object.defineProperty", `Object.defineProperty(target, "b", { value: 2 });`],
    ["Object.defineProperties", `Object.defineProperties(target, { b: { value: 2 } });`],
    ["Object.setPrototypeOf", "Object.setPrototypeOf(target, null);"],
    ["Reflect.set", `Reflect.set(target, "b", 2);`],
    ["Reflect.defineProperty", `Reflect.defineProperty(target, "b", { value: 2 });`],
    ["Reflect.deleteProperty", `Reflect.deleteProperty(target, "a");`],
    ["Object[\"assign\"] by element access", `Object["assign"](target, { b: 2 });`],
  ])("(1) a call of %s anywhere in the file", (_name, line) => {
    expect(codesOf(anywhere(line), FIXTURE_FILE, { pages: [FIXTURE_PAGE] })).toContain("FORBIDDEN_MUTATION_PRIMITIVE");
  });

  it.each([
    ["error =", "target.error = null;"],
    ["data ??=", "target.data ??= [];"],
    ["count +=", "(target as { count: number }).count += 1;"],
    ["status ||=", "target.status ||= 200;"],
    ["statusText &&=", "target.statusText &&= \"ok\";"],
    ["count++", "(target as { count: number }).count++;"],
    ["--count", "--(target as { count: number }).count;"],
    ["delete error", "delete target.error;"],
    ["[\"error\"] =", "target[\"error\"] = null;"],
    ["delete [\"data\"]", "delete target[\"data\"];"],
  ])("(2) a write to a result-member name: %s", (_name, line) => {
    expect(codesOf(anywhere(line), FIXTURE_FILE, { pages: [FIXTURE_PAGE] })).toContain("FORBIDDEN_MUTATION_PRIMITIVE");
  });

  it("(2) an element-access write with a computed key, on anything but a fresh accumulator", () => {
    expect(codesOf(page(`  const key = String(auth.level);\n  const target = await loadTarget();\n  target[key] = 1;`, `import { loadTarget } from "@/lib/x";`), FIXTURE_FILE, { pages: [FIXTURE_PAGE] }))
      .toContain("FORBIDDEN_MUTATION_PRIMITIVE");
    // A fresh accumulator (`const m: Record<string, T> = {}`, never reassigned) is the one allowed target: no read result.
    expect(codesOf(page(`  const key = String(auth.level);\n  const byId: Record<string, number> = {};\n  byId[key] = 1;`), FIXTURE_FILE, { pages: [FIXTURE_PAGE] })).toEqual([]);
  });

  it("controls: plain writes to other names, and literal-key writes, are not banned", () => {
    expect(codesOf(anywhere(`target.note = "x";\n  target["note"] = "y";\n  target[0] = 1;`), FIXTURE_FILE, { pages: [FIXTURE_PAGE] })).toEqual([]);
  });
});

describe("Astra r6: every write site's targets are collected by one recursive function", () => {
  const ASSIGN = "app/(authed)/assignments/page.tsx";
  const READ = "const { data, error } = await query;";
  const real = readFileSync(ASSIGN, "utf8");
  const PLAIN = `const result = await sb.from("locations").select("id,name");`; // session-independent
  const forged = `{ message: "forbidden", details: "", hint: "", code: "403", name: "PostgrestError" }`;
  const codesOf = (src: string) => {
    try { newReader({ sources: { [ASSIGN]: src } }).load(ASSIGN); return []; } catch (e) { return (e as PageGateError).problems.map((p) => p.code); }
  };
  it.each([
    ["an object pattern", `({ error: result.error } = { error: ${forged} });`],
    ["an array pattern", `[result.error] = [${forged}];`],
    ["a nested pattern", `({ a: { b: [result.error] } } = { a: { b: [${forged}] } });`],
    ["a default value", `({ e: result.error = ${forged} } = {});`],
    ["an object rest", `({ ...result.data } = { a: 1 });`],
    ["an array rest", `[...result.data] = [1];`],
    ["an `as` wrapper", `(result.error as unknown) = ${forged};`],
    ["a `satisfies` wrapper", `(result.error satisfies unknown) = ${forged};`],
    ["a `!` wrapper", `result.error! = ${forged};`],
    ["a for-of head", `for (result.error of [${forged}]) break;`],
    ["a for-in head", `for (result.error in { k: 1 }) break;`],
  ])("%s writing into a read result fails", (_name, write) => {
    expect(real.includes(READ)).toBe(true);
    const codes = codesOf(real.replace(READ, `${PLAIN}\n  ${write}\n  const { data, error } = result;`));
    expect(codes).toContain("FORBIDDEN_MUTATION_PRIMITIVE");
    expect(codes).toContain("MUTATED_DEPENDENCY");
  });
  it("a destructuring write to another member of a dependency fails MUTATED_DEPENDENCY on its own", () => {
    const codes = codesOf(real.replace(READ, `${PLAIN}\n  ({ x: (result as unknown as { note: unknown }).note } = { x: 1 });\n  const { data, error } = result;`));
    expect(codes).toEqual(["MUTATED_DEPENDENCY"]);
  });
  it("control: a destructuring declaration (not an assignment) of a read result passes", () => {
    expect(codesOf(real.replace(READ, `${PLAIN}\n  const { data, error } = result;`))).toEqual([]);
  });
});

describe("Astra r6 P3: an async function or a generator is never a primitive by construction", () => {
  const src = (helper: string) => `import { requireSessionFromHeaders } from "@/lib/session";
${helper}
export default async function FixturePage() {
  const auth = await requireSessionFromHeaders("/fixture");
  void auth;
  const v = pick("x");
  const hit = [v].some((x) => x === "y");
  void hit;
  if (!v) throw new Error("x");
  return null;
}
`;
  const entry: ReviewedEntry = { file: FIXTURE_FILE, fn: "FixturePage", anchor: "fn:FixturePage", kind: "throw", text: `if (!v) throw new Error("x");`, meaning: { kind: "operational-error", why: "a fixture guard" } };
  const codesOf = (helper: string) => {
    try { newReader({ sources: { [FIXTURE_FILE]: src(helper) }, pages: [FIXTURE_PAGE], entries: [...ENTRIES, entry] }).load(FIXTURE_FILE); return []; } catch (e) { return (e as PageGateError).problems.map((p) => p.code); }
  };
  it.each([
    ["an async function declaration", `async function pick(key: string) { return key === "a" ? "a" : "b"; }`],
    ["a generator declaration", `function* pick(key: string) { return key === "a" ? "a" : "b"; }`],
    ["an async generator declaration", `async function* pick(key: string) { return key === "a" ? "a" : "b"; }`],
    ["an async arrow", `const pick = async (key: string) => (key === "a" ? "a" : "b");`],
    ["an async function expression", `const pick = async function (key: string) { return key === "a" ? "a" : "b"; };`],
    ["a generator expression", `const pick = function* (key: string) { return key === "a" ? "a" : "b"; };`],
    ["an async generator expression", `const pick = async function* (key: string) { return key === "a" ? "a" : "b"; };`],
  ])("%s: its result in an array is an escape", (_name, helper) => {
    expect(codesOf(helper)).toContain("MUTATED_DEPENDENCY");
  });
  it.each([
    ["a plain function declaration", `function pick(key: string) { return key === "a" ? "a" : "b"; }`],
    ["a plain arrow", `const pick = (key: string) => (key === "a" ? "a" : "b");`],
  ])("control: %s returning primitives is a primitive by construction", (_name, helper) => {
    expect(codesOf(helper)).toEqual([]);
  });
});

describe("Astra r2 red team: a next/navigation exit binding may only be called directly", () => {
  it("Astra r3 P3: every namespace import is tracked (two namespaces, the first aliased)", () => {
    const e = readerError(page(`  const go = nav1.redirect;\n  if (auth.level < 7) go("/dashboard");`, `import * as nav1 from "next/navigation";\nimport * as nav2 from "next/navigation";\nvoid nav2;`));
    expect(e?.code).toBe("UNREVIEWED_CONSTRUCT");
    expect(e?.problems.some((p) => /namespace nav1/.test(p.detail))).toBe(true);
  });

  const fails = (body: string, imports = "") => {
    const e = readerError(page(body, imports));
    expect(e?.code, body).toBe("UNREVIEWED_CONSTRUCT");
    // Failed by the binding rule itself, not only by some other unreviewed construct nearby.
    expect(e?.problems.some((p) => /next\/navigation/.test(p.detail)), JSON.stringify(e?.problems)).toBe(true);
    return e;
  };
  const NS = `import * as navigation from "next/navigation";`;
  it.each([
    ["the r2 repro: aliased to a const", `  const go = redirect;\n  if (auth.level < 7) go("/dashboard");`],
    ["the r2 repro: .call", `  if (auth.level < 7) redirect.call(null, "/dashboard");`],
    [".apply", `  if (auth.level < 7) redirect.apply(null, ["/dashboard"]);`],
    [".bind", `  const go = redirect.bind(null, "/dashboard");\n  if (auth.level < 7) go();`],
    ["passed as an argument", `  run(redirect);`],
    ["returned from a function", `  const pick = () => redirect;\n  if (auth.level < 7) pick()("/dashboard");`],
    ["put in an object (shorthand)", `  const o = { redirect };\n  if (auth.level < 7) o.redirect("/dashboard");`],
    ["put in an object (value)", `  const o = { go: notFound };\n  if (auth.level < 7) o.go();`],
    ["put in an array", `  const [go] = [redirect];\n  if (auth.level < 7) go("/dashboard");`],
    ["spread", `  const fns = [...[redirect]];\n  if (auth.level < 7) fns[0]!("/dashboard");`],
    ["an optional call", `  if (auth.level < 7) redirect?.("/dashboard");`],
    ["a tagged template", "  if (auth.level < 7) redirect`/dashboard`;"],
    ["exported", `  void 0;\n}\nexport { redirect };\nfunction unused() {`],
  ])("%s", (_name, body) => { fails(body, `import { run } from "@/lib/x";`); });

  it.each([
    ["a destructured namespace", `  const { redirect: r } = navigation;\n  if (auth.level < 7) r("/dashboard");`],
    ["element access on the namespace", `  if (auth.level < 7) navigation["redirect"]("/dashboard");`],
    ["the namespace as a value", `  const n = navigation;\n  if (auth.level < 7) n.redirect("/dashboard");`],
    ["a namespace member not called", `  const r = navigation.redirect;\n  if (auth.level < 7) r("/dashboard");`],
    ["a namespace member through .call", `  if (auth.level < 7) navigation.redirect.call(null, "/dashboard");`],
    ["an optional namespace call", `  if (auth.level < 7) navigation.redirect?.("/dashboard");`],
  ])("%s", (_name, body) => { fails(body, NS); });

  it("a renamed exit aliased again", () => {
    fails(`  const g = go;\n  if (auth.level < 7) g("/dashboard");`, `import { redirect as go } from "next/navigation";`);
  });

  it.each([
    ["a re-export", `export { redirect } from "next/navigation";`],
    ["an export *", `export * from "next/navigation";`],
    ["a default import", `import nav from "next/navigation";`],
  ])("%s of next/navigation", (_name, line) => { fails(`  void 0;`, line); });

  it.each([
    ["require", `  const nav = require("next/navigation");\n  if (auth.level < 7) nav.redirect("/dashboard");`],
    ["a dynamic import", `  const nav = await import("next/navigation");\n  if (auth.level < 7) nav.redirect("/dashboard");`],
  ])("%s of next/navigation", (_name, body) => { fails(body); });

  it("the direct forms still read as core exits (controls)", () => {
    const admitsEmployee = (src: string) => newReader({ sources: { [FIXTURE_FILE]: src }, pages: [FIXTURE_PAGE] }).admits("/fixture", { role: "employee", switches: {} }).admitted;
    expect(admitsEmployee(page(`  if (auth.level < 7) redirect("/dashboard");`))).toBe(false);
    expect(admitsEmployee(page(`  if (auth.level < 7) navigation.redirect("/dashboard");`, NS))).toBe(false);
    expect(admitsEmployee(page(`  if (auth.level < 2) redirect("/dashboard");`))).toBe(true);
  });
});

describe("Astra r1: exits through namespace and renamed imports are never skipped", () => {
  const NS = `import * as navigation from "next/navigation";`;
  const employeeAdmitted = (src: string) => newReader({ sources: { [FIXTURE_FILE]: src }, pages: [FIXTURE_PAGE] }).admits("/fixture", { role: "employee", switches: {} }).admitted;

  it("a namespace redirect under a core condition is a core exit: it refuses", () => {
    const src = page(`  if (auth.level < 7) navigation.redirect("/dashboard");`, NS);
    expect(employeeAdmitted(src)).toBe(false);
    expect(newReader({ sources: { [FIXTURE_FILE]: src }, pages: [FIXTURE_PAGE] }).admits("/fixture", { role: "gm", switches: {} }).admitted).toBe(true);
  });

  it("a namespace redirect under a non-core condition fails the reader", () => {
    expect(readerError(page(`  if (await gate(auth)) navigation.redirect("/dashboard");`, `${NS}
import { gate } from "@/lib/x";`))?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("a namespace notFound: core under a core condition, unreviewed otherwise", () => {
    expect(employeeAdmitted(page(`  if (auth.level < 7) navigation.notFound();`, NS))).toBe(false);
    expect(readerError(page(`  if (await gate(auth)) navigation.notFound();`, `${NS}
import { gate } from "@/lib/x";`))?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("an element-access call on a namespace import fails, even under a core condition", () => {
    expect(readerError(page(`  if (auth.level < 7) navigation["redirect"]("/dashboard");`, NS))?.code).toBe("UNREVIEWED_CONSTRUCT");
  });

  it("a renamed redirect, and permanentRedirect / forbidden, are exits", () => {
    expect(employeeAdmitted(page(`  if (auth.level < 7) go("/dashboard");`, `import { redirect as go } from "next/navigation";`))).toBe(false);
    expect(readerError(page(`  if (await gate(auth)) go("/dashboard");`, `import { redirect as go } from "next/navigation";
import { gate } from "@/lib/x";`))?.code).toBe("UNREVIEWED_CONSTRUCT");
    expect(employeeAdmitted(page(`  if (auth.level < 7) permanentRedirect("/dashboard");`, `import { permanentRedirect } from "next/navigation";`))).toBe(false);
    expect(employeeAdmitted(page(`  if (auth.level < 7) forbidden();`, `import { forbidden } from "next/navigation";`))).toBe(false);
  });

  it("a standalone call through a namespace import is a construct", () => {
    expect(readerError(page(`  gates.assertCanOpen(auth);`, `import * as gates from "@/lib/x";`))?.code).toBe("UNREVIEWED_CONSTRUCT");
  });
});

describe("positive controls: the closure recognizes its core", () => {
  const admitted = (src: string, roles = ALL_ROLES) => {
    const reader = newReader({ sources: { [FIXTURE_FILE]: src }, pages: [FIXTURE_PAGE] });
    return roles.filter((role) => reader.admits("/fixture", { role, switches: {} }).admitted);
  };
  const parsRoles = ALL_ROLES.filter((r) => ["agm", "catering_mgr", "prep_mgr", "gm", "moo", "owner", "cgs"].includes(r));

  it("a renamed import of a real predicate is core (matched by module and export, never by local name)", () => {
    expect(admitted(page(`  if (!allowed(auth.user.role)) redirect("/x");`, `import { canViewPars as allowed } from "@/lib/admin/pars-shared";`))).toEqual(parsRoles);
  });

  it("an alias to a real predicate is core", () => {
    expect(admitted(page(`  const ok = canViewPars(auth.user.role);\n  if (!ok) redirect("/x");`, `import { canViewPars } from "@/lib/admin/pars-shared";`))).toEqual(parsRoles);
  });

  it("a nested gate under a decided branch is enforced, not skipped (a level-7 floor)", () => {
    const got = admitted(page(`  const { instance: instanceId } = await searchParams;\n  if (!instanceId) { if (auth.level < 7) redirect("/x"); }`));
    expect(got).toEqual(ALL_ROLES.filter((r) => ROLES[r].level >= 7));
  });

  it("the ternary gate is core (the entry shop is never \"all\")", () => {
    const got = admitted(page(`  const actor = { role: auth.role, locations: auth.locations };\n  const locationId = await resolveShopId(auth.locations);\n  if (locationId === "all" ? auth.level < 8 : !canReadReportLocation(actor, locationId)) redirect("/x");`,
      `import { canReadReportLocation } from "@/lib/locations";\nimport { resolveShopId } from "@/lib/shop-context";`));
    expect(got).toEqual(ALL_ROLES); // every member of S may read S
  });

  it("the closed tables hold only real exports", () => {
    for (const [name, row] of Object.entries(CONSTANTS)) expect(typeof row.value, name).toBe("number");
    for (const [name, row] of Object.entries({ ...ROLE_PREDICATES, ...MEMBERSHIP })) expect(typeof row.value, name).toBe("function");
    expect(Object.values(SWITCH_CALLS).map((r) => r.value).sort()).toEqual(["businessReport", "customerProfiles", "demandSignals", "pulseV2", "vault"]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// A real-source fixture for every destination page (4.4.7, Appendix B)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Each page's rule, written from the census and Appendix B, independently of lib/nav/destinations.ts: a level floor;
 * roles that pass below it; roles it is limited to; roles it refuses; the switch it needs or that lowers its floor;
 * the task whose assignment opens it; the GM business-report fact. `entries` is the count of reviewed entries the page
 * consumes, by meaning, from Appendix A (with the deltas listed in the PR).
 */
interface PageRule {
  min: number; also?: RoleCode[]; only?: RoleCode[]; not?: RoleCode[]; sw?: SwitchName; floorOn?: [SwitchName, number];
  task?: [TaskType, number]; gmFact?: true; entries: string;
}
const SMM: RoleCode[] = ["social_media_mgr"];
const GM_PLUS: RoleCode[] = ["gm", "moo", "owner", "cgs"];
const MOO_PLUS: RoleCode[] = ["moo", "owner", "cgs"];
const OP6: RoleCode[] = ["agm", "catering_mgr", "prep_mgr"];

const RULES: Record<string, PageRule> = {
  "/dashboard": { min: 0, entries: "A1 O2" },
  "/mid-shift": { min: 4, floorOn: ["pulseV2", 2], entries: "R2 A4 O2" },
  "/assignments": { min: 0, entries: "O1" },
  "/profile": { min: 0, entries: "" },
  "/stations": { min: 0, entries: "O1" },
  "/operations/opening": { min: 4, task: ["opening_report", 3], entries: "A5 O5" },
  "/operations/am-prep": { min: 4, task: ["am_prep", 3], entries: "A2 SR1 O5" },
  "/operations/mid-day": { min: 4, task: ["mid_day_prep", 3], entries: "R3 A1 SR1 O3" },
  "/operations/closing": { min: 0, entries: "A14 O14" },
  "/cash": { min: 4, task: ["cash_report", 4], entries: "A2 O2" },
  "/pm-report": { min: 4, not: SMM, task: ["pm_report", 4], entries: "R2 A4 O2" }, // v2's canSubmitPmDay refuses the SMM
  "/ordering": { min: 4, task: ["ordering", 4], entries: "A1 O1" },
  "/operations/receiving": { min: 4, task: ["receiving", 4], entries: "" },
  "/operations/counts": { min: 4, task: ["counts", 4], entries: "" },
  "/operations/production": { min: 3, entries: "O1" },
  "/maintenance": { min: 3, entries: "R1 A1 O1" },
  "/operations/vendor-mail": { min: 7, only: GM_PLUS, entries: "A3 O3" },
  "/catering": { min: 5, entries: "" },
  "/catering/insights": { min: 5, entries: "" },
  "/catering/pipeline": { min: 5, entries: "" },
  "/catering/quotes": { min: 5, entries: "" },
  "/catering/customers": { min: 5, entries: "" },
  "/catering/companies": { min: 5, entries: "" },
  "/catering/inbox": { min: 8, also: ["gm", "catering_mgr"], entries: "R1 A2 O1" },
  "/lto": { min: 0, entries: "" }, // E4: no gate
  "/admin/catering": { min: 6, entries: "" },
  "/admin/catering/packages": { min: 6, entries: "" },
  "/admin/catering/menu": { min: 7, entries: "" },
  "/admin/catering/pricing": { min: 8, entries: "" },
  "/admin/catering/rate-rules": { min: 8, entries: "" },
  "/admin/catering/capacity": { min: 7, entries: "" },
  "/admin/catering/zones": { min: 7, entries: "" },
  "/admin/catering/faq": { min: 6, entries: "" },
  "/admin/catering/prep-demand": { min: 6, entries: "" },
  "/admin/catering/lto": { min: 6, entries: "" },
  "/admin/catering/fulfillment": { min: 7, entries: "" },
  "/admin/catering/ezcater-review": { min: 8, also: ["catering_mgr"], entries: "" },
  "/admin/catering/toast": { min: 8, only: MOO_PLUS, entries: "" },
  "/admin/catering/delivery": { min: 8, only: MOO_PLUS, entries: "" }, // catering delivery D2: by role; the page reads no switch (it says "off")
  "/reports": { min: 2, not: SMM, entries: "R1 O1" },
  "/reports/operations": { min: 2, not: SMM, entries: "A1" },
  "/reports/written": { min: 2, not: SMM, entries: "O1" },
  "/reports/trends": { min: 4, not: SMM, entries: "A1" },
  "/reports/trends/ops": { min: 4, not: SMM, entries: "A1" },
  "/reports/trends/team": { min: 6, only: [...OP6, ...GM_PLUS], entries: "A1" },
  "/reports/sales": { min: 7, not: SMM, entries: "A2 O1" },
  "/reports/sales/checks": { min: 7, not: SMM, entries: "A2 O1" },
  "/reports/sales/catering": { min: 7, not: SMM, entries: "A2 O1" },
  "/reports/business": { min: 7, only: GM_PLUS, sw: "businessReport", gmFact: true, entries: "R1 A4 O2" },
  "/admin": { min: 6, entries: "" },
  "/schedule": { min: 7, also: ["agm"], only: ["agm", ...GM_PLUS], entries: "R2 A1 O2" },
  "/schedule/settings": { min: 7, also: ["agm"], only: ["agm", ...GM_PLUS], entries: "R2 A1 O2" },
  "/admin/users": { min: 7, entries: "" },
  "/admin/stations": { min: 6, entries: "A1 O3" }, // E3: the admin shell only
  "/admin/toast-employees": { min: 7, entries: "O1" },
  "/admin/sevenshifts": { min: 7, also: OP6, entries: "R1 O1" },
  "/admin/people-reconcile": { min: 7, only: GM_PLUS, entries: "R2 A1 O2" },
  "/admin/pm-criteria": { min: 7, only: GM_PLUS, entries: "R1 A1 O2" },
  "/admin/sandwiches": { min: 6, only: [...OP6, ...GM_PLUS], entries: "R1 O1" },
  "/admin/recipes": { min: 6, entries: "" },
  "/admin/items": { min: 6, entries: "R1" },
  "/admin/catalog/notices": { min: 7, entries: "R1 A2 O2" },
  "/admin/catalog/shop-changes": { min: 8, entries: "R1 A1 O1" },
  "/admin/catalog/new/sandwich": { min: 7, only: GM_PLUS, entries: "R1 A1 O2" },
  "/admin/vendors": { min: 6, entries: "" },
  "/admin/skus": { min: 6, entries: "A1 O1" },
  "/admin/products": { min: 6, entries: "A1 O1" },
  "/admin/pars": { min: 6, only: [...OP6, ...GM_PLUS], entries: "R2 A1 O2" },
  "/admin/weights": { min: 6, entries: "" },
  "/admin/categories": { min: 6, entries: "" }, // E2: the page admits from 6
  "/admin/locations": { min: 8, only: MOO_PLUS, entries: "" },
  "/admin/demand-signals": { min: 7, only: GM_PLUS, sw: "demandSignals", entries: "R1 O1" },
  "/admin/demand-signals/sources": { min: 8, only: MOO_PLUS, sw: "demandSignals", entries: "" },
  "/admin/catalog/new/item": { min: 7, only: GM_PLUS, entries: "R1 A1 O2" },
  "/admin/checklist-templates": { min: 6, entries: "" }, // E1: the page admits from 6
  "/admin/report-recipients": { min: 7, entries: "" },
  "/admin/customers": { min: 7, entries: "A1" }, // switch off: the disabled view, still from 7
  "/admin/customers/catering": { min: 7, sw: "customerProfiles", entries: "" },
  "/admin/customers/consent": { min: 9, sw: "customerProfiles", entries: "" },
  "/admin/marketing": { min: 8, only: MOO_PLUS, entries: "A1 O2" }, // SW1: the page reads no switch
  "/admin/audit": { min: 9, entries: "" },
  "/settings": { min: 0, entries: "" },
  "/my-feedback": { min: 0, entries: "A5 O1" },
  "/training": { min: 0, entries: "A1" },
  "/vault": { min: 0, sw: "vault", entries: "" },
};

function expected(rule: PageRule, role: RoleCode, switches: Switches, facts: Facts): boolean {
  const level = ROLES[role].level;
  const floor = rule.floorOn && switches[rule.floorOn[0]] ? rule.floorOn[1] : rule.min;
  const byTask = rule.task !== undefined && level >= rule.task[1] && (facts.assignedTasks?.has(rule.task[0]) ?? false);
  return (level >= floor || (rule.also?.includes(role) ?? false) || byTask)
    && (rule.only === undefined || rule.only.includes(role))
    && !(rule.not?.includes(role) ?? false)
    && (rule.sw === undefined || switches[rule.sw] === true)
    && (!rule.gmFact || role !== "gm" || facts.businessReportOffered === true);
}

const MEANING_CODE = { refuse: "R", admit: "A", "success-redirect": "SR", "operational-error": "O" } as const;

describe("a real-source fixture for every destination page", () => {
  const reader = newReader();
  const byKey = new Map(ENTRIES.map((e) => [entryKey(e), e]));

  it("the table covers exactly the 85 destination pages", () => {
    expect(Object.keys(RULES).sort()).toEqual(destinationPages().map((p) => p.route).sort());
  });

  it.each(destinationPages().map((p) => [p.route] as const))("%s: the entries it consumes and the roles it admits", (route) => {
    const rule = RULES[route]!;
    const counts: Record<string, number> = {};
    for (const k of reader.consumes(route)) { const c = MEANING_CODE[byKey.get(k)!.meaning!.kind]; counts[c] = (counts[c] ?? 0) + 1; }
    expect(["R", "A", "SR", "O"].filter((c) => counts[c]).map((c) => `${c}${counts[c]}`).join(" "), `${route} entries`).toBe(rule.entries);
    const factSets: Facts[] = [{}];
    if (rule.task) factSets.push({ assignedTasks: new Set([rule.task[0]]) });
    if (rule.gmFact) factSets.push({ businessReportOffered: true });
    const wrong: string[] = [];
    for (const facts of factSets) for (const role of ALL_ROLES) {
      const got = admitMatrix(reader, route, role, facts);
      got.forEach((admitted, i) => {
        if (admitted !== expected(rule, role, SWITCH_COMBOS[i]!, facts)) wrong.push(`${role} ${JSON.stringify(SWITCH_COMBOS[i])} ${JSON.stringify({ ...facts, assignedTasks: facts.assignedTasks && [...facts.assignedTasks] })}: page ${admitted ? "admits" : "refuses"}`);
      });
    }
    expect(wrong.slice(0, 10)).toEqual([]);
  });

  it("Schedule admits the AGM; People reconciliation refuses it (canViewReconciliation)", () => {
    expect(reader.admits("/schedule", { role: "agm", switches: {} }).admitted).toBe(true);
    expect(reader.admits("/admin/people-reconcile", { role: "agm", switches: {} }).admitted).toBe(false);
    expect(reader.admits("/admin/people-reconcile", { role: "gm", switches: {} }).admitted).toBe(true);
  });

  it("Shop pulse: v2 on walks PulseHome (its denied entry), v1 its own refusal view", () => {
    const on = reader.admits("/mid-shift", { role: "trainee", switches: { pulseV2: true } });
    expect(on.admitted).toBe(true);
    expect(on.trace.join("\n")).toContain("enters components/pulse/PulseHome.tsx#PulseHome");
    expect(reader.admits("/mid-shift", { role: "trainee", switches: {} }).admitted).toBe(false);
    expect(reader.admits("/mid-shift", { role: "hired_not_yet_worked", switches: { pulseV2: true } }).admitted).toBe(false);
  });

  it("the trends pages and Shift reports are read through renderPage / renderReportsPage", () => {
    for (const route of ["/reports/trends", "/reports/trends/ops", "/reports/trends/team", "/my-feedback"]) {
      expect(reader.admits(route, { role: "cgs", switches: {} }).trace.join("\n"), route).not.toContain("UNSUPPORTED");
    }
    expect(reader.admits("/reports/trends/ops", { role: "social_media_mgr", switches: {} }).admitted).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// The hard shapes
// ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const PM = "app/(authed)/pm-report/page.tsx";
const V2_FORK: ForceArm = { file: PM, textStartsWith: 'if (day.format === "v2")', arm: "then" };
const SUBMITTED: ForceArm = { file: PM, textStartsWith: 'if (state && state.status !== "open")', arm: "then" };
const CATCH = (arm: "caught" | "not-thrown"): ForceArm => ({ file: PM, textStartsWith: "loadDayResults(sb, { actor, locationId, date }).catch(", arm });

describe("PM report v2, a submitted day: the per-record restriction view (lead ruling)", () => {
  const reader = newReader();
  it.each([
    ["key holder who contributed a substantive copy", "key_holder", "not-thrown"],
    ["key holder who did not contribute (forbidden → null)", "key_holder", "caught"],
    ["GM (manager control)", "gm", "not-thrown"],
  ] as const)("%s: admitted", (_who, role, arm) => {
    const v = reader.admits("/pm-report", { role, switches: {} }, { forceArm: [V2_FORK, SUBMITTED, CATCH(arm)] });
    expect(v.admitted).toBe(true);
  });

  it("the caught arm renders pmv2.results.noAccess on the page itself", () => {
    expect(readFileSync(PM, "utf8")).toContain('body = results ? <PmDayResults results={results} /> : <p className="co-card p-4 text-sm text-co-text">{serverT(lang, "pmv2.results.noAccess")}</p>;');
  });

  it("a mutation that files the .catch as a refusal flips the non-contributing key holder: review owns the meaning", () => {
    const entries = ENTRIES.map((e) => (e.file === PM && e.kind === "enclosing-.catch" ? { ...e, meaning: { kind: "refuse" as const, when: "auth.level >= 0", why: "mutation" } } : e));
    const mutated = newReader({ entries });
    expect(mutated.admits("/pm-report", { role: "key_holder", switches: {} }, { forceArm: [V2_FORK, SUBMITTED, CATCH("caught")] }).admitted).toBe(false);
    expect(mutated.admits("/pm-report", { role: "key_holder", switches: {} }, { forceArm: [V2_FORK, SUBMITTED, CATCH("not-thrown")] }).admitted).toBe(true);
  });

  it("the social media manager is refused on the v2 arm (canSubmitPmDay), so must-admit refuses it", () => {
    expect(reader.admits("/pm-report", { role: "social_media_mgr", switches: {} }).admitted).toBe(false);
    expect(reader.admits("/pm-report", { role: "social_media_mgr", switches: {} }, { forceArm: [{ ...V2_FORK, arm: "else" }] }).admitted).toBe(true);
  });
});

describe("AM prep list in edit mode", () => {
  const reader = newReader();
  const EDIT = "if (editRequested && !access.canEdit)";
  it("the entry request never reaches the edit-mode redirect", () => {
    for (const role of ALL_ROLES) {
      const v = reader.admits("/operations/am-prep", { role, switches: {} });
      expect(v.trace.join("\n"), role).not.toContain("success-redirect");
    }
  });
  it("an ?edit=true request that may not edit answers exactly what the entry request answers (the target is the view mode)", () => {
    for (const role of ALL_ROLES) for (const facts of [{}, { assignedTasks: new Set<TaskType>(["am_prep"]) }] as Facts[]) {
      const entry = reader.admits("/operations/am-prep", { role, switches: {}, facts }).admitted;
      const edit = reader.admits("/operations/am-prep", { role, switches: {}, facts }, { params: { location: S, edit: "true" }, forceArm: [{ file: "app/(authed)/operations/am-prep/page.tsx", textStartsWith: EDIT, arm: "then" }] });
      expect(edit.admitted, role).toBe(entry);
      if (entry) expect(edit.trace.join("\n")).toContain("success-redirect: evaluates /operations/am-prep?location=shop-S");
    }
  });
});

describe("Mid-day prep: zero, one and many instances", () => {
  const MID = "app/(authed)/operations/mid-day/page.tsx";
  const ONE = "if (dashState.instances.length === 1)";
  const arm = (a: "then" | "else"): ForceArm[] => [{ file: MID, textStartsWith: ONE, arm: a }];
  const assigned: Facts = { assignedTasks: new Set<TaskType>(["mid_day_prep"]) };
  const reader = newReader();
  it.each([
    ["employee assigned mid_day_prep", "employee", assigned, [true, true, true]],
    ["employee not assigned", "employee", {}, [false, false, false]],
    ["key holder, not assigned", "key_holder", {}, [true, true, true]],
  ] as const)("%s: 0 / 1 / 2 instances", (_who, role, facts, want) => {
    const got = [arm("else"), arm("then"), arm("else")].map((f) => reader.admits("/operations/mid-day", { role, switches: {}, facts }, { forceArm: f }).admitted);
    expect(got).toEqual(want);
  });
  it("the one-instance redirect is a navigation: the target (the instance branch) is evaluated", () => {
    const v = reader.admits("/operations/mid-day", { role: "employee", switches: {}, facts: assigned }, { forceArm: arm("then") });
    expect(v.trace.join("\n")).toContain("success-redirect: evaluates /operations/mid-day?instance=instance-1");
  });
  it("a mutation of the target to a page that refuses the employee flips the answer", () => {
    const entries = ENTRIES.map((e) => (e.file === MID && e.meaning?.kind === "success-redirect" ? { ...e, meaning: { ...e.meaning, target: "/admin/users" } } : e));
    const mutated = newReader({ entries });
    expect(mutated.admits("/operations/mid-day", { role: "employee", switches: {}, facts: assigned }, { forceArm: arm("then") }).admitted).toBe(false);
  });
});

describe("Astra r5 P3: Station setup's sync call is a reviewed admit, never an operational error", () => {
  const STATIONS = "app/admin/stations/page.tsx";
  const sync = ENTRIES.find((e) => e.file === STATIONS && e.kind === "standalone");
  it("the construct is `if (selected && auth.level >= 7) await syncStationsFromClosing(...)`, filed admit with the helper's rule pinned", () => {
    expect(sync?.text).toMatch(/^if \(selected && auth\.level >= 7\) await syncStationsFromClosing\(/);
    expect(sync?.meaning?.kind).toBe("admit");
    expect(sync?.pins).toEqual([{ file: "lib/closing-stations.ts", text: 'if (getRoleLevel(actor.role) < 8 && !lockLocationContext(actor, locationId)) throw new Error("location_access_denied");' }]);
  });
  it("filed as an operational error, the mechanical rule refuses it (its guard reads the session)", () => {
    const entries = ENTRIES.map((e) => (e === sync ? { ...e, meaning: { kind: "operational-error" as const, why: "mutation" } } : e));
    expect(() => newReader({ entries }).load(STATIONS)).toThrow(/OPERATIONAL_MENTIONS_SESSION/);
  });
  it("the admit entry preserves admission: the page admits from the admin shell's 6 (E3), sync or not", () => {
    const reader = newReader();
    for (const role of ALL_ROLES) expect(reader.admits("/admin/stations", { role, switches: {} }).admitted, role).toBe(ROLES[role].level >= 6);
    expect(reader.admits("/admin/stations", { role: "gm", switches: {} }).trace.join("\n")).toContain("admit: the call runs and the page continues");
  });
  it("a change to the pinned helper rule fails the entry", () => {
    const lib = readFileSync("lib/closing-stations.ts", "utf8").replace("getRoleLevel(actor.role) < 8", "getRoleLevel(actor.role) < 9");
    expect(() => newReader({ sources: { "lib/closing-stations.ts": lib } }).load(STATIONS)).toThrow(/ENTRY_TEXT_MISMATCH/);
  });
});
