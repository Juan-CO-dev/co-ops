/**
 * Nav spec r3 PR S1, review round 1 (Astra P2): the census is closed against NEW server entry points.
 *
 * tests/reports-smm-refusal.test.ts pins the gates that exist today. This file enumerates every server
 * entry point INDEPENDENTLY of the authentication calls already present, from the TypeScript AST:
 *
 *   - under app/(authed)/reports/**: every Next server entry file (page, layout, template, loading,
 *     not-found, default, route, opengraph/twitter image, icon, sitemap, manifest) and every "use server"
 *     module — each exported function (generateMetadata included) — plus every function anywhere in the
 *     tree that carries its own "use server" directive;
 *   - under app/api/reports/** and app/api/written-reports/**, and any app/api route that imports a report
 *     loader: every exported HTTP handler (GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS, however it is
 *     exported: a declaration, a const, an alias, a local re-export);
 *   - anywhere in app/: a "use server" module that imports a report loader.
 *
 * Each entry must run the session and then the report role rule as its very next statement, with nothing but
 * pure request parsing before them, or delegate straight to a local function that does, or be PROVEN
 * data-free (no call outside a small pure allowlist, no JSX, no `new`). A re-export from another module
 * cannot be verified here and fails. "use client" files are skipped: they run in the browser and reach data
 * only through a server entry, which this census covers.
 *
 * The negative fixtures at the bottom mutate real sources in memory and prove each kind of addition fails.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const REPORTS_TREE = "app/(authed)/reports/";
const API_DIRS = ["app/api/reports/", "app/api/written-reports/"];
const REPORT_LOADER_IMPORT = /from "@\/lib\/(report-export|reports-hub|reports-trends|written-reports|sales-reports|business-report|business-report-pdf|report-summary|report-package|report-related|reports-search|report-pdf)"/;
const NEXT_ENTRY_FILE = /^(page|layout|template|loading|not-found|default|route|opengraph-image|twitter-image|icon|apple-icon|sitemap|manifest)\.(tsx?|jsx?)$/;
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
/** Pure request parsing a gate may follow: nothing here reads data. */
const PURE_CALLS = new Set(["Promise.all", "decodeURIComponent", "assertSameOrigin", "parseJsonBody", "jsonError", "UUID_RE.test"]);

type Scope = "page" | "api";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|js|jsx)$/.test(entry) ? [full] : [];
  });
}
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

function hasDirective(statements: readonly ts.Statement[], directive: string): boolean {
  for (const statement of statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === directive) return true;
  }
  return false;
}

