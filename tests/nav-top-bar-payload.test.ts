/* eslint-disable react/no-children-prop -- the fallback wraps a client element with createElement */
/**
 * Nav PR 9, G13 (plan r2 8.4; spec 8.1, 3.7 group 13; lead rulings r1 Q7 and the testing gate). Folds in
 * tests/dashboard-smm-no-bell.test.ts (D3), whose bell half moved into the top bar.
 *
 * UNIT-LEVEL SERIALIZATION of four whole signed-in trees (layout + page, or the standalone page with its NavFrame), as
 * the PR 7 / PR 8 payload tests do. It is NOT browser or RSC evidence. The serializer (tests/helpers/render-server-tree.ts)
 * awaits every async server component and renders every <Suspense> boundary's CONTENT, so a streamed TopBarBell would be
 * rendered if it were in the tree; client islands are prop-printing stand-ins, so the test sees what crosses to the client.
 *
 * Fixture: a person whose role is now the social media manager, with unread notices stored under an earlier role (an
 * under-par alert, an opening-without-data alert, a pack change request, an assignment override and two vault notices),
 * each carrying distinctive strings. For the SMM, in all four trees: no notification read or mark is called, the recording
 * client sees no notification_recipients / notifications read and no shop-code read, no BellIsland exists, NavShell's
 * `bell` is null, none of the strings appears, and the Go to model is exactly its four entries with no people search.
 * Control (an AGM, the other direction): the unread read and the code read run once per tree and the island gets them.
 * The people reader is never called by any render.
 *
 * Trees: the Dashboard under app/(authed)/layout.tsx; an admin page under app/admin/layout.tsx (the page body is a stand-in:
 * the layout's payload is what is tested; no page body can read notifications, census B6); /ordering (its real page, the
 * no-shop branch); /training (its real page).
 */
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordingSupabase, type Row } from "./recording-supabase";
import { renderServerTree, standIn, type ServerTree } from "./helpers/render-server-tree";
import { ROLES, type RoleCode } from "@/lib/roles";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const state = vi.hoisted(() => ({
  role: "social_media_mgr" as string, level: 6, language: "en" as "en" | "es", boardLevel: 6,
  db: null as unknown as import("./recording-supabase").RecordingDb,
}));
const SHOP = "shop-a";

vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (u: string) => { throw new Error(`redirect:${u}`); }, notFound: () => { throw new Error("404"); },
  useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
}));
const auth = () => ({
  user: { id: "viewer", name: "Viewer", email: "v@example.test", role: state.role, language: state.language, profileBlurb: null },
  session: { id: "session-1", stepUpUnlocked: false, stepUpUnlockedAt: null, catalogEditUnlockedAt: null },
  role: state.role, level: state.level, locations: [SHOP],
});
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => auth(), sessionIdleMinutes: () => 10 }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => state.db.client }));
// The REAL readers, spied (so the bar's real unit runs over the recording client for the control).
vi.mock("@/lib/notifications", async (orig) => {
  const m = await orig<typeof import("@/lib/notifications")>();
  return { ...m, loadUnreadForUser: vi.fn(m.loadUnreadForUser), loadNoticeLocationCodes: vi.fn(m.loadNoticeLocationCodes),
    markAllNotificationsRead: vi.fn(m.markAllNotificationsRead), markNotificationRead: vi.fn(m.markNotificationRead) };
});
vi.mock("@/lib/nav/people-search", async (orig) => {
  const m = await orig<typeof import("@/lib/nav/people-search")>();
  return { ...m, searchPeopleFor: vi.fn(m.searchPeopleFor), loadPeopleDirectory: vi.fn(m.loadPeopleDirectory) };
});
// The Dashboard's day engine on PR 6's fake reads (as the PR 7 / PR 8 payload tests).
vi.mock("@/lib/assignments", () => ({
  loadShiftBoard: async () => ({ locationId: SHOP, date: "2026-10-07", viewerId: "viewer", viewerLevel: state.boardLevel,
    people: [{ id: "viewer", name: "Viewer", level: state.boardLevel, hasWork: false }], stations: [], events: [], tasks: [] }),
  loadOwnTaskAssignments: async () => [],
  loadStationDayFlags: async () => ({ installed: false }),
}));
vi.mock("@/lib/checklists", () => ({ evaluateAutoReleaseForUserLocations: vi.fn() }));
vi.mock("@/lib/day-plan", async (orig) => {
  const m = await orig<typeof import("@/lib/day-plan")>();
  const { okDeps } = await import("./fixtures/day-plan/loader-deps");
  return { ...m, loadDayFacts: (sb: Parameters<typeof m.loadDayFacts>[0], a: Parameters<typeof m.loadDayFacts>[1]) => m.loadDayFacts(sb, a, okDeps()) };
});
vi.mock("@/lib/receiving", () => ({ loadRecentDeliveries: async () => [] }));
vi.mock("@/lib/counts", () => ({ loadCountsTileState: async () => null }));
vi.mock("@/lib/yield-stats", () => ({ loadMyRetrainTasks: async () => [] }));
// Client islands → prop-printing stand-ins (what crosses to the client).
vi.mock("@/components/nav/NavShell", async () => ({
  NavShell: (await import("./helpers/render-server-tree")).standIn("NavShell"),
  useGoTo: () => ({ open: () => {}, close: () => {}, isOpen: false, panel: null, openBell: () => {}, returnTo: null, available: false }),
}));
vi.mock("@/components/nav/BellIsland", async () => ({ BellIsland: (await import("./helpers/render-server-tree")).standIn("BellIsland") }));
vi.mock("@/components/auth/IdleTimeoutWarning", async () => ({ IdleTimeoutWarning: (await import("./helpers/render-server-tree")).standIn("IdleTimeoutWarning") }));
vi.mock("@/lib/i18n/provider", async (orig) => {
  const m = await orig<typeof import("@/lib/i18n/provider")>();
  const { standIn: s } = await import("./helpers/render-server-tree");
  return { ...m, TranslationProvider: s("TranslationProvider"), RealTranslationProvider: m.TranslationProvider };
});
vi.mock("@/components/ShopContextSync", async () => ({ ShopContextSync: (await import("./helpers/render-server-tree")).standIn("ShopContextSync") }));
vi.mock("@/components/admin/StepUpProvider", async () => ({ StepUpProvider: (await import("./helpers/render-server-tree")).standIn("StepUpProvider") }));
vi.mock("@/components/assignments/ShiftBoardClient", async () => ({ ShiftBoardClient: (await import("./helpers/render-server-tree")).standIn("ShiftBoardClient") }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => children }));

import AuthedLayout from "@/app/(authed)/layout";
import AdminLayout from "@/app/admin/layout";
import DashboardPage from "@/app/(authed)/dashboard/page";
import OrderingPage from "@/app/ordering/page";
import TrainingPage from "@/app/training/page";
import * as notifications from "@/lib/notifications";
import * as people from "@/lib/nav/people-search";
import * as provider from "@/lib/i18n/provider";
import { BELL_REFUSED_ROLES, notificationBellRoleAllowed } from "@/lib/notification-bell-shared";
import { effectiveScheduleRole } from "@/lib/scheduling/works-as-shared";

const RealProvider = (provider as unknown as { RealTranslationProvider: (p: { initialLanguage: string; children: ReactNode }) => ReactElement }).RealTranslationProvider;
/** A client component met inside a page body: rendered for real (SSR) inside the viewer's language. */
const fallback = (el: ReactElement) => renderToStaticMarkup(createElement(RealProvider, { initialLanguage: state.language, children: el }));

