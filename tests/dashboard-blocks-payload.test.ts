/**
 * Nav PR 8 (plan r2 7.3, T-R4, T-R1 page half; spec 3.7 groups 2, 12, 13, 11 page half). UNIT-LEVEL serialization checks
 * of the page tree, NOT real Next RSC output: the page's returned element tree, the props it hands to every element
 * (functions dropped), and the rendered markup. In a server-components page that is what can reach the flight payload.
 * (A Playwright check of the real RSC response can follow in PR 9's e2e suite; not blocking.)
 *
 * Fakes that cannot occur elsewhere: sales $9,876.54, labor 31.7%, "7 orders", $4,321.00 booked; "Needs you" 13 / 17 / 19;
 * unplaced inbox 23.
 *   - The social media manager and the GM: the strip's loaders are never called, and no strip value is in the tree or the
 *     markup. The SMM calls none of the blocks' loaders and sees none of the four (group 13).
 *   - Controls: the MoO's tree has the strip values; the GM's has 13 / 17 / 19 and no strip value.
 *   - Group 12: a CGS whose session smuggles a key-holder "works as" row gets the strip, at both shops.
 *   - Group 11 page half (Q5): the catering manager's night-before line is drawn once, in the block, not in the phase line;
 *     a key holder's phase line still draws it.
 *   - No "use client" in the five new component files.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactNode } from "react";
import { prerender } from "react-dom/static.edge";
import { TranslationProvider } from "@/lib/i18n/provider";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const st = vi.hoisted(() => ({
  role: "moo", level: 8, locations: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] as string[], worksAs: undefined as Record<string, string> | undefined,
  spies: {} as Record<string, ReturnType<typeof vi.fn>>,
}));
const { spy } = vi.hoisted(() => ({ spy: (name: string) => (...args: unknown[]) => (st.spies[name] as (...a: unknown[]) => unknown)(...args) }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "u-viewer", name: "Vi Ewer", language: "en", active: true, role: st.role }, session: { id: "s" }, level: st.level, role: st.role, locations: st.locations,
  ...(st.worksAs ? { worksAs: st.worksAs, worksAsRole: "key_holder" } : {}),
}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: () => {
  const rows = [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Shop A", code: "A" }, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Shop B", code: "B" }];
  let only: string[] | null = null;
  const query: Record<string, unknown> = { select: () => query, eq: () => query, order: () => query, in: (_k: string, v: string[]) => { only = v; return query; },
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows.filter((r) => !only || only.includes(r.id)), error: null }).then(resolve) };
  return query;
} }) }));
vi.mock("@/lib/assignments", () => ({
  loadShiftBoard: async (_sb: unknown, a: { locationId: string }) => ({ stationDate: "2026-11-18", locationId: a.locationId, date: "2026-11-18", viewerId: "u-viewer",
    viewerLevel: 8, people: [], stations: [], events: [], tasks: [] }),
  loadOwnTaskAssignments: async () => [],
  loadStationDayFlags: async () => ({ installed: false }),
}));
vi.mock("@/lib/day-plan", async (orig) => {
  const m = await orig<typeof import("@/lib/day-plan")>();
  const { okDeps } = await import("./fixtures/day-plan/loader-deps");
  return { ...m, loadDayFacts: (sb: Parameters<typeof m.loadDayFacts>[0], a: Parameters<typeof m.loadDayFacts>[1]) => m.loadDayFacts(sb, a, okDeps()) };
});
vi.mock("@/lib/checklists", () => ({ evaluateAutoReleaseForUserLocations: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ loadUnreadForUser: async () => [], notificationLocationContext: () => undefined }));
vi.mock("@/lib/yield-stats", () => ({ loadMyRetrainTasks: async () => [] }));
vi.mock("@/lib/receiving", () => ({ loadRecentDeliveries: async () => [] }));
vi.mock("@/lib/counts", () => ({ loadCountsTileState: async () => null }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => null }));
vi.mock("@/components/auth/LogoutButton", () => ({ LogoutButton: () => null }));
vi.mock("@/components/assignments/ShiftBoardClient", () => ({ ShiftBoardClient: () => null }));
// The role blocks' leaf readers.
vi.mock("@/lib/pulse/sales", async (orig) => ({ ...(await orig<typeof import("@/lib/pulse/sales")>()), loadPulseSalesToday: spy("sales") }));
vi.mock("@/lib/business-report", async (orig) => ({ ...(await orig<typeof import("@/lib/business-report")>()), loadBusinessLaborDays: spy("labor") }));
vi.mock("@/lib/catering/booked-events", async (orig) => ({ ...(await orig<typeof import("@/lib/catering/booked-events")>()), loadBookedCateringEvents: spy("booked") }));
vi.mock("@/lib/scheduling/inputs", async (orig) => ({ ...(await orig<typeof import("@/lib/scheduling/inputs")>()), loadEzcater: spy("ezcater") }));
vi.mock("@/lib/vendor-mail", () => ({ staleVendorMailCount: spy("mail") }));
vi.mock("@/lib/catalog/shop-changes", () => ({ loadShopNotices: spy("notices") }));
vi.mock("@/lib/catering/inbox", () => ({ countCateringInboxWaiting: spy("inbox") }));
vi.mock("@/lib/catering/not-in-toast", () => ({ readNotInToastScoped: spy("notRung") }));

import DashboardPage from "@/app/(authed)/dashboard/page";
import { summarizeSales } from "@/lib/sales-reports-shared";
import { LABOR_BUILDER_VERSION } from "@/lib/facts/labor-config-shared";
import { fakeClient } from "./helpers/business-report-fake";

const ON = { BUSINESS_REPORT: "1", FACT_LAYER: "1", FACT_LAYER_LABOR: "1" };
const STRIP_LOADERS = ["sales", "labor", "booked", "ezcater"];
const ALL_LOADERS = [...STRIP_LOADERS, "mail", "notices", "inbox", "notRung"];
const STRIP_TREE = ["987654", "432100"];
const STRIP_MARKUP = ["$9,876.54", "31.7%", "$4,321.00", "7 orders"];

async function installSpies() {
  const actual = await vi.importActual<typeof import("@/lib/business-report")>("@/lib/business-report");
  const W = (week_start: string) => ({ week_start, ot_scope: "per_shop", builder_version: LABOR_BUILDER_VERSION });
  st.spies = {
    sales: vi.fn(async () => ({ totals: { ...summarizeSales([], "2026-11-18", "2026-11-18", "day").totals, toastChecksCents: 987_654, checks: 5, coverage: "complete", coveredDays: 1 },
      capturedAt: "2026-11-18T18:30:00Z" })),
    // The real narrow loader over the shared fake: pure hourly 1,585 / 5,000 net = 31.7%.
    labor: vi.fn((viewer: Parameters<typeof actual.loadBusinessLaborDays>[0], args: Parameters<typeof actual.loadBusinessLaborDays>[1]) =>
      actual.loadBusinessLaborDays(viewer, args, { client: fakeClient({ weeks: [W("2026-11-08"), W("2026-11-15")],
        laborCostRow: () => ({ hourly_straight_cents: 1_585, salaried_cents: 0, salary_basis: "wages" }) }).client, env: ON })),
    booked: vi.fn(async () => Array.from({ length: 7 }, (_, i) => ({ id: `l${i}`, contactName: "Secret Person", company: null, eventDate: "2026-11-18", timeWindow: null,
      headcount: 10, stage: "confirmed", deliveryAddress: "1 Hidden St", estimatedRevenueCents: null,
      acceptedQuote: { totalCents: i === 0 ? 61_900 : 61_700, isDelivery: false, version: 1 }, valueCents: 0 }))),
    ezcater: vi.fn(async () => []),
    mail: vi.fn(async () => 13),
    notices: vi.fn(async () => Array.from({ length: 17 }, (_, i) => ({ id: `n${i}` }))),
    // As the real reader answers: a company-wide reader gets the unplaced count, a GM null (T-I1).
    inbox: vi.fn(async (ctx: { role: string }) => ({ shop: 19, unplaced: ctx.role === "gm" ? null : 23 })),
    notRung: vi.fn(async () => ({ rows: [], house: "off" })),
  };
}
async function pageTree(loc = A) {
  return DashboardPage({ searchParams: Promise.resolve({ loc }) });
}
/** The page's markup with every Suspense boundary streamed to completion (lead rulings r3: the labor cell streams), so
 *  the streamed child is checked too. React's boundary and text-separator comments are dropped. */
