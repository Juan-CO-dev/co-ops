/**
 * Nav spec r3 PR S1 — the report family refuses the social media manager (section 8.2).
 *
 *   - the rule: `reportsRoleAllowed` refuses social_media_mgr and ONLY it (every other role unchanged,
 *     including the AGM / prep / catering managers who share level 6);
 *   - the census: every page.tsx under app/(authed)/reports/** runs the rule as the statement right
 *     after its session, and every report API route runs it right after its session check — so a new
 *     report page or route without it fails here;
 *   - the pages, rendered: a social media manager is sent to the Dashboard with the denial notice
 *     (`/dashboard?denied=reports`) before the database client is even asked for; an AGM (also
 *     level 6) is never sent there by this rule.
 *
 * The session is a stand-in (as in every page test here: there is no database in the vitest spine);
 * what is under test is the gate the page runs on the session it gets.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, type RoleCode } from "@/lib/roles";
import { REPORTS_DENIED_HREF, REPORTS_REFUSED_ROLES, reportsRoleAllowed } from "@/lib/reports-access-shared";
import { effectiveScheduleRole } from "@/lib/scheduling/works-as-shared";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, name: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, name));
    else if (entry === name) out.push(full);
  }
  return out;
}
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
/** The next line after `index` that is not blank and not a comment. */
function nextStatement(lines: string[], index: number): string {
  for (let i = index + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*")) continue;
    return t;
  }
  return "";
}

describe("the rule: reportsRoleAllowed, by role", () => {
  it("refuses the social media manager", () => {
    expect(reportsRoleAllowed("social_media_mgr")).toBe(false);
    expect(REPORTS_REFUSED_ROLES).toEqual(["social_media_mgr"]);
  });

  it.each(Object.keys(ROLES).filter((role) => role !== "social_media_mgr") as RoleCode[])("%s is unchanged (allowed)", (role) => {
    expect(reportsRoleAllowed(role)).toBe(true);
  });

  it("is by role, not level: every other level-6 role is allowed", () => {
    const level6 = (Object.keys(ROLES) as RoleCode[]).filter((role) => ROLES[role].level === 6);
    expect(level6.sort()).toEqual(["agm", "catering_mgr", "prep_mgr", "social_media_mgr"]);
    expect(level6.filter(reportsRoleAllowed).sort()).toEqual(["agm", "catering_mgr", "prep_mgr"]);
  });

  it("a scheduling \"works as\" role is NOT the input: the gates read the real role (auth.role / ctx.role)", () => {
    // The SMM may hold a works-as role, and that effective SCHEDULING role would pass the rule — which is why
    // every gate below is pinned to the session's real role, never an effective one.
    expect(effectiveScheduleRole("social_media_mgr", "key_holder")).toBe("key_holder");
    expect(reportsRoleAllowed("social_media_mgr")).toBe(false);
  });

  it("refused pages land on the Dashboard with the denial notice", () => {
    expect(REPORTS_DENIED_HREF).toBe("/dashboard?denied=reports");
    const en = JSON.parse(readFileSync(path.join(ROOT, "lib/i18n/en.json"), "utf8")) as Record<string, string>;
    const es = JSON.parse(readFileSync(path.join(ROOT, "lib/i18n/es.json"), "utf8")) as Record<string, string>;
    expect(en["dashboard.denied.reports"]).toBeTruthy();
    expect(es["dashboard.denied.reports"]).toBeTruthy();
    expect(es["dashboard.denied.reports"]).not.toBe(en["dashboard.denied.reports"]);
  });
});

const PAGE_GATE = "if (!reportsRoleAllowed(auth.role)) redirect(REPORTS_DENIED_HREF);";
const ROUTE_GATE = 'if (!reportsRoleAllowed(ctx.role)) return jsonError(403, "forbidden");';
const REPORT_PAGES = walk(path.join(ROOT, "app/(authed)/reports"), "page.tsx").map(rel).sort();