/** Calls (outside the pure allowlist), JSX and `new` are what can reach data. Nested function bodies are not run here. */
function impureParts(node: ts.Node, sf: ts.SourceFile): string[] {
  const found: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n)) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf);
      if (!PURE_CALLS.has(callee)) found.push(`${callee}()`);
    } else if (ts.isNewExpression(n)) found.push(`new ${n.expression.getText(sf)}`);
    else if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found.push("JSX");
    else if (ts.isTaggedTemplateExpression(n)) found.push("tagged template");
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** Every violation in one source file. `file` is the repo-relative path (it decides the scope). */
export function entryViolations(file: string, src: string): string[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (hasDirective(sf.statements, "use client")) return [];
  const inReports = file.startsWith(REPORTS_TREE);
  const inApi = API_DIRS.some((dir) => file.startsWith(dir));
  const baseName = file.slice(file.lastIndexOf("/") + 1);
  const moduleUseServer = hasDirective(sf.statements, "use server");
  const importsLoader = REPORT_LOADER_IMPORT.test(src);
  const isRoute = /^route\.(tsx?|jsx?)$/.test(baseName) && file.startsWith("app/api/");
  const scope: Scope | null = inReports ? "page" : inApi || (isRoute && importsLoader) ? "api" : moduleUseServer && importsLoader ? "page" : null;
  if (!scope) return [];
  const entryFile = (inReports && NEXT_ENTRY_FILE.test(baseName)) || isRoute || moduleUseServer;
  const violations: string[] = [];

  // Local functions by name (declarations and `const x = (async) function / arrow`).
  const locals = new Map<string, ts.FunctionLikeDeclaration>();
  const literalConsts = new Set<string>();
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) locals.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) locals.set(d.name.text, d.initializer);
        else if (impureParts(d.initializer, sf).length === 0) literalConsts.add(d.name.text);
      }
    }
  }

  const sessionRe = scope === "page" ? /^const (\w+) = await requireSessionFromHeaders\(/ : /^const (\w+) = await requireSession\(/;
  const gated = (fn: ts.FunctionLikeDeclaration, label: string, seen: Set<ts.Node>): string | null => {
    if (seen.has(fn)) return null;
    seen.add(fn);
    const body = fn.body;
    if (!body) return `${label}: no body to check`;
    if (!ts.isBlock(body)) {
      // An expression-bodied arrow: only a straight delegation, or a data-free value.
      const target = delegation(body);
      if (target) return gated(target, `${label} → ${target.name?.getText(sf) ?? "local"}`, seen);
      const impure = impureParts(body, sf);
      return impure.length ? `${label}: reads before the role rule (${impure.join(", ")})` : null;
    }
    const statements = body.statements.filter((s) => !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)));
    for (let i = 0; i < statements.length; i++) {
      const text = statements[i]!.getText(sf).trim();
      const session = text.match(sessionRe);
      if (session) {
        const v = session[1]!;
        const next = statements[i + 1]?.getText(sf).trim();
        if (scope === "page") {
          return next === `if (!reportsRoleAllowed(${v}.role)) redirect(REPORTS_DENIED_HREF);` ? null
            : `${label}: the statement after the session is not the report role rule`;
        }
        const after = statements[i + 2]?.getText(sf).trim();
        return next === `if (${v} instanceof Response) return ${v};` && after === `if (!reportsRoleAllowed(${v}.role)) return jsonError(403, "forbidden");` ? null
          : `${label}: the report role rule does not follow the session check`;
      }
      const statement = statements[i]!;
      if (ts.isReturnStatement(statement) && statement.expression) {
        const target = delegation(statement.expression);
        if (target) return gated(target, `${label} → ${target.name?.getText(sf) ?? "local"}`, seen);
      }
      const impure = impureParts(statements[i]!, sf);
      if (impure.length) return `${label}: reads before the role rule (${impure.join(", ")})`;
    }
    return null; // proven data-free: no session needed, nothing read
  };
  /** `localFn(pure args)` or `await localFn(pure args)`, to a function in this file. */
  const delegation = (expr: ts.Expression): ts.FunctionLikeDeclaration | null => {
    const inner = ts.isAwaitExpression(expr) ? expr.expression : expr;
    if (!ts.isCallExpression(inner) || !ts.isIdentifier(inner.expression)) return null;
    const target = locals.get(inner.expression.text);
    if (!target) return null;
    return inner.arguments.every((a) => impureParts(a, sf).length === 0) ? target : null;
  };

  const check = (name: string, fn: ts.FunctionLikeDeclaration | undefined) => {
    if (!fn) { violations.push(`${file} ${name}: exported but not a function defined in this file`); return; }
    const problem = gated(fn, `${file} ${name}`, new Set());
    if (problem) violations.push(problem);
  };
  const resolve = (expr: ts.Expression): ts.FunctionLikeDeclaration | undefined =>
    ts.isArrowFunction(expr) || ts.isFunctionExpression(expr) ? expr : ts.isIdentifier(expr) ? locals.get(expr.text) : undefined;
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  if (entryFile) {
    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement) && exported(statement)) {
        check(isDefault(statement) ? "default" : statement.name?.text ?? "anonymous", statement);
      } else if (ts.isVariableStatement(statement) && exported(statement)) {
        for (const d of statement.declarationList.declarations) {
          const name = d.name.getText(sf);
          if (!d.initializer) { violations.push(`${file} ${name}: exported without a value`); continue; }
          const fn = resolve(d.initializer);
          if (fn) check(name, fn);
          else if (ts.isIdentifier(d.initializer) && literalConsts.has(d.initializer.text)) continue;
          else if (impureParts(d.initializer, sf).length || HTTP_METHODS.has(name)) check(name, undefined);
        }
      } else if (ts.isExportAssignment(statement)) {
        check("default", resolve(statement.expression));
      } else if (ts.isExportDeclaration(statement)) {
        if (statement.moduleSpecifier) { violations.push(`${file}: re-exports from another module (cannot be verified here)`); continue; }
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const spec of statement.exportClause.elements) {
            const local = (spec.propertyName ?? spec.name).text;
            if (literalConsts.has(local) && !HTTP_METHODS.has(spec.name.text)) continue;
            check(spec.name.text, locals.get(local));
          }
        }
      }
    }
  }

  // Any function anywhere in scope with its own "use server" directive is a server action.
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n) && (n as ts.FunctionLikeDeclaration).body && ts.isBlock((n as ts.FunctionLikeDeclaration).body!)
      && hasDirective(((n as ts.FunctionLikeDeclaration).body as ts.Block).statements, "use server")) {
      const name = (n as ts.FunctionLikeDeclaration).name?.getText(sf) ?? "inline action";
      const problem = gated(n as ts.FunctionLikeDeclaration, `${file} "use server" ${name}`, new Set());
      if (problem) violations.push(problem);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  // Module-level code in an entry file runs on import: it may not read data.
  if (entryFile) {
    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement) || ts.isImportDeclaration(statement) || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement) || ts.isExportDeclaration(statement) || ts.isExportAssignment(statement)) continue;
      if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) continue;
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (!d.initializer || resolve(d.initializer)) continue;
          const impure = impureParts(d.initializer, sf);
          if (impure.length) violations.push(`${file}: module-level code reads on import (${impure.join(", ")})`);
        }
        continue;
      }
      const impure = impureParts(statement, sf);
      if (impure.length) violations.push(`${file}: module-level code reads on import (${impure.join(", ")})`);
    }
  }
  return violations;
}