async function render(tree: unknown): Promise<string> {
  // eslint-disable-next-line react/no-children-prop
  // prerender waits for every boundary: a boundary that resolved late is written as its fallback plus the resolved
  // content React swaps in, so both are in the markup and the resolved content is checked.
  const { prelude } = await prerender(createElement(TranslationProvider, { initialLanguage: "en", children: tree as ReactNode }));
  return (await new Response(prelude).text()).replace(/<!--\/?\$-->|<!-- -->/g, "").replace(/&#x27;/g, "'");
}
const LABOR_CHILD = /data-strip-cell="labor(-loading)?"/;
/** The element tree with every element's props, functions dropped (what a server tree hands on). */
function treeJson(tree: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (typeof v === "function" || typeof v === "symbol") return undefined;
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return undefined;
    seen.add(v);
    if (isValidElement(v)) return { type: typeof v.type === "string" ? v.type : (v.type as { name?: string })?.name ?? "?", props: walk(v.props) };
    if (v instanceof Set) return [...v].map(walk);
    if (v instanceof Map) return [...v.entries()].map(walk);
    if (Array.isArray(v)) return v.map(walk);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  return JSON.stringify(walk(tree));
}
const as = (role: string, level: number, locations: string[]) => { st.role = role; st.level = level; st.locations = locations; };

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T18:45:00.000Z"));
  for (const [k, v] of Object.entries(ON)) vi.stubEnv(k, v);
  st.worksAs = undefined;
  await installSpies();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("T-R4 / 7.3: never for a GM or the social media manager", () => {
  it("the social media manager: no block loader is called, and nothing of the four is in the tree or the markup (group 13)", async () => {
    as("social_media_mgr", 6, [A]);
    const tree = await pageTree();
    for (const n of ALL_LOADERS) expect(st.spies[n], n).not.toHaveBeenCalled();
    const json = treeJson(tree);
    const html = await render(tree);
    for (const v of STRIP_TREE) expect(json).not.toContain(v);
    for (const v of STRIP_MARKUP) expect(html).not.toContain(v);
    for (const marker of ["data-numbers-strip", "data-needs-you-line", "data-catering-block", "data-pulse-toggle"]) expect(html).not.toContain(marker);
    expect(html).not.toMatch(LABOR_CHILD); // lead rulings r3: no streamed labor child either
    expect(json).not.toContain("NumbersStrip");
  });

  it("the GM: no strip loader is called and no strip value is in the tree or the markup; Needs you 13 / 17 / 19 is", async () => {
    as("gm", 7, [A]);
    const tree = await pageTree();
    for (const n of STRIP_LOADERS) expect(st.spies[n], n).not.toHaveBeenCalled();
    for (const n of ["mail", "notices", "inbox"]) expect(st.spies[n], n).toHaveBeenCalledTimes(1);
    const json = treeJson(tree);
    const html = await render(tree);
    for (const v of STRIP_TREE) expect(json).not.toContain(v);
    for (const v of STRIP_MARKUP) expect(html).not.toContain(v);
    expect(html).not.toContain("data-numbers-strip");
    expect(html).not.toMatch(LABOR_CHILD); // lead rulings r3: no streamed labor child either
    expect(json).not.toContain("NumbersStrip");
    expect(html).toContain("13 vendor emails are waiting.");
    expect(html).toContain("17 recipe updates are waiting.");
    expect(html).toContain("19 catering emails are waiting for a reply.");
    expect(html).not.toContain("23 more not tied to a shop.");
    expect(html).toContain("data-pulse-toggle");
  });

  it("control: the MoO's tree and markup have the strip values, for its member shop only", async () => {
    as("moo", 8, [A]);
    const tree = await pageTree();
    const json = treeJson(tree);
    const html = await render(tree);
    for (const v of STRIP_TREE) expect(json).toContain(v);
    for (const v of STRIP_MARKUP) expect(html).toContain(v);
    expect([...html.matchAll(/data-strip-shop="([^"]+)"/g)].map((m) => m[1])).toEqual(["A"]);
    expect(html).toContain('data-strip-cell="labor"'); // the streamed child, resolved
    expect(html).toContain("Needs you: ");
    expect(html).toContain("23 more not tied to a shop.");
    // No name, address or contact from the booked events reaches the page.
    expect(json).not.toContain("Secret Person");
    expect(json).not.toContain("Hidden St");
  });

  it("no \"use client\" in the six new component files", () => {
    for (const f of ["NumbersStrip", "StripLaborCell", "StripLaborStream", "CateringBlock", "NeedsYou", "MyShiftPulseToggle"]) {
      expect(readFileSync(`components/dashboard/${f}.tsx`, "utf8"), f).not.toMatch(/^\s*["']use client["']/m);
    }
  });
});

describe("T-R1 page half / group 12: the real role, never works-as", () => {
  it("a CGS with a smuggled key-holder works-as row gets the strip at both shops, at either selected shop", async () => {
    as("cgs", 10, []);
    st.worksAs = { [A]: "key_holder" };
    for (const loc of [A, B]) {
      const html = await render(await pageTree(loc));
      expect([...html.matchAll(/data-strip-shop="([^"]+)"/g)].map((m) => m[1])).toEqual(["A", "B"]);
      expect(html).toContain("data-needs-you-line");
    }
  });
  it("level never decides: the owner gets the strip; the catering manager (level 6) and the AGM do not", async () => {
    as("owner", 9, []);
    expect(await render(await pageTree())).toContain("data-numbers-strip");
    for (const [role, level] of [["catering_mgr", 6], ["agm", 6], ["key_holder", 4]] as const) {
      as(role, level, [A]);
      await installSpies();
      const html = await render(await pageTree());
      expect(html, role).not.toContain("data-numbers-strip");
      expect(html, role).not.toContain("data-needs-you-line");
      for (const n of STRIP_LOADERS) expect(st.spies[n], `${role} ${n}`).not.toHaveBeenCalled();
    }
  });
});

describe("group 2 / Q9 / Q5 at the page: the catering manager", () => {
  it("the block is drawn, its item is not also a row, and the night-before line is drawn once (in the block)", async () => {
    as("catering_mgr", 6, [A]);
    const html = await render(await pageTree());
    expect(html).toContain("data-catering-block");
    expect(html).not.toContain('data-day-item="catering_today"');
    const nightBefore = /Tomorrow is a heavy catering day/;
    const phase = html.match(/<section[^>]*data-phase=[\s\S]*?<\/section>/)?.[0] ?? "";
    const block = html.match(/<section[^>]*data-catering-block[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(block).toMatch(nightBefore);
    expect(phase).not.toMatch(nightBefore);
    expect(st.spies.inbox).toHaveBeenCalledTimes(1);
    expect(st.spies.notRung).toHaveBeenCalledTimes(1);
  });
  it("a key holder's phase line still draws the night-before line; no block", async () => {
    as("key_holder", 4, [A]);
    const html = await render(await pageTree());
    expect(html).not.toContain("data-catering-block");
    expect(html.match(/<section[^>]*data-phase=[\s\S]*?<\/section>/)?.[0] ?? "").toMatch(/Tomorrow is a heavy catering day/);
  });
});

// Catering delivery D3: the OFF-EQUIVALENCE pin at the page. With delivery tracking off (`DELIVERY_TRACKING` unset), the
// Dashboard's element tree (every prop, functions dropped) and its markup are byte-identical to what they were before D3,
// for every role that gets a catering row, the block or "Needs you". The golden
// (tests/fixtures/delivery/d3-off-page-golden.json) was frozen from the UNCHANGED base (PR #633's head) in its own commit
// before any D3 code; it is regenerated only with a written reason (`WRITE_D3_OFF_GOLDEN=1`).
describe("D3 off-equivalence: the Dashboard page with delivery tracking off", () => {
  it("tree and markup match the golden frozen from the unchanged base", async () => {
    const { createHash } = await import("node:crypto");
    const { existsSync, writeFileSync } = await import("node:fs");
    const GOLDEN = "tests/fixtures/delivery/d3-off-page-golden.json";
    const sha = (s: string) => createHash("sha256").update(s).digest("hex");
    vi.stubEnv("DELIVERY_TRACKING", "");
    const now: Record<string, string> = {};
    for (const [role, level, locations] of [["key_holder", 4, [A]], ["shift_lead", 5, [A]], ["agm", 6, [A]], ["catering_mgr", 6, [A]], ["gm", 7, [A]], ["moo", 8, [A]],
      ["owner", 9, []], ["cgs", 10, []], ["social_media_mgr", 6, [A]], ["employee", 3, [A]]] as const) {
      as(role, level, [...locations]);
      await installSpies();
      const tree = await pageTree();
      now[`${role}/tree`] = sha(treeJson(tree));
      now[`${role}/markup`] = sha(await render(tree));
    }
    if (process.env.WRITE_D3_OFF_GOLDEN === "1" || !existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
      if (process.env.WRITE_D3_OFF_GOLDEN !== "1") throw new Error("golden was missing: written; re-run");
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Record<string, string>;
    expect(Object.keys(now).sort()).toEqual(Object.keys(golden).sort());
    expect(Object.keys(golden).filter((k) => golden[k] !== now[k])).toEqual([]);
  });
});
