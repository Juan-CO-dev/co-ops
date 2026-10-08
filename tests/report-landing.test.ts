import { reportLandingContext } from "@/lib/report-navigation";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { canReadReportLocation, lockLocationContext } from "@/lib/locations";
import { parseReportRange, reportRangeParams, shiftReportDate } from "@/lib/report-range";
import { composeLastClose, composeReportSummary, reportIsFinalized } from "@/lib/report-summary";
import type { RoleCode } from "@/lib/roles";

type Node = { type: unknown; props: Record<string, unknown>; children: unknown[] };
function flatten(value: unknown): Node[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(flatten);
  const node = value as Node;
  return [node, ...flatten(node.children)];
}
async function render(level: number, role: RoleCode, location = "mine", assigned = false, extra: Record<string, string> = {}, lastClose = false) {
  const source = readFileSync("app/(authed)/reports/page.tsx", "utf8");
  const ast = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ReportsPage")!;
  const js = ts.transpile(declaration.getText(ast).replace("export default ", ""), { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React });
  const query = { select: () => query, eq: () => query, order: () => query, in: () => query, then: (resolve: (data: unknown) => unknown) => resolve({ data: [{ id: location, name: location }], error: null }) };
  const canDoOperationalTask = vi.fn(async () => assigned);
  const listReports = vi.fn(async () => []);
  const deps = {
    React: { createElement: (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Node => ({ type, props: props ?? {}, children }) },
    Link: "link", ReportPageNav: "back", ReportShopTabs: "tabs", ReportRangeControls: "range", ExportLinks: "export",
    requireSessionFromHeaders: async () => ({ role, level, locations: ["mine"], user: { id: "viewer", language: "en" } }),
    redirect: () => { throw new Error("redirect"); }, canReadReportLocation, lockLocationContext, REPORT_ALL_LOCATIONS_LEVEL: 8,
    getServiceRoleClient: () => ({ from: () => query }), serverT: (_language: string, key: string) => key,
    operationalNow: () => ({ date: "2026-10-07" }), formatDateLabel: (date: string) => date,
    reportLandingContext, parseReportRange, reportRangeParams, shiftReportDate, composeLastClose, composeReportSummary, reportIsFinalized,
    canDoOperationalTask, listReports, SALES_READ_MIN: 7, listReportSkeleton: async () => lastClose ? [{ id: "close-id", type: "closing", status: "submitted" }] : [],
  };
  const page = new Function(...Object.keys(deps), `${js}; return ReportsPage;`)(...Object.values(deps));
  const tree = await page({ searchParams: Promise.resolve({ location, ...extra }) });
  const nodes = flatten(tree);
  const hrefs = nodes.filter(node => node.type === "link").map(node => String(node.props.href));
  return { hrefs, text: JSON.stringify(tree), canDoOperationalTask, listReports };
}
describe("actual reports landing card gates", () => {
  it("last-close details preserve hub provenance without inherited list filters/cursors", async () => {
    const result = await render(8, "moo", "all", false, { cursor: "saved", type: "closing", sf_underPar: "true" }, true);
    const link = result.hrefs.find(href => href.startsWith("/reports/closing/close-id?"));
    expect(link).toBeTruthy();
    const query = new URL(link!, "https://local").searchParams;
    expect(query.get("hubLocation")).toBe("all");
    expect(query.get("returnLocation")).toBeNull();
    expect(query.get("cursor")).toBeNull();
    expect(query.get("type")).toBeNull();
    expect(query.get("sf_underPar")).toBeNull();
  });
  it("trainees receive own reports and feedback without aggregate or cash links", async () => {
    const result = await render(2, "trainee");
    expect(result.hrefs.some(href => href.startsWith("/reports/operations?"))).toBe(true);
    expect(result.hrefs.some(href => href.startsWith("/reports/written?"))).toBe(true);
    expect(result.hrefs.some(href => href.startsWith("/my-feedback?"))).toBe(true);
    expect(result.hrefs.some(href => href.includes("/trends") || href.includes("cash") || href.includes("/counts"))).toBe(false);
    expect(result.text).not.toContain("reports.hub.sales");
    expect(result.text).toContain("reports.hub.your_submissions");
    expect(result.canDoOperationalTask).not.toHaveBeenCalled();
  });
  it("unassigned KH sees ops trends but no task destinations", async () => {
    const result = await render(4, "key_holder");
    expect(result.hrefs.some(href => href.startsWith("/reports/trends/ops?"))).toBe(true);
    expect(result.hrefs.some(href => href.startsWith("/ordering?") || href.startsWith("/operations/receiving?"))).toBe(false);
    expect(result.canDoOperationalTask).toHaveBeenCalledTimes(2);
  });
  it("assigned KH gets receiving and ordering", async () => {
    const result = await render(4, "key_holder", "mine", true);
    expect(result.hrefs.some(href => href.startsWith("/ordering?"))).toBe(true);
    expect(result.hrefs.some(href => href.startsWith("/operations/receiving?"))).toBe(true);
  });
  it("AGM gets readonly counts and team, but no Sales (Juan 2026-10-08: GM+)", async () => {
    const result = await render(6, "agm");
    expect(result.hrefs.some(href => href.startsWith("/operations/counts?"))).toBe(true);
    expect(result.hrefs.some(href => href.startsWith("/reports/trends/team?"))).toBe(true);
    expect(result.hrefs.some(href => href.startsWith("/reports/sales"))).toBe(false);
    expect(result.text).not.toContain("reports.hub.coming_next");
  });
  it("a GM gets the Sales root, checks and catering links for their shop", async () => {
    const result = await render(7, "gm");
    for (const path of ["/reports/sales?", "/reports/sales/checks?", "/reports/sales/catering?"]) {
      const link = result.hrefs.find(href => href.startsWith(path));
      expect(link, path).toBeTruthy();
      expect(new URL(link!, "https://local").searchParams.get("location")).toBe("mine");
    }
  });
  it("MoO report grant never grants operational or catering access to an unassigned shop", async () => {
    const result = await render(8, "moo", "other", true);
    expect(result.hrefs.some(href => href.startsWith("/operations/") || href.startsWith("/ordering") || href.startsWith("/catering"))).toBe(false);
    expect(result.canDoOperationalTask).not.toHaveBeenCalled();
  });
  it("rejects forged other-shop scope below eight", async () => {
    await expect(render(7, "gm", "other")).rejects.toThrow("redirect");
  });
});