let n = 0;
function stored(type: string, data: Record<string, unknown>): Row {
  n++;
  return {
    id: `r${n}`, notification_id: `n${n}`, user_id: "viewer", delivery_method: "in_app", delivery_status: "sent", read_at: null, acknowledged_at: null,
    notifications: { id: `n${n}`, type, priority: "urgent", title: `SENTINEL-TITLE-${n}`, body: null, data, related_table: null, related_id: null,
      location_id: SHOP, created_at: `2026-10-0${n}T12:00:00Z` },
  };
}
const STORED = () => [
  stored("under_par_alert", { bodyParams: { openerName: "Opal Opener", prepped: 37713, par: 91919, closer: 55511, reasonCategory: "other", freeText: "SENTINEL-REASON" }, itemName: "SENTINEL-BRISKET" }),
  stored("opening_no_prior_data_alert", { openerName: "Otto Opener", cause: "SENTINEL-CAUSE" }),
  stored("pack_change_request", { vendorName: "SENTINEL-VENDOR", observed: "SENTINEL-PACK" }),
  stored("assignment_override", { overriderName: "Gina Manager" }),
  stored("vault_reveal", { actorName: "Vera Vault", count: 44417 }),
  stored("vault_entry_added", { actorName: "Val Vaultkeeper", label: "SENTINEL-VAULT" }),
];
const SENTINELS = ["SENTINEL-BRISKET", "Opal Opener", "37713", "91919", "55511", "SENTINEL-REASON", "Otto Opener", "SENTINEL-CAUSE",
  "SENTINEL-VENDOR", "SENTINEL-PACK", "Gina Manager", "Vera Vault", "44417", "Val Vaultkeeper", "SENTINEL-VAULT", "SENTINEL-TITLE"];

function seed(opts: { locations?: Row[] } = {}) {
  n = 0;
  state.db = recordingSupabase({
    notification_recipients: STORED(),
    locations: opts.locations ?? [{ id: SHOP, name: "Shop A", code: "SHOPCODE-A", active: true }],
  });
}

type Tree = "dashboard" | "admin" | "ordering" | "training";
async function renderTree(tree: Tree, role: RoleCode, opts: { boardLevel?: number; language?: "en" | "es" } = {}): Promise<ServerTree> {
  state.role = role; state.level = ROLES[role].level; state.boardLevel = opts.boardLevel ?? ROLES[role].level; state.language = opts.language ?? "en";
  // /ordering: its own shop read filters active shops; an inactive row sends it down the no-shop branch while the bar's
  // code read (which never filters by active) still finds the code.
  seed(tree === "ordering" ? { locations: [{ id: SHOP, name: "Shop A", code: "SHOPCODE-A", active: false }] } : {});
  if (tree === "dashboard") {
    const page = await DashboardPage({ searchParams: Promise.resolve({ loc: SHOP }) });
    return renderServerTree(AuthedLayout({ children: page }), { fallback });
  }
  if (tree === "admin") return renderServerTree(AdminLayout({ children: createElement(standIn("AdminPageBody")) }), { fallback });
  if (tree === "ordering") return renderServerTree(OrderingPage({ searchParams: Promise.resolve({}) }), { fallback });
  return renderServerTree(TrainingPage({ searchParams: Promise.resolve({}) }), { fallback });
}
const notificationQueries = () => state.db.queries.filter((q) => q.table === "notification_recipients" || q.table === "notifications");
const codeQueries = () => state.db.queries.filter((q) => q.table === "locations" && q.columns === "id, code");
const shell = (t: ServerTree) => t.standIns.filter((s) => s.name === "NavShell");
const model = (t: ServerTree) => shell(t)[0]!.props.model as { rooms: Array<{ entries: Array<{ id: string }>; groups: Array<{ entries: Array<{ id: string }> }> }>; people: boolean };
const ids = (t: ServerTree) => model(t).rooms.flatMap((r) => [...r.entries, ...r.groups.flatMap((g) => g.entries)]).map((e) => e.id);

beforeEach(() => { vi.clearAllMocks(); });

describe("the rule: notificationBellRoleAllowed, by the real role", () => {
  it("refuses the social media manager and no one else", () => {
    expect(BELL_REFUSED_ROLES).toEqual(["social_media_mgr"]);
    for (const role of Object.keys(ROLES) as RoleCode[]) expect(notificationBellRoleAllowed(role), role).toBe(role !== "social_media_mgr");
  });
});

