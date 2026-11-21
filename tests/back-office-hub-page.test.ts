/**
 * Nav PR 4 (plan r2, 7.3 and the page-level cases of 7.4): /admin rendered per role, with the session and the five
 * loaders mocked. The rows and jobs each role sees are written out literally (they read as the spec's table, plan
 * 2.3), in en and es, switches on and off. Then: the first two groups the viewer sees open, the rest closed; no loader
 * runs for a check the viewer may not see; a failed loader is Unavailable and never takes the page down.
 */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NO_CRON_RUN_FAILURES } from "@/lib/admin/ops-health-shared";
import type { RoleCode } from "@/lib/roles";
import { getRoleLevel } from "@/lib/roles";

const h = vi.hoisted(() => ({
  auth: vi.fn(), counts: vi.fn(), vendorMail: vi.fn(), inbound: vi.fn(), cron: vi.fn(), week: vi.fn(),
  alwaysOpen: { value: false },
}));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("notFound"); } }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: h.auth }));
vi.mock("@/lib/admin/readiness-load", () => ({ countNotReady: h.counts }));
vi.mock("@/lib/vendor-mail", () => ({ listVendorMail: h.vendorMail }));
vi.mock("@/lib/admin/ops-health", () => ({ loadInboundHealth: h.inbound, loadCronHealth: h.cron }));
vi.mock("@/lib/admin/week-card", () => ({ loadWeekCard: h.week }));
// The retry panel needs the admin layout's providers; it is tested on its own (tests/inbound-settings-ui.test.ts).
vi.mock("@/components/admin/InboundSettings", () => ({ InboundHealthPanel: () => null }));
// For the per-role lists: a CollapsibleSection that always renders its header and body (the real one is used for the
// open-state tests).
vi.mock("@/components/ui/CollapsibleSection", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/ui/CollapsibleSection")>();
  return {
    CollapsibleSection: (props: Parameters<typeof real.CollapsibleSection>[0]) => h.alwaysOpen.value
      ? createElement("section", null, props.title, props.count, props.badge, props.description, props.children as ReactNode)
      : real.CollapsibleSection(props),
  };
});
import Page from "@/app/admin/page";

