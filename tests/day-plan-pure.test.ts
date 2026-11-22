/**
 * Nav PR 5 (plan r4, 13): purity, and the one usual-time comparison.
 *
 * THREAT MODEL (lead rulings D, binding): these guards are a NON-ADVERSARIAL consistency check that catches honest
 * mistakes. They are not a security boundary. They are closed by decidable syntactic and type-level bans on whole classes,
 * not by dataflow tracking. KNOWN LIMITS, out of scope: a bypass that needs deliberate obfuscation (building a member name
 * from strings, eval, Function, Reflect.get with a computed key, re-exporting through a JSON or .d.ts trick, a forbidden
 * call reached through an untyped package global) is not caught and is not chased.
 *
 *  1. The transitive import closure of the two new modules reaches nothing server-side and no package (self-proof below).
 *  2. No clock and no randomness in ANY module of the closure (comments stripped). `new Date(<arg>)` is date math.
 *  3. No I/O, timers or environment in any module of the closure; in the two new files also no toLocale, no t( call, no
 *     i18n server or provider import.
 *  4. (Runtime) tests/day-plan-stable.test.ts proves no transitive clock read is used (vi.setSystemTime).
 *  5. The station close is source-agnostic: the engine names no close table.
 *  6. Rules U1-U6 (U3′ and U5′ per plan r4): the usual close time meets the clock only inside `effectiveClose`.
 *  7. Mutations: each must turn its named rule red (in-memory copies, injected readers).
 *  8. The positive fixture (tests/fixtures/day-plan/guard-positive.ts): the approved shape passes every U-rule.
 */
import { resolve as resolvePath } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { EARLY_CUTOFF_GRACE_MIN, MIDDAY_WINDOW_MIN, SOON_MIN, URGENT_MIN } from "@/lib/day-plan-shared";
import { approvedShape } from "./fixtures/day-plan/guard-positive";
import { station } from "./fixtures/day-plan/build";
import { diskReader, importClosure, importSpecifiers, stripComments, type Reader } from "./fixtures/schedule/no-notify-closure";

const ENGINE = "lib/day-plan-shared.ts";
// Nav PR 6: the loader's pure companion joins the scan (plan r3, 8.1 item 9).
const ENTRIES = [ENGINE, "lib/scheduling/catering-day-shared.ts", "lib/day-plan-load-shared.ts"];
const POSITIVE = "tests/fixtures/day-plan/guard-positive.ts";
const norm = (p: string) => p.split("\\").join("/");
const overlay = (over: Record<string, string>): Reader => (p) => over[norm(p)] ?? diskReader(p);

// ── 1-3: the closure ─────────────────────────────────────────────────────────────────────────────────────────────────