/** Report loader modules: an API route that imports one is a report route, wherever it lives. */
const REPORT_LOADER_IMPORT = /from "@\/lib\/(report-export|reports-hub|reports-trends|written-reports|sales-reports|business-report|business-report-pdf|report-summary|report-package|report-related|reports-search|report-pdf)"/;
const API_ROUTES = walk(path.join(ROOT, "app/api"), "route.ts").map(rel).sort();
const REPORT_ROUTES = API_ROUTES.filter((file) =>
  /^app\/api\/(reports|written-reports)\//.test(file) || REPORT_LOADER_IMPORT.test(readFileSync(path.join(ROOT, file), "utf8")));

describe("census: every report page refuses the role first", () => {
  it("finds the whole report tree (the census cannot pass on an empty walk)", () => {
    expect(REPORT_PAGES.length).toBeGreaterThanOrEqual(13);
    for (const page of ["app/(authed)/reports/page.tsx", "app/(authed)/reports/operations/page.tsx", "app/(authed)/reports/[type]/[id]/page.tsx",
      "app/(authed)/reports/written/page.tsx", "app/(authed)/reports/sales/page.tsx", "app/(authed)/reports/sales/checks/[checkGuid]/page.tsx",
      "app/(authed)/reports/trends/page.tsx", "app/(authed)/reports/trends/ops/page.tsx", "app/(authed)/reports/business/page.tsx"]) {
      expect(REPORT_PAGES).toContain(page);
    }
  });

  it.each(REPORT_PAGES)("%s: the role check is the statement right after the session", (file) => {
    const src = readFileSync(path.join(ROOT, file), "utf8");
    expect(src).toContain('from "@/lib/reports-access-shared"');
    const lines = src.split("\n");
    const sessions = lines.flatMap((line, i) => (/await requireSessionFromHeaders\(/.test(line) ? [i] : []));
    expect(sessions.length, `${file} has no session read`).toBeGreaterThan(0);
    for (const i of sessions) {
      expect(lines[i]).toMatch(/const auth = await requireSessionFromHeaders\(/);
      expect(nextStatement(lines, i), `${file}:${i + 1}`).toBe(PAGE_GATE);
    }
  });

  it("no report page reads the service client or a loader before its session", () => {
    for (const file of REPORT_PAGES) {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      const first = src.indexOf("await requireSessionFromHeaders(");
      const before = src.slice(0, first);
      expect(before, file).not.toMatch(/getServiceRoleClient\(\)|await load[A-Z]|await list[A-Z]/);
    }
  });
});

describe("census: every report API route refuses the role first", () => {
  it("finds the export and the written-report routes", () => {
    expect(REPORT_ROUTES).toEqual(expect.arrayContaining([
      "app/api/reports/export/route.ts", "app/api/written-reports/route.ts", "app/api/written-reports/[id]/route.ts",
    ]));
  });

  it.each(REPORT_ROUTES)("%s: the role check follows the session check", (file) => {
    const lines = readFileSync(path.join(ROOT, file), "utf8").split("\n");
    const sessions = lines.flatMap((line, i) => (/await requireSession\(/.test(line) ? [i] : []));
    expect(sessions.length, `${file} has no session read`).toBeGreaterThan(0);
    for (const i of sessions) {
      expect(lines[i]).toMatch(/const ctx = await requireSession\(/);
      expect(nextStatement(lines, i)).toBe("if (ctx instanceof Response) return ctx;");
      const after = lines.findIndex((line, j) => j > i && line.trim() === "if (ctx instanceof Response) return ctx;");
      expect(nextStatement(lines, after), `${file}:${after + 1}`).toBe(ROUTE_GATE);
    }
  });

  it("the export loader refuses the role too (any other caller of loadExportTable)", () => {
    const src = readFileSync(path.join(ROOT, "lib/report-export.ts"), "utf8");
    const floor = src.slice(src.indexOf("export function assertFamilyFloor("));
    expect(nextStatement(floor.split("\n"), 0)).toBe('if (!reportsRoleAllowed(auth.role)) throw new ExportError(403, "forbidden");');
  });
});

// ── The pages, rendered ─────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({ auth: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: mocks.auth }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/reports", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams(),
  redirect: (to: string) => { throw new Error(`redirect:${to}`); }, notFound: () => { throw new Error("not_found"); },
}));

const SHOP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const session = (role: RoleCode) => ({
  role, level: ROLES[role].level, locations: [SHOP], session: { id: "s1" },
  user: { id: `${role}-1`, name: "Viewer", role, language: "en" },
});

type PageCall = () => Promise<unknown>;
const props = (params: Record<string, string> = {}) => ({
  params: Promise.resolve(params), searchParams: Promise.resolve({ location: SHOP }),
});
const PAGES: Record<string, () => Promise<PageCall>> = {
  "/reports": async () => { const m = await import("@/app/(authed)/reports/page"); return () => m.default(props() as never); },
  "/reports/operations": async () => { const m = await import("@/app/(authed)/reports/operations/page"); return () => m.default(props() as never); },
  "/reports/[type]/[id]": async () => { const m = await import("@/app/(authed)/reports/[type]/[id]/page"); return () => m.default(props({ type: "cash", id: ID }) as never); },
  "/reports/written": async () => { const m = await import("@/app/(authed)/reports/written/page"); return () => m.default(props() as never); },
  "/reports/sales": async () => { const m = await import("@/app/(authed)/reports/sales/page"); return () => m.default(props() as never); },
  "/reports/sales/checks": async () => { const m = await import("@/app/(authed)/reports/sales/checks/page"); return () => m.default(props() as never); },
  "/reports/sales/checks/[checkGuid]": async () => { const m = await import("@/app/(authed)/reports/sales/checks/[checkGuid]/page"); return () => m.default(props({ checkGuid: "g1" }) as never); },
  "/reports/sales/catering": async () => { const m = await import("@/app/(authed)/reports/sales/catering/page"); return () => m.default(props() as never); },
  "/reports/trends": async () => { const m = await import("@/app/(authed)/reports/trends/page"); return () => m.default(props() as never); },
  "/reports/trends/ops": async () => { const m = await import("@/app/(authed)/reports/trends/ops/page"); return () => m.default(props() as never); },
  "/reports/trends/team": async () => { const m = await import("@/app/(authed)/reports/trends/team/page"); return () => m.default(props() as never); },
  "/reports/trends/team/[personId]": async () => { const m = await import("@/app/(authed)/reports/trends/team/[personId]/page"); return () => m.default(props({ personId: ID }) as never); },
  "/reports/business": async () => { const m = await import("@/app/(authed)/reports/business/page"); return () => m.default(props() as never); },
};

async function outcome(call: PageCall): Promise<string> {
  try { await call(); return "rendered"; } catch (error) { return error instanceof Error ? error.message : String(error); }
}

beforeEach(() => {
  vi.clearAllMocks();
  // No database here: the first read throws, so a page that gets past its gates stops there.
  mocks.service.mockImplementation(() => { throw new Error("database_read"); });
});

describe("every report page sends the social media manager to the Dashboard with the denial notice, before any read", () => {
  it("the rendered census covers every page in the tree", () => {
    const routes = REPORT_PAGES.map((file) => file.replace(/^app\/\(authed\)/, "").replace(/\/page\.tsx$/, "") || "/");
    expect(Object.keys(PAGES).sort()).toEqual(routes.sort());
  });

  it.each(Object.keys(PAGES))("%s", async (route) => {
    const call = await PAGES[route]!();
    mocks.auth.mockResolvedValue(session("social_media_mgr"));
    expect(await outcome(call)).toBe(`redirect:${REPORTS_DENIED_HREF}`);
    expect(mocks.service).not.toHaveBeenCalled();
  });

  it.each(Object.keys(PAGES))("%s: an AGM (also level 6) is never sent to the denial notice", async (route) => {
    const call = await PAGES[route]!();
    mocks.auth.mockResolvedValue(session("agm"));
    expect(await outcome(call)).not.toBe(`redirect:${REPORTS_DENIED_HREF}`);
  });
});