describe.each(["dashboard", "admin", "ordering", "training"] as const)("G13, the %s tree", (tree) => {
  it("the SMM: no notification read or mark, no bell, no stored string; Go to is its four entries, no people", async () => {
    const t = await renderTree(tree, "social_media_mgr");
    for (const fn of ["loadUnreadForUser", "loadNoticeLocationCodes", "markAllNotificationsRead", "markNotificationRead"] as const) {
      expect(vi.mocked(notifications[fn]), fn).not.toHaveBeenCalled();
    }
    expect(notificationQueries()).toEqual([]);
    expect(codeQueries()).toEqual([]);
    expect(t.standIns.filter((s) => s.name === "BellIsland")).toEqual([]);
    expect(shell(t)).toHaveLength(1);
    expect(shell(t)[0]!.props.bell).toBeNull();
    for (const s of SENTINELS) expect(t.text, s).not.toContain(s);
    expect(ids(t)).toEqual(["dashboard", "me", "my-feedback", "training"]);
    expect(model(t).people).toBe(false);
    expect(vi.mocked(people.searchPeopleFor)).not.toHaveBeenCalled();
    expect(vi.mocked(people.loadPeopleDirectory)).not.toHaveBeenCalled();
    expect(t.standIns.filter((s) => s.name === "IdleTimeoutWarning")).toHaveLength(1);
  });
  it("the control, an AGM: the unread read and the code read run once; the island gets the notices and codes", async () => {
    const t = await renderTree(tree, "agm");
    expect(vi.mocked(notifications.loadUnreadForUser)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifications.loadNoticeLocationCodes)).toHaveBeenCalledTimes(1);
    expect(notificationQueries()).toHaveLength(1);
    expect(codeQueries()).toHaveLength(1);
    const islands = t.standIns.filter((s) => s.name === "BellIsland");
    expect(islands).toHaveLength(1);
    const initial = islands[0]!.props.initial as { notices: unknown[]; locationCodes: Record<string, string> };
    expect(initial.notices).toHaveLength(6);
    expect(initial.locationCodes).toEqual({ [SHOP]: "SHOPCODE-A" });
    expect(t.text).toContain("SENTINEL-BRISKET"); // the island's props carry them: the control is not vacuous
    expect(model(t).people).toBe(true);
    expect(vi.mocked(people.searchPeopleFor)).not.toHaveBeenCalled();
    expect(t.standIns.filter((s) => s.name === "IdleTimeoutWarning")).toHaveLength(1);
  });
});

describe("the Dashboard tree, folded in from tests/dashboard-smm-no-bell.test.ts (D3)", () => {
  it("with a \"works as\" key-holder role on the board, still no read and no bell (the real role decides)", async () => {
    expect(effectiveScheduleRole("social_media_mgr", "key_holder")).toBe("key_holder");
    const t = await renderTree("dashboard", "social_media_mgr", { boardLevel: ROLES.key_holder.level });
    expect(vi.mocked(notifications.loadUnreadForUser)).not.toHaveBeenCalled();
    for (const s of SENTINELS) expect(t.text, s).not.toContain(s);
    expect(t.standIns.filter((s) => s.name === "BellIsland")).toEqual([]);
  });
  it("in Spanish too", async () => {
    const t = await renderTree("dashboard", "social_media_mgr", { language: "es" });
    expect(vi.mocked(notifications.loadUnreadForUser)).not.toHaveBeenCalled();
    expect(t.standIns.filter((s) => s.name === "BellIsland")).toEqual([]);
    expect(t.text).toContain("Viewer");
  });
  it("the page itself never reads notifications, for any role (the bar does, once)", async () => {
    for (const role of ["key_holder", "agm", "gm"] as RoleCode[]) {
      vi.clearAllMocks();
      await renderTree("dashboard", role);
      expect(vi.mocked(notifications.loadUnreadForUser), role).toHaveBeenCalledTimes(1); // the bar's TopBarBell
    }
  });
  it("the denial notice a refused report page lands on: the fixed line for ?denied=reports only, in both languages", async () => {
    state.role = "social_media_mgr"; state.level = 6;
    for (const [lang, dict] of [["en", en], ["es", es]] as const) {
      state.language = lang;
      seed();
      const page = await DashboardPage({ searchParams: Promise.resolve({ loc: SHOP, denied: "reports" }) });
      const t = await renderServerTree(page, { fallback });
      expect(t.text).toContain((dict as Record<string, string>)["dashboard.denied.reports"]);
    }
    state.language = "en";
    seed();
    const other = await renderServerTree(await DashboardPage({ searchParams: Promise.resolve({ loc: SHOP, denied: "<script>x</script>" }) }), { fallback });
    expect(other.text).not.toContain(en["dashboard.denied.reports"]);
    expect(other.text).not.toContain("<script>x</script>");
  });
});