const FORBIDDEN_MODULE = /^(server-only$|next\/|@\/lib\/supabase|@\/lib\/session$|@\/lib\/auth|@\/lib\/locations$|@\/lib\/notifications$|@\/lib\/email$|@\/lib\/scheduling\/works-as-shared$|@\/lib\/i18n\/server$|@\/lib\/i18n\/provider$)/;
const FORBIDDEN_FILE = /^lib\/(supabase|session|auth|locations|notifications|email|scheduling\/works-as-shared|i18n\/server|i18n\/provider)/;
/** Packages the closure may import: none at 63bc36e4 (a new one is a review event). */
const PACKAGE_ALLOWLIST: readonly string[] = [];
const CLOCK = [/\bDate\.now\s*\(/, /\bnew\s+Date\s*\(\s*\)/, /\bperformance\.now\b/, /\bMath\.random\b/, /\bcrypto\.getRandomValues\b/, /\bcrypto\.randomUUID\b/];
const IO = [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bnavigator\./, /\blocalStorage\b/, /\bsessionStorage\b/, /\bdocument\./,
  /\bsetTimeout\b/, /\bsetInterval\b/, /\bsetImmediate\b/, /\brequestAnimationFrame\b/, /\bprocess\.env\b/, /\brequire\s*\(/];
const NEW_FILE_ONLY = [/toLocale/, /(^|[^\w.])t\s*\(/];

function closureFindings(read: Reader = diskReader): string[] {
  const c = importClosure(ENTRIES, read);
  const out: string[] = [];
  for (const f of c.files) {
    const src = read(f)!;
    const n = norm(f);
    if (FORBIDDEN_FILE.test(n)) out.push(`1 forbidden module reached: ${n}`);
    for (const spec of importSpecifiers(src, f)) if (FORBIDDEN_MODULE.test(spec)) out.push(`1 forbidden import ${spec} in ${n}`);
    const first = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS).statements[0];
    if (first && ts.isImportDeclaration(first) && ts.isStringLiteral(first.moduleSpecifier) && first.moduleSpecifier.text === "server-only") out.push(`1 server-only first statement: ${n}`);
    const code = stripComments(src);
    for (const re of CLOCK) if (re.test(code)) out.push(`2 clock/randomness ${re} in ${n}`);
    for (const re of IO) if (re.test(code)) out.push(`3 I/O, timer or environment ${re} in ${n}`);
    if (ENTRIES.includes(n)) for (const re of NEW_FILE_ONLY) if (re.test(code)) out.push(`3 ${re} in ${n}`);
  }
  for (const [pkg, from] of c.packages) if (!PACKAGE_ALLOWLIST.includes(pkg)) out.push(`1 package ${pkg} (from ${norm(from)})`);
  return out.sort();
}

describe("1-3: the import closure is pure", () => {
  it("walks the real closure (not vacuous) and finds nothing", () => {
    const c = importClosure(ENTRIES);
    expect(c.files.size).toBeGreaterThan(20);
    for (const f of ["lib/vendor-rhythm-shared.ts", "lib/operational-day.ts", "lib/nav/destinations.ts", "lib/scheduling/structure-shared.ts"]) {
      expect([...c.files].map(norm)).toContain(f);
    }
    expect([...c.packages.keys()]).toEqual(PACKAGE_ALLOWLIST);
    expect(closureFindings()).toEqual([]);
  });

  it("the only raw clock hit in the closure is the known comment in lib/operational-day.ts, which stripping removes", () => {
    const raw = [...importClosure(ENTRIES).files].filter((f) => CLOCK.some((re) => re.test(diskReader(f)!))).map(norm);
    expect(raw).toEqual(["lib/operational-day.ts"]);
  });

  it("5. source-agnostic: the engine names no station-close table", () => {
    const src = diskReader(ENGINE)!;
    for (const t of ["station_closures", "checklist_completions", "station_events"]) expect(src).not.toContain(t);
  });
});

describe("7 (closure mutations): each turns its rule red", () => {
  const withLine = (f: string, line: string) => ({ [f]: `${diskReader(f)!}\n${line}\n` });
  it("a session import two hops down (engine → vendor-rhythm-shared → et-day-shared) → rule 1", () => {
    const f = overlay({ "lib/et-day-shared.ts": `import "@/lib/session";\n${diskReader("lib/et-day-shared.ts")!}` });
    expect(closureFindings(f).some((x) => x.startsWith("1 ") && x.includes("@/lib/session"))).toBe(true);
  });
  it("a reached helper gains Date.now() → rule 2", () => {
    expect(closureFindings(overlay(withLine("lib/vendor-rhythm-shared.ts", "export const stamp = () => Date.now();")))).toEqual([
      "2 clock/randomness /\\bDate\\.now\\s*\\(/ in lib/vendor-rhythm-shared.ts",
    ]);
  });
  it("the same helper gains fetch(\"/x\") → rule 3", () => {
    expect(closureFindings(overlay(withLine("lib/vendor-rhythm-shared.ts", 'export const ping = () => fetch("/x");')))).toEqual([
      "3 I/O, timer or environment /\\bfetch\\s*\\(/ in lib/vendor-rhythm-shared.ts",
    ]);
  });
  it("lib/operational-day.ts gains setTimeout(() => 0) → rule 3", () => {
    expect(closureFindings(overlay(withLine("lib/operational-day.ts", "setTimeout(() => 0);")))).toEqual([
      "3 I/O, timer or environment /\\bsetTimeout\\b/ in lib/operational-day.ts",
    ]);
  });
  it("a package import, a toLocale call and a t( call in the engine → rules 1 and 3", () => {
    const f = overlay({ [ENGINE]: `import dayjs from "dayjs";\n${diskReader(ENGINE)!}\nexport const x = (d: Date) => d.toLocaleString();\nconst t = (k: string) => k; t("x");\n` });
    const found = closureFindings(f);
    expect(found).toContain("1 package dayjs (from lib/day-plan-shared.ts)");
    expect(found.filter((x) => x.startsWith("3 /")).length).toBe(2);
  });
});

// ── 6: rules U1-U6 over a TypeScript program ────────────────────────────────────────────────────────────────────────

type Rule = "U1" | "U2" | "U3′" | "U4" | "U5′a" | "U5′b" | "U6";
interface Finding { readonly rule: Rule; readonly where: string }

const OPTIONS: ts.CompilerOptions = {
  strict: true, noUncheckedIndexedAccess: true, target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true, noEmit: true, skipLibCheck: true,
  baseUrl: process.cwd(), paths: { "@/*": ["./*"] }, types: [], lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
};
let lastProgram: ts.Program | undefined;
function programFor(file: string, text: string): { program: ts.Program; sf: ts.SourceFile } {
  const abs = norm(resolvePath(file));
  const host = ts.createCompilerHost(OPTIONS, true);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, onError, create) =>
    norm(name).toLowerCase() === abs.toLowerCase() ? ts.createSourceFile(name, text, lang, true, ts.ScriptKind.TS) : getSourceFile(name, lang, onError, create);
  const readFile = host.readFile.bind(host);
  host.readFile = (name) => (norm(name).toLowerCase() === abs.toLowerCase() ? text : readFile(name));
  const program = ts.createProgram({ rootNames: [abs], options: OPTIONS, host, oldProgram: lastProgram });
  lastProgram = program;
  const sf = program.getSourceFiles().find((s) => norm(s.fileName).toLowerCase() === abs.toLowerCase())!;
  return { program, sf };
}

const isFn = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
function fnName(n: ts.FunctionLikeDeclaration): string {
  if (n.name && ts.isIdentifier(n.name)) return n.name.text;
  if (ts.isVariableDeclaration(n.parent) && ts.isIdentifier(n.parent.name)) return n.parent.name.text;
  return "<anonymous>";
}
function enclosing(n: ts.Node): string[] {
  const out: string[] = [];
  for (let p = n.parent; p; p = p.parent) if (isFn(p)) out.push(fnName(p));
  return out;
}
const insideFn = (n: ts.Node, name: string) => enclosing(n).includes(name);
function walk(n: ts.Node, visit: (n: ts.Node) => void): void {
  visit(n);
  n.forEachChild((c) => walk(c, visit));
}
const line = (sf: ts.SourceFile, n: ts.Node) => `${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
/** The member name a node uses, for property access, string element access, binding and object-literal forms. */
function memberName(n: ts.Node): string | null {
  if (ts.isPropertyAccessExpression(n)) return n.name.text;
  if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)) return n.argumentExpression.text;
  if (ts.isBindingElement(n)) {
    const key = n.propertyName ?? n.name;
    return ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : null;
  }
  if (ts.isShorthandPropertyAssignment(n)) return n.name.text;
  if (ts.isPropertyAssignment(n) || ts.isPropertySignature(n)) return ts.isIdentifier(n.name) || ts.isStringLiteralLike(n.name) ? n.name.text : null;
  return null;
}

function uRules(file: string, text: string): Finding[] {
  const { program, sf } = programFor(file, text);
  const checker = program.getTypeChecker();
  const out: Finding[] = [];
  const add = (rule: Rule, n: ts.Node, note = "") => out.push({ rule, where: `${line(sf, n)}${note ? ` ${note}` : ""}` });

  walk(sf, (n) => {
    const name = memberName(n);
    // U1: usuallyClosesAt only inside normalizeStations and in the DayStation interface declaration.
    if (name === "usuallyClosesAt") {
      const inDayStation = ts.isPropertySignature(n) && ts.isInterfaceDeclaration(n.parent) && n.parent.name.text === "DayStation";
      if (!inDayStation && !insideFn(n, "normalizeStations")) add("U1", n);
    }
    // U3′: `wall` only inside brandUsual / usualMinutes, or as a verbatim copy that is directly an object-literal property's
    // value. (Its "no nowMin in that function" half is enforced by U5′(a), so each mutation names exactly one rule.)
    if (name === "wall" && !ts.isPropertySignature(n) && !ts.isPropertyAssignment(n) && !insideFn(n, "brandUsual") && !insideFn(n, "usualMinutes")) {
      const verbatim = ts.isPropertyAccessExpression(n) && ts.isPropertyAssignment(n.parent) && n.parent.initializer === n && ts.isObjectLiteralExpression(n.parent.parent);
      if (!verbatim) add("U3′", n);
    }
    // U2: brandUsual / usualMinutes declared once, not exported, called only by their one caller, never used as a value.
    if (ts.isIdentifier(n) && (n.text === "brandUsual" || n.text === "usualMinutes")) {
      const caller = n.text === "brandUsual" ? "normalizeStations" : "effectiveClose";
      if (ts.isFunctionDeclaration(n.parent) && n.parent.name === n) {
        if (n.parent.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) add("U2", n, `${n.text} exported`);
      } else if (!(ts.isCallExpression(n.parent) && n.parent.expression === n && insideFn(n, caller))) {
        add("U2", n, `${n.text} outside ${caller} or not a call`);
      }
    }
    // U4: no assertion names UsualClose / NormalStation; no `as unknown` / `as any` anywhere.
    if (ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) || ts.isSatisfiesExpression(n)) {
      if (ts.isAsExpression(n) && (n.type.kind === ts.SyntaxKind.UnknownKeyword || n.type.kind === ts.SyntaxKind.AnyKeyword)) add("U4", n, "as unknown/any");
      walk(n.type, (t) => {
        if (ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && (t.typeName.text === "UsualClose" || t.typeName.text === "NormalStation")) add("U4", n, t.typeName.text);
      });
    }
    // U6: normalizeStations calls no numeric parser; its rank comes from string order only.
    if (ts.isCallExpression(n) && insideFn(n, "normalizeStations")) {
      const callee = n.expression;
      if (ts.isIdentifier(callee) && ["cutoffMinutes", "clockToMinutes", "Number", "parseInt", "parseFloat"].includes(callee.text)) add("U6", n, callee.text);
      if (ts.isPropertyAccessExpression(callee) && ["split", "exec", "match"].includes(callee.name.text)) add("U6", n, callee.name.text);
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "Number"
        && ["parseInt", "parseFloat"].includes(callee.name.text)) add("U6", n, `Number.${callee.name.text}`);
    }
    // U6: no unary + (a numeric coercion) inside normalizeStations either. (A unary + on `.wall` anywhere else is U3′.)
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.PlusToken && insideFn(n, "normalizeStations")) add("U6", n, "unary +");
    // U5′: no function but effectiveClose both mentions nowMin and (a) reads `.wall` of a UsualClose or (b) calls usualMinutes.
    if (isFn(n) && fnName(n) !== "effectiveClose") {
      let now = false;
      let wall = false;
      let unbrand = false;
      walk(n, (c) => {
        if (ts.isIdentifier(c) && c.text === "nowMin") now = true;
        if (ts.isPropertyAccessExpression(c) && c.name.text === "wall") {
          const t = checker.getNonNullableType(checker.getTypeAtLocation(c.expression));
          if ((t.aliasSymbol ?? t.getSymbol())?.getName() === "UsualClose") wall = true;
        }
        if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "usualMinutes") unbrand = true;
      });
      if (now && wall) add("U5′a", n, fnName(n));
      if (now && unbrand) add("U5′b", n, fnName(n));
    }
  });
  return out;
}
const rulesOf = (f: Finding[]) => [...new Set(f.map((x) => x.rule))].sort();

describe("6: the one usual-time comparison (U1-U6)", () => {
  it("the engine passes every rule", () => {
    expect(uRules(ENGINE, diskReader(ENGINE)!)).toEqual([]);
  }, 60_000);

  it("8: the positive fixture, in the approved shape, passes every rule (and runs)", () => {
    expect(uRules(POSITIVE, diskReader(POSITIVE)!)).toEqual([]);
    const raw = [station({ id: "a", name: "A", sort: 1, floor: true, usuallyClosesAt: "13:30:00" }), station({ id: "b", name: "B", sort: 2, floor: true })];
    const shape = approvedShape(raw, 13 * 60 + 35, "2026-11-18");
    expect(shape.closes.map((c) => c?.by ?? null)).toEqual(["clock", null]);
    expect(shape.params).toEqual([{ station: "A", time: "13:30:00" }]);
  }, 60_000);

  it("the rules see the real thing: each U-rule has a site it allows in the engine", () => {
    const src = diskReader(ENGINE)!;
    expect(src).toMatch(/function normalizeStations[\s\S]*usuallyClosesAt/);
    expect(src).toMatch(/function effectiveClose[\s\S]*usualMinutes\(s\.usual\)/);
    expect(src).toMatch(/function usualMinutes\(u: UsualClose\)[^{]*\{\s*return cutoffMinutes\(u\.wall\);/);
  });
});

describe("7 (U-rule mutations on the positive fixture): each produces exactly its named finding", () => {
  const base = diskReader(POSITIVE)!;
  const add = (code: string) => `${base}\n${code}\n`;
  const MUTATIONS: [string, string, Rule[]][] = [
    ["a helper reading usuallyClosesAt into minutes", add("export function usualMin(s: DayStation) { return cutoffMinutes(s.usuallyClosesAt!); }"), ["U1"]],
    ["destructuring usuallyClosesAt in buildDay", add("export function buildDay(raw: DayStation) { const { usuallyClosesAt } = raw; return usuallyClosesAt; }"), ["U1"]],
    ["a parameter alias of the unbranding helper beside nowMin", add("export function late(u: UsualClose, nowMin: number) { return usualMinutes(u)! <= nowMin; }"), ["U2", "U5′b"]],
    ["a function that mentions nowMin and reads .wall verbatim", add("export function line(s: NormalStation, nowMin: number) { return { at: s.usual!.wall, now: nowMin }; }"), ["U5′a"]],
    ["a helper returning unbranded minutes from .wall", add("export function hhmm(u: UsualClose) { return Number(u.wall.slice(0, 2)) * 60; }"), ["U3′"]],
    ["a forged UsualClose", add('export const forged = ({ wall: "13:30" } as unknown as UsualClose);'), ["U4"]],
    ["normalizeStations ranking by Number.parseInt", base.replace("const rank = new Map(timed.map((s, i) => [s.id, i]));", "const rank = new Map(timed.map((s) => [s.id, Number.parseInt(s.usuallyClosesAt!, 10)]));"), ["U6"]],
    ["normalizeStations ranking by Number.parseFloat", base.replace("const rank = new Map(timed.map((s, i) => [s.id, i]));", "const rank = new Map(timed.map((s) => [s.id, Number.parseFloat(s.usuallyClosesAt!)]));"), ["U6"]],
    ["normalizeStations ranking by unary +", base.replace("const rank = new Map(timed.map((s, i) => [s.id, i]));", "const rank = new Map(timed.map((s) => [s.id, +s.usuallyClosesAt!.slice(0, 2)]));"), ["U6"]],
    ["a unary + on .wall outside the boundary", add("export function hours(u: UsualClose) { return +u.wall; }"), ["U3′"]],
    ["normalizeStations ranking by cutoffMinutes", base.replace("const rank = new Map(timed.map((s, i) => [s.id, i]));", "const rank = new Map(timed.map((s) => [s.id, cutoffMinutes(s.usuallyClosesAt!) ?? 0]));"), ["U6"]],
  ];

  it.each(MUTATIONS)("%s", (_label, text, rules) => {
    expect(text).not.toBe(base);
    expect(rulesOf(uRules(POSITIVE, text))).toEqual([...rules].sort());
  }, 60_000);

  it("a mutation applied to the ENGINE turns it red too (the alias beside nowMin)", () => {
    const text = `${diskReader(ENGINE)!}\nexport function late(u: UsualClose, nowMin: number) { return usualMinutes(u)! <= nowMin; }\n`;
    expect(rulesOf(uRules(ENGINE, text))).toEqual(["U2", "U5′b"]);
  }, 60_000);
});

describe("the tunables (3)", () => {
  it("equal 120, 30, 120, 60", () => {
    expect({ SOON_MIN, URGENT_MIN, MIDDAY_WINDOW_MIN, EARLY_CUTOFF_GRACE_MIN }).toEqual({ SOON_MIN: 120, URGENT_MIN: 30, MIDDAY_WINDOW_MIN: 120, EARLY_CUTOFF_GRACE_MIN: 60 });
  });
});