const ALL_APP_FILES = walk(path.join(ROOT, "app")).map(rel);
const src = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

describe("the entry census over the real tree", () => {
  it("covers the report tree, the report API and every report-loading route or server action", () => {
    const inScope = ALL_APP_FILES.filter((file) => {
      const s = src(file);
      return file.startsWith(REPORTS_TREE) || API_DIRS.some((d) => file.startsWith(d))
        || (/\/route\.(tsx?|jsx?)$/.test(file) && file.startsWith("app/api/") && REPORT_LOADER_IMPORT.test(s))
        || (/^\s*["']use server["']/m.test(s) && REPORT_LOADER_IMPORT.test(s));
    });
    expect(inScope.filter((f) => f.startsWith(REPORTS_TREE)).length).toBeGreaterThanOrEqual(13);
    expect(inScope).toEqual(expect.arrayContaining(["app/api/reports/export/route.ts", "app/api/written-reports/route.ts", "app/api/written-reports/[id]/route.ts"]));
  });

  it("every server entry point is gated (or proven data-free) — no violations anywhere in app/", () => {
    const violations = ALL_APP_FILES.flatMap((file) => entryViolations(file, src(file)));
    expect(violations).toEqual([]);
  });
});

// ── Negative fixtures: in-memory mutations of real sources ───────────────────────────────────────

const WRITTEN_ROUTE = "app/api/written-reports/route.ts";
const HUB_PAGE = "app/(authed)/reports/page.tsx";
const ACTIONS = "app/(authed)/reports/actions.ts";

describe("negative fixtures: each kind of new entry point without the gate fails", () => {
  it("the unmutated sources pass (the fixtures below start from a clean file)", () => {
    expect(entryViolations(WRITTEN_ROUTE, src(WRITTEN_ROUTE))).toEqual([]);
    expect(entryViolations(HUB_PAGE, src(HUB_PAGE))).toEqual([]);
  });

  it("an unguarded GET added to a guarded route file", () => {
    const mutated = `${src(WRITTEN_ROUTE)}
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/written-reports");
  if (ctx instanceof Response) return ctx;
  return jsonOk(await listWrittenReports(getServiceRoleClient(), { viewer: ctx }));
}
`;
    expect(entryViolations(WRITTEN_ROUTE, mutated)).toEqual([expect.stringContaining("GET: the report role rule does not follow the session check")]);
  });

  it("a GET with no session at all, a const handler, an alias and a foreign re-export", () => {
    const base = src(WRITTEN_ROUTE);
    expect(entryViolations(WRITTEN_ROUTE, `${base}\nexport async function GET() { return jsonOk(await listWrittenReports()); }\n`))
      .toEqual([expect.stringContaining("GET: reads before the role rule")]);
    expect(entryViolations(WRITTEN_ROUTE, `${base}\nexport const GET = async () => jsonOk(await listWrittenReports());\n`))
      .toEqual([expect.stringContaining("GET: reads before the role rule")]);
    expect(entryViolations(WRITTEN_ROUTE, `${base}\nasync function list() { return jsonOk(await listWrittenReports()); }\nexport { list as GET };\n`))
      .toEqual([expect.stringContaining("GET: reads before the role rule")]);
    expect(entryViolations(WRITTEN_ROUTE, `${base}\nexport { GET } from "@/app/api/other/route";\n`))
      .toEqual([expect.stringContaining("re-exports from another module")]);
  });

  it("a read before the session in a guarded handler", () => {
    const mutated = src(WRITTEN_ROUTE).replace("  const ctx = await requireSession(req, \"/api/written-reports\");",
      "  await listWrittenReports(getServiceRoleClient(), {});\n  const ctx = await requireSession(req, \"/api/written-reports\");");
    expect(entryViolations(WRITTEN_ROUTE, mutated)).toEqual([expect.stringContaining("POST: reads before the role rule (listWrittenReports()")]);
  });

  it("a new actions.ts server action in the report tree", () => {
    const action = (gate: string) => `"use server";
import { requireSessionFromHeaders } from "@/lib/session";
import { listReports } from "@/lib/reports-hub";
export async function exportReportsAction(locationId: string) {
  const auth = await requireSessionFromHeaders("/reports");
${gate}  return listReports(getServiceRoleClient(), { viewer: auth, locationId });
}
`;
    expect(entryViolations(ACTIONS, action(""))).toEqual([expect.stringContaining("exportReportsAction: the statement after the session is not the report role rule")]);
    // The same action with the gate passes (the census is not simply refusing every new file).
    expect(entryViolations(ACTIONS, action("  if (!reportsRoleAllowed(auth.role)) redirect(REPORTS_DENIED_HREF);\n"))).toEqual([]);
  });

  it("a server action anywhere in app/ that imports a report loader", () => {
    const file = "app/(authed)/dashboard/report-actions.ts";
    expect(entryViolations(file, `"use server";\nimport { listReports } from "@/lib/reports-hub";\nexport async function peek() { return listReports(getServiceRoleClient(), {}); }\n`))
      .toEqual([expect.stringContaining("peek: reads before the role rule")]);
  });

  it("an inline \"use server\" function inside a report page", () => {
    const mutated = `${src(HUB_PAGE)}
export function Inline() {
  async function act() {
    "use server";
    await listReports(getServiceRoleClient(), {});
  }
  return act;
}
`;
    expect(entryViolations(HUB_PAGE, mutated)).toEqual(expect.arrayContaining([expect.stringContaining('"use server" act: reads before the role rule')]));
  });

  it("a generateMetadata that reads without the gate; a data-free one passes", () => {
    const reading = `${src(HUB_PAGE)}
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const detail = await loadReportDetail(getServiceRoleClient(), { id: (await params).id });
  return { title: detail.title };
}
`;
    expect(entryViolations(HUB_PAGE, reading)).toEqual([expect.stringContaining("generateMetadata: reads before the role rule (loadReportDetail()")]);
    const sessionOnly = `${src(HUB_PAGE)}
export async function generateMetadata() {
  const auth = await requireSessionFromHeaders("/reports");
  return { title: (await loadReportDetail(getServiceRoleClient(), { viewer: auth })).title };
}
`;
    expect(entryViolations(HUB_PAGE, sessionOnly)).toEqual([expect.stringContaining("generateMetadata: the statement after the session is not the report role rule")]);
    expect(entryViolations(HUB_PAGE, `${src(HUB_PAGE)}\nexport const metadata = { title: "Reports" };\nexport async function generateMetadata() { return { title: "Reports" }; }\n`)).toEqual([]);
  });

  it("a new layout, loading or image route that reads data", () => {
    expect(entryViolations("app/(authed)/reports/layout.tsx",
      `export default async function Layout({ children }: { children: React.ReactNode }) {\n  const n = await countHotTempReadings(getServiceRoleClient(), {});\n  return <section data-n={n}>{children}</section>;\n}\n`))
      .toEqual([expect.stringContaining("default: reads before the role rule (countHotTempReadings()")]);
    expect(entryViolations("app/(authed)/reports/loading.tsx", `export default function Loading() { return <p>Loading</p>; }\n`))
      .toEqual([expect.stringContaining("default: reads before the role rule (JSX)")]);
    expect(entryViolations("app/(authed)/reports/[type]/[id]/opengraph-image.tsx",
      `export default async function Image() { const r = await loadReportDetail(getServiceRoleClient(), {}); return new ImageResponse(<div>{r.title}</div>); }\n`))
      .toEqual([expect.stringContaining("default: reads before the role rule")]);
  });

  it("every real report page and route is enumerated: removing its gate in memory is a violation", () => {
    const pages = ALL_APP_FILES.filter((f) => f.startsWith(REPORTS_TREE) && f.endsWith("/page.tsx"));
    const routes = ALL_APP_FILES.filter((f) => API_DIRS.some((d) => f.startsWith(d)) && f.endsWith("/route.ts"));
    expect(pages.length).toBeGreaterThanOrEqual(13);
    expect(routes.length).toBeGreaterThanOrEqual(3);
    for (const file of pages) {
      const stripped = src(file).replace("if (!reportsRoleAllowed(auth.role)) redirect(REPORTS_DENIED_HREF);", "");
      expect(entryViolations(file, stripped).length, file).toBeGreaterThan(0);
    }
    for (const file of routes) {
      const stripped = src(file).replace('if (!reportsRoleAllowed(ctx.role)) return jsonError(403, "forbidden");', "");
      expect(entryViolations(file, stripped).length, file).toBeGreaterThan(0);
    }
  });

  it("a read hidden in a page's delegation or at module level", () => {
    const page = "app/(authed)/reports/trends/page.tsx";
    const viaArgs = src(page).replace("return renderPage(await searchParams);", "return renderPage(await loadTrendSeries(getServiceRoleClient()));");
    expect(entryViolations(page, viaArgs)).toEqual([expect.stringContaining("default: reads before the role rule")]);
    expect(entryViolations(HUB_PAGE, `${src(HUB_PAGE)}\nconst warm = listReports(getServiceRoleClient(), {});\n`))
      .toEqual([expect.stringContaining("module-level code reads on import (listReports()")]);
  });
});