const session = (role: RoleCode, language: "en" | "es" = "en") => ({ user: { role, language }, role, level: getRoleLevel(role), locations: ["loc-1"] });
const render = async (searchParams: Record<string, string> = {}) => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(searchParams) }));
const rows = (html: string) => [...html.matchAll(/data-backoffice-row="([^"]+)"(?: href="([^"]*)")?/g)].map((m) => m[2] ?? `(planned) ${m[1]}`);
const jobs = (html: string) => [...html.matchAll(/data-backoffice-job="[^"]+" href="([^"]+)"/g)].map((m) => m[1]);

beforeEach(() => {
  vi.clearAllMocks();
  h.alwaysOpen.value = false;
  vi.stubEnv("DEMAND_SIGNALS", "1");
  vi.stubEnv("MARKETING_SCORECARD", "1");
  h.counts.mockResolvedValue({ skus: 0, recipes: 0, items: 0, byScope: [] });
  h.vendorMail.mockResolvedValue({ reconciliation: { stale_count: 0 } });
  h.inbound.mockResolvedValue({ count: 0, rows: [] });
  h.cron.mockResolvedValue({ hasRecentFailure: false, lastFailureAt: null, lastFailureError: null, lastSuccessAt: null, lastRunDegraded: false, lastRunFailures: NO_CRON_RUN_FAILURES });
  h.week.mockResolvedValue({ shops: [], overallPeople: 0 });
});
afterEach(() => { vi.unstubAllEnvs(); });

const OPS6_ROWS = ["/admin/sevenshifts", "/admin/recipes", "/admin/items", "/admin/sandwiches", "/admin/vendors", "/admin/skus",
  "/admin/products", "/admin/pars", "/admin/weights", "/admin/catering"];
const GM_ROWS = ["/schedule", "/admin/users", "/admin/stations", "/admin/toast-employees", "/admin/sevenshifts", "/admin/people-reconcile",
  "/admin/pm-criteria", "/admin/recipes", "/admin/items", "/admin/sandwiches", "/admin/catalog/notices", "/admin/vendors", "/admin/skus",
  "/admin/products", "/admin/pars", "/admin/weights", "/operations/vendor-mail", "/admin/demand-signals", "/admin/catering",
  "/admin/checklist-templates", "/admin/report-recipients", "/admin/customers"];
const MOO_ROWS = ["/schedule", "/admin/users", "/admin/stations", "/admin/toast-employees", "/admin/sevenshifts", "/admin/people-reconcile",
  "/admin/pm-criteria", "/admin/recipes", "/admin/items", "/admin/sandwiches", "/admin/catalog/notices", "/admin/catalog/shop-changes",
  "/admin/vendors", "/admin/skus", "/admin/products", "/admin/pars", "/admin/weights", "/admin/categories", "/operations/vendor-mail",
  "/admin/locations", "/admin/demand-signals", "/admin/catering", "/admin/checklist-templates", "/admin/report-recipients",
  "/admin/customers", "/admin/marketing"];
const ALL_JOBS = ["/admin/users", "/admin/catalog/new/sandwich", "/admin/catalog/new/item", "/admin/pars", "/admin/checklist-templates"];

/** Plan 2.3, switches on: each role's rows (in page order) and jobs. */
const EXPECTED: Record<string, { rows: string[]; jobs: string[] }> = {
  agm: { rows: ["/schedule", ...OPS6_ROWS], jobs: ["/admin/pars"] },
  prep_mgr: { rows: OPS6_ROWS, jobs: ["/admin/pars"] },
  catering_mgr: { rows: OPS6_ROWS, jobs: ["/admin/pars"] },
  gm: { rows: GM_ROWS, jobs: ALL_JOBS },
  moo: { rows: MOO_ROWS, jobs: ALL_JOBS },
  owner: { rows: [...MOO_ROWS, "(planned) audit"], jobs: ALL_JOBS },
  cgs: { rows: [...MOO_ROWS, "(planned) audit"], jobs: ALL_JOBS },
  social_media_mgr: { rows: ["/admin/recipes", "/admin/items", "/admin/vendors", "/admin/skus", "/admin/products", "/admin/weights", "/admin/catering"], jobs: [] },
};

describe("rows and jobs per role (every group open)", () => {
  it.each(Object.entries(EXPECTED).flatMap(([role, e]) => (["en", "es"] as const).map((lang) => [role, lang, e] as const)))(
    "%s (%s), switches on", async (role, lang, e) => {
      h.alwaysOpen.value = true;
      h.auth.mockResolvedValue(session(role as RoleCode, lang));
      const html = await render();
      expect(rows(html)).toEqual(e.rows);
      expect(jobs(html)).toEqual(e.jobs);
    });

  it("switches off: MoO without Demand signals and without the Marketing scorecard rows; nothing else moves", async () => {
    h.alwaysOpen.value = true;
    h.auth.mockResolvedValue(session("moo"));
    vi.stubEnv("DEMAND_SIGNALS", "");
    let html = await render();
    expect(rows(html)).toEqual(MOO_ROWS.filter((r) => r !== "/admin/demand-signals"));
    vi.stubEnv("MARKETING_SCORECARD", "");
    html = await render();
    expect(rows(html)).toEqual(MOO_ROWS.filter((r) => r !== "/admin/demand-signals" && r !== "/admin/marketing"));
    expect(jobs(html)).toEqual(ALL_JOBS);
  });

  it("the audit row is muted, says Planned and links nowhere", async () => {
    h.alwaysOpen.value = true;
    h.auth.mockResolvedValue(session("owner"));
    const html = await render();
    expect(html).toMatch(/<div data-backoffice-row="audit" aria-disabled="true"[^>]*>.*?Audit Log.*?Planned/);
    expect(html).not.toContain('href="/admin/audit"');
  });
});

describe("open and closed (the real CollapsibleSection)", () => {
  it("the first two groups the viewer sees open; the others show header, line, count and no rows; both System panels are closed", async () => {
    h.auth.mockResolvedValue(session("gm"));
    const html = await render();
    expect(rows(html)).toEqual(["/schedule", "/admin/users", "/admin/stations", "/admin/toast-employees", "/admin/sevenshifts",
      "/admin/people-reconcile", "/admin/pm-criteria", "/admin/recipes", "/admin/items", "/admin/sandwiches", "/admin/catalog/notices"]);
    expect(html).toContain("Ordering and stock");
    expect(html).toContain("What we buy, from whom, and how much to keep.");
    expect(html).toContain("7 pages");
    expect(html).toMatch(/aria-controls="system-status-panel"[^>]*>/);
    expect(html).not.toContain('id="system-status-panel"');
    expect(html).not.toContain('id="admin-hub-week"');
    expect(html).not.toContain('id="backoffice-needs-attention"');
  });

  it("the social media manager: no People rows, so Menu and Ordering open", async () => {
    h.auth.mockResolvedValue(session("social_media_mgr"));
    const html = await render();
    expect(html).not.toContain("People and schedule");
    expect(rows(html)).toEqual(["/admin/recipes", "/admin/items", "/admin/vendors", "/admin/skus", "/admin/products", "/admin/weights"]);
  });

  it("Spanish", async () => {
    h.auth.mockResolvedValue(session("gm", "es"));
    const html = await render();
    expect(html).toContain("Oficina");
    expect(html).toContain("Configura cómo funcionan las tiendas.");
    expect(html).toContain("Equipo y horario");
    expect(html).toContain("Agregar una persona");
    expect(html).toContain("Cambiar un par");
    expect(html).toContain("Editar una lista");
  });
});

describe("loaders: only for checks the viewer may see", () => {
  it("an AGM: no vendor mail, no inbound read", async () => {
    h.auth.mockResolvedValue(session("agm"));
    await render();
    expect(h.vendorMail).not.toHaveBeenCalled();
    expect(h.inbound).not.toHaveBeenCalled();
    expect(h.counts).toHaveBeenCalledTimes(1);
  });

  it("a GM: vendor mail, no inbound read", async () => {
    h.auth.mockResolvedValue(session("gm"));
    await render();
    expect(h.vendorMail).toHaveBeenCalledTimes(1);
    expect(h.inbound).not.toHaveBeenCalled();
  });

  it("a MoO: every read", async () => {
    h.auth.mockResolvedValue(session("moo"));
    await render();
    for (const f of [h.counts, h.vendorMail, h.inbound, h.cron, h.week]) expect(f).toHaveBeenCalledTimes(1);
  });

  it("?denied=users still renders its notice", async () => {
    h.auth.mockResolvedValue(session("gm"));
    expect(await render({ denied: "users" })).toContain('role="status"');
  });
});

describe("failed reads are Unavailable, never zero, and never take the page down", () => {
  it("every loader rejecting at once: the page renders and every check is Unavailable", async () => {
    h.alwaysOpen.value = true;
    h.auth.mockResolvedValue(session("moo"));
    for (const f of [h.counts, h.vendorMail, h.inbound, h.cron, h.week]) f.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    spy.mockRestore();
    expect(html).toContain("Needs attention: 6. Sales pull could not be checked.");
    expect(html).not.toContain("All systems OK");
    expect(html).not.toContain("Healthy");
    expect(html).not.toMatch(/>0 not ready</);
    expect(html).toContain("This week in CO-OPS could not be checked.");
  });

  it("countNotReady rejecting: the SKU, recipe and item checks are Unavailable and their rows carry no count", async () => {
    h.alwaysOpen.value = true;
    h.auth.mockResolvedValue(session("gm"));
    h.counts.mockRejectedValue(new Error("down"));
    h.cron.mockResolvedValue({ hasRecentFailure: false, lastFailureAt: null, lastFailureError: null, lastSuccessAt: "2026-11-20T11:02:00.000Z", lastRunDegraded: false, lastRunFailures: NO_CRON_RUN_FAILURES });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render();
    spy.mockRestore();
    expect(html).toContain("Needs attention: 3. SKUs could not be checked.");
    expect(html).not.toMatch(/not ready/);
  });

  it("counts present: the row badge and the per-shop entries", async () => {
    h.alwaysOpen.value = true;
    h.auth.mockResolvedValue(session("gm"));
    h.counts.mockResolvedValue({ skus: 0, recipes: 2, items: 0, byScope: [{ scope: "loc-1", scopeName: "P Street", skus: 0, recipes: 2, items: 0 }] });
    const html = await render();
    expect(html).toContain("Needs attention: 1. Recipes: 2 not ready.");
    expect(html).toContain(">2 not ready<");
    expect(html).toContain('href="/admin/recipes?location=loc-1"');
    expect(html).toContain("1 issue");
  });
});
