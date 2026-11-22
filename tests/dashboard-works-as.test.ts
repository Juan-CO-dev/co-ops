/**
 * Nav PR 7 (plan r2 T4; spec 3.3.6, 10; PR 5 group 12): the Dashboard decides by the REAL role, never "works as".
 *
 * A CGS session that carries a smuggled works-as key holder role at shop A (and none at B), on a board that reports the
 * key holder's level, renders the plain CGS view at both shops: the GM's list, holder names, Assign, and the owner / CGS
 * shortcuts. And a token scan: no Dashboard module names "works-as".
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { TranslationProvider } from "@/lib/i18n/provider";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const state = vi.hoisted(() => ({ worksAs: {} as Record<string, string> }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "u-juan", name: "Juan C", language: "en" }, session: { id: "s" }, level: 10, role: "cgs", locations: [],
  // Smuggled: a scheduling "works as" role per shop. Nothing on the Dashboard may read it.
  worksAs: state.worksAs, worksAsRole: "key_holder",
}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: () => {
  const result = { data: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Shop A", code: "A" }, { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Shop B", code: "B" }], error: null };
  const query = { select: () => query, eq: () => query, in: () => query, order: () => query, maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
  return query;
} }) }));
vi.mock("@/lib/assignments", () => ({
  // The board reports the works-as level (4) for the viewer, as a scheduling surface could.
  loadShiftBoard: async (_sb: unknown, a: { locationId: string }) => ({
    stationDate: "2026-11-18", locationId: a.locationId, date: "2026-11-18", viewerId: "u-juan", viewerLevel: 4,
    people: [{ id: "u-juan", name: "Juan C", level: 4, hasWork: false }], stations: [], events: [],
    tasks: [{ id: "t1", task: "mid_day_prep", assigneeId: "u-luis", assigneeName: "Luis Diaz", assignerId: "u-gm", assignerName: null, note: null }],
  }),
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
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));

import DashboardPage from "@/app/(authed)/dashboard/page";

async function render(loc: string) {
  const page = await DashboardPage({ searchParams: Promise.resolve({ loc }) });
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: page }));
}
const view = (h: string) => ({
  rows: [...h.matchAll(/data-day-item="([^"]+)"/g)].map((m) => m[1]).sort(),
  shortcuts: [...h.matchAll(/data-shortcut="([^"]+)"/g)].map((m) => m[1]),
  assign: h.includes('data-action="assign"'),
  luis: h.includes("Luis has it."),
});

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-18T18:45:00.000Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("a CGS with a smuggled works-as role sees the plain CGS view at both shops", () => {
  it("shop A (works as key holder there) and shop B (none) render the same CGS view", async () => {
    state.worksAs = { [A]: "key_holder" };
    const a = view(await render(A));
    const b = view(await render(B));
    expect(a).toEqual(b);
    expect(a.rows).toEqual(["am_prep", "cash", "catering_today", "closing", "counts", "mid_day_prep", "opening", "ordering", "pm_report", "receiving"]);
    expect(a.luis).toBe(true);
    expect(a.assign).toBe(true);
    expect(a.shortcuts).toEqual(["sales", "mid-shift", "catering-insights", "admin"]);
  });
});

describe("token scan: no Dashboard module names works-as", () => {
  const FILES = [
    "app/(authed)/dashboard/page.tsx", "lib/dashboard-day-shared.ts", "lib/dashboard-day.ts", "lib/day-plan-render.ts", "lib/nav-switches.ts",
    "components/dashboard/PhaseLine.tsx", "components/dashboard/DayRow.tsx", "components/dashboard/NextUpCard.tsx",
    "components/dashboard/DayList.tsx", "components/dashboard/Shortcuts.tsx", "components/dashboard/SmmDashboard.tsx",
  ];
  function tokens(file: string): { identifiers: string[]; strings: string[] } {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, readFileSync(file, "utf8"));
    const identifiers: string[] = [];
    const strings: string[] = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      if (kind === ts.SyntaxKind.Identifier) identifiers.push(scanner.getTokenText());
      if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) strings.push(scanner.getTokenValue());
    }
    return { identifiers, strings };
  }
  it.each(FILES)("%s: no works-as string and no works_?as identifier (comments stripped)", (file) => {
    const { identifiers, strings } = tokens(file);
    expect(strings.filter((s) => s.includes("works-as"))).toEqual([]);
    expect(identifiers.filter((id) => /works_?as/i.test(id))).toEqual([]);
  });
});
