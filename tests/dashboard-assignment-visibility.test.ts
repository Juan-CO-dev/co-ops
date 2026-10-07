import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TASK_TYPES, type TaskAssignment } from "@/lib/assignments-shared";
import { ROLES } from "@/lib/roles";
import { TranslationProvider } from "@/lib/i18n/provider";
import en from "@/lib/i18n/en.json";

const state = vi.hoisted(() => ({ level: 4, role: "key_holder", tasks: [] as TaskAssignment[] }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({ user: { id: "viewer", name: "Viewer", language: "en" }, level: state.level, role: state.role, locations: ["shop-a"] }) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (table: string) => {
  const result = { data: table === "locations" ? [{ id: "shop-a", name: "Shop A", code: "A" }] : [], error: null };
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
} }) }));
vi.mock("@/lib/assignments", () => ({ loadShiftBoard: async () => ({
  locationId: "shop-a", date: "2026-10-07", viewerId: "viewer", viewerLevel: state.level,
  people: [{ id: "viewer", name: "Viewer", level: state.level, hasWork: true }], stations: [], events: [], tasks: state.tasks,
}) }));
vi.mock("@/lib/checklists", () => ({ canEditReport: () => ({ canEdit: false }), evaluateAutoReleaseForUserLocations: vi.fn() }));
vi.mock("@/lib/admin/template-builder-shared", () => ({ applyEffectiveResolution: (query: unknown) => query }));
vi.mock("@/lib/notifications", () => ({ loadUnreadForUser: async () => [] }));
vi.mock("@/lib/prep", () => ({
  loadAmPrepDashboardState: async () => ({ isVisibleToActor: true, hasTemplate: false }),
  loadMidDayPrepDashboardState: async () => ({ isVisibleToActor: true }),
}));
vi.mock("@/lib/cash", () => ({ loadCashDashboardState: async () => ({ isVisibleToActor: true, report: null }) }));
vi.mock("@/lib/pm-report", () => ({ loadPmDashboardState: async () => ({ isVisibleToActor: true }) }));
vi.mock("@/lib/receiving", () => ({ loadRecentDeliveries: async () => [] }));
vi.mock("@/lib/purchase-orders", () => ({ loadTodaysOrders: async () => [] }));
vi.mock("@/lib/ordering", () => ({ loadOrderingAttention: async () => ({ vendors: [] }) }));
vi.mock("@/lib/counts", () => ({ loadCountsTileState: async () => null }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => null }));
vi.mock("@/components/auth/LogoutButton", () => ({ LogoutButton: () => null }));
vi.mock("@/components/dashboard/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/DashboardNav", () => ({ DashboardNav: () => null }));
vi.mock("@/components/OpeningTile", () => ({ OpeningTile: () => createElement("i", { "data-task-tile": "opening_report" }) }));
vi.mock("@/components/MidDayPrepTile", () => ({ MidDayPrepTile: () => createElement("i", { "data-task-tile": "mid_day_prep" }) }));
vi.mock("@/components/CashDepositTile", () => ({ CashDepositTile: () => createElement("i", { "data-task-tile": "cash_report" }) }));
vi.mock("@/components/PmReportTile", () => ({ PmReportTile: () => createElement("i", { "data-task-tile": "pm_report" }) }));
vi.mock("@/components/receiving/ReceivingTile", () => ({ ReceivingTile: () => createElement("i", { "data-task-tile": "receiving" }) }));
vi.mock("@/components/ordering/OrderingTile", () => ({ OrderingTile: () => createElement("i", { "data-task-tile": "ordering" }) }));
vi.mock("@/components/counts/CountsTile", () => ({ CountsTile: () => createElement("i", { "data-task-tile": "counts" }) }));

import DashboardPage from "@/app/(authed)/dashboard/page";
async function dashboard(level: number, assigned: boolean, assigneeId = "viewer") {
  state.level = level;
  state.role = Object.values(ROLES).find((role) => role.level === level)!.code;
  state.tasks = assigned ? TASK_TYPES.map((task) => ({ id: task, task, assigneeId, assignerId: "lead", assignerName: "Lead", note: null })) : [];
  const page = await DashboardPage({ searchParams: Promise.resolve({ loc: "shop-a" }) });
  // Required children prop preserves the provider's strict React.createElement type.
  // eslint-disable-next-line react/no-children-prop
  const html = renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: "en", children: page }));
  return {
    myShift: html.includes("My shift"), closing: html.includes(en["dashboard.today.closing_label"]),
    amPrep: html.includes(en["dashboard.am_prep.no_template"]),
    tiles: [...html.matchAll(/data-task-tile="([^"]+)"/g)].map((match) => match[1]),
    safetyLine: html.includes("Unassigned:"),
  };
}
beforeEach(() => vi.clearAllMocks());
describe("dashboard rendered visibility by role", () => {
  it.each([2, 3, 4, 5, 6, 7, 9])("snapshots assigned and unassigned dashboards at level %s", async (level) => {
    expect({ unassigned: await dashboard(level, false), assigned: await dashboard(level, true) }).toMatchSnapshot();
  });
  it("does not show task tiles or the unassigned line for work assigned to someone else", async () => {
    expect(await dashboard(9, true, "other")).toEqual({ myShift: true, closing: true, amPrep: false, tiles: [], safetyLine: false });
  });
});
