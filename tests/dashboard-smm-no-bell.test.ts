/**
 * Nav spec r3 PR S1 — no notification bell for the social media manager (sections 8.1 / 8.2, 3.7 group 13).
 *
 * The unread read picks rows by recipient, unread state and shop, never by the person's role today, so a
 * notice stored while someone held another role would still be served after they become the social media
 * manager. For that role, by the REAL role: the notification read is never called, no bell is drawn, and
 * none of the stored notices' fields (item, amounts, par, names, shop) reaches the page output.
 *
 * The bell is replaced by a stand-in that prints every prop it is given, so the test sees exactly what the
 * server would hand the client island. A control (a key holder, an AGM) still gets the read and the bell.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES, type RoleCode } from "@/lib/roles";
import { TranslationProvider } from "@/lib/i18n/provider";
import { BELL_REFUSED_ROLES, notificationBellRoleAllowed } from "@/lib/notification-bell-shared";
import { effectiveScheduleRole } from "@/lib/scheduling/works-as-shared";
import en from "@/lib/i18n/en.json";
import es from "@/lib/i18n/es.json";

const state = vi.hoisted(() => ({ role: "social_media_mgr" as string, level: 6, language: "en" as "en" | "es", boardLevel: 6, unread: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/session", () => ({ requireSessionFromHeaders: async () => ({
  user: { id: "viewer", name: "Viewer", language: state.language }, session: { id: "session-dash" },
  level: state.level, role: state.role, locations: ["shop-a"],
}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => ({ from: (table: string) => {
  const result = { data: table === "locations" ? [{ id: "shop-a", name: "Shop A", code: "SHOPCODE-A" }] : [], error: null };
  const query = {
    select: () => query, eq: () => query, in: () => query, order: () => query,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
} }) }));
// The shift board can show the viewer working as a key holder (a scheduling "works as" role): the bell must not care.
vi.mock("@/lib/assignments", () => ({
  loadShiftBoard: async () => ({ locationId: "shop-a", date: "2026-10-07", viewerId: "viewer", viewerLevel: state.boardLevel,
    people: [{ id: "viewer", name: "Viewer", level: state.boardLevel, hasWork: false }], stations: [], events: [], tasks: [] }),
  loadOwnTaskAssignments: async () => [],
  loadStationDayFlags: async () => ({ installed: false }),
}));
vi.mock("@/lib/checklists", () => ({ evaluateAutoReleaseForUserLocations: vi.fn() }));
// Nav PR 7: the Dashboard renders the day engine; the real loader runs on PR 6's fake reads (no database).
vi.mock("@/lib/day-plan", async (orig) => {
  const m = await orig<typeof import("@/lib/day-plan")>();
  const { okDeps } = await import("./fixtures/day-plan/loader-deps");
  return { ...m, loadDayFacts: (sb: Parameters<typeof m.loadDayFacts>[0], a: Parameters<typeof m.loadDayFacts>[1]) => m.loadDayFacts(sb, a, okDeps()) };
});
vi.mock("@/lib/notifications", () => ({
  loadUnreadForUser: state.unread,
  notificationLocationContext: (a: { level: number; locations: string[] }) => (a.level >= 9 && a.locations.length === 0 ? undefined : a.locations),
}));
vi.mock("@/lib/receiving", () => ({ loadRecentDeliveries: async () => [] }));
vi.mock("@/lib/counts", () => ({ loadCountsTileState: async () => null }));
vi.mock("@/lib/yield-stats", () => ({ loadMyRetrainTasks: async () => [] }));
vi.mock("@/components/auth/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/BrandMark", () => ({ BrandMark: () => null }));
vi.mock("@/components/auth/LogoutButton", () => ({ LogoutButton: () => null }));
// Prints everything the bell island would be handed.
vi.mock("@/components/dashboard/NotificationBell", () => ({
  NotificationBell: (props: unknown) => createElement("i", { "data-bell": JSON.stringify(props) }),
}));
vi.mock("@/components/DashboardNav", () => ({ DashboardNav: () => null }));
vi.mock("@/components/production/RetrainTaskList", () => ({ RetrainTaskList: () => null }));

import DashboardPage from "@/app/(authed)/dashboard/page";

const ROOT = path.resolve(__dirname, "..");

/** Unread notices stored while the person held an earlier role (a key holder, then a GM). */
const notice = (type: string, title: string, data: Record<string, unknown>, i: number) => ({
  notification: { id: `n${i}`, type, priority: "urgent", title, body: null, data, relatedTable: null, relatedId: null, locationId: "shop-a", createdAt: `2026-10-0${i}T12:00:00Z` },
  recipient: { id: `r${i}`, notificationId: `n${i}`, userId: "viewer", deliveryMethod: "in_app", deliveryStatus: "sent", readAt: null, acknowledgedAt: null },
});
const STORED = [
  notice("under_par_alert", "Under par", { itemName: "SENTINEL-BRISKET", openerName: "Opal Opener", prepped: 37713, par: 91919, closerName: "Cole Closer", closerCount: 55511, reason: "SENTINEL-REASON" }, 1),
  notice("opening_no_prior_data_alert", "Opening", { openerName: "Otto Opener", locationCode: "SHOPCODE-A", date: "2026-10-02", cause: "SENTINEL-CAUSE" }, 2),
  notice("pack_change_request", "Pack change", { vendorName: "SENTINEL-VENDOR", observed: "SENTINEL-PACK" }, 3),
  notice("assignment_override", "Override", { overriderName: "Gina Manager" }, 4),
  notice("vault_reveal", "Vault", { actorName: "Vera Vault", role: "gm", locationCode: "SHOPCODE-A", count: 44417 }, 5),
];
const SENTINELS = ["SENTINEL-BRISKET", "Opal Opener", "37713", "91919", "Cole Closer", "55511", "SENTINEL-REASON", "Otto Opener",
  "SENTINEL-CAUSE", "SENTINEL-VENDOR", "SENTINEL-PACK", "Gina Manager", "Vera Vault", "44417", "data-bell"];

async function render(role: RoleCode, opts: { boardLevel?: number; language?: "en" | "es"; denied?: string } = {}) {
  state.role = role;
  state.level = ROLES[role].level;
  state.boardLevel = opts.boardLevel ?? ROLES[role].level;
  state.language = opts.language ?? "en";
  const page = await DashboardPage({ searchParams: Promise.resolve({ loc: "shop-a", ...(opts.denied ? { denied: opts.denied } : {}) }) });
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(createElement(TranslationProvider, { initialLanguage: state.language, children: page }));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.unread.mockResolvedValue(STORED);
});

describe("the rule: notificationBellRoleAllowed, by role", () => {
  it("refuses the social media manager and no one else", () => {
    expect(BELL_REFUSED_ROLES).toEqual(["social_media_mgr"]);
    for (const role of Object.keys(ROLES) as RoleCode[]) expect(notificationBellRoleAllowed(role), role).toBe(role !== "social_media_mgr");
  });
});

describe("the social media manager gets no notification read and no bell", () => {
  it("stored unread notices from an earlier role are neither read nor rendered", async () => {
    const html = await render("social_media_mgr");
    expect(state.unread).not.toHaveBeenCalled();
    for (const sentinel of SENTINELS) expect(html, sentinel).not.toContain(sentinel);
    // No "couldn't load" placeholder stands in for the bell either: nothing was attempted.
    expect(html).not.toContain(en["notifications.sheet.heading"]);
    expect(html).toContain("Viewer"); // the page itself still renders
  });

  it("with a \"works as\" key-holder role on the board, still no read and no bell (the real role decides)", async () => {
    expect(effectiveScheduleRole("social_media_mgr", "key_holder")).toBe("key_holder");
    const html = await render("social_media_mgr", { boardLevel: ROLES.key_holder.level });
    expect(state.unread).not.toHaveBeenCalled();
    for (const sentinel of SENTINELS) expect(html, sentinel).not.toContain(sentinel);
  });

  it("in Spanish too", async () => {
    const html = await render("social_media_mgr", { language: "es" });
    expect(state.unread).not.toHaveBeenCalled();
    expect(html).not.toContain("data-bell");
  });
});

describe("the control: other roles keep the read and the bell", () => {
  it.each(["key_holder", "agm", "gm"] as RoleCode[])("%s", async (role) => {
    const html = await render(role);
    expect(state.unread).toHaveBeenCalledTimes(1);
    expect(state.unread.mock.calls[0]![1]).toBe("viewer");
    expect(html).toContain("data-bell");
    expect(html).toContain("SENTINEL-BRISKET");
  });
});

describe("the denial notice a refused report page lands on", () => {
  it("shows the fixed line for ?denied=reports, in both languages", async () => {
    expect(await render("social_media_mgr", { denied: "reports" })).toContain(en["dashboard.denied.reports"].replace(/'/g, "&#x27;"));
    expect(await render("social_media_mgr", { denied: "reports", language: "es" })).toContain(es["dashboard.denied.reports"]);
  });
  it("shows nothing for any other value", async () => {
    const html = await render("agm", { denied: "<script>x</script>" });
    expect(html).not.toContain(en["dashboard.denied.reports"].replace(/'/g, "&#x27;"));
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("census: every caller of the notification read or the bell applies the rule by the real role", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) return entry === "node_modules" ? [] : walk(full);
      return /\.(ts|tsx)$/.test(entry) ? [full] : [];
    });
  }
  const files = [...walk(path.join(ROOT, "app")), ...walk(path.join(ROOT, "components"))];
  const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");

  it("any page or layout that loads unread notices or draws the bell runs notificationBellRoleAllowed(auth.role)", () => {
    const callers = files.filter((file) => /loadUnreadForUser\(|<NotificationBell\b/.test(readFileSync(file, "utf8")))
      // The bell component itself and its list are the drawn surface, not a caller.
      .filter((file) => !/components\/dashboard\/Notification(Bell|List)\.tsx$/.test(rel(file)));
    expect(callers.map(rel)).toEqual(["app/(authed)/dashboard/page.tsx"]);
    for (const file of callers) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("notificationBellRoleAllowed(auth.role)");
      // The read only runs behind the rule, and the bell only draws behind it. Nav PR 7: the read starts in parallel
      // (bounded by the page deadline), so it is no longer awaited inline.
      expect(src).toMatch(/bellAllowed\s*\n?\s*\?\s*widget\("notifications\.sheet\.heading", \(\) => loadUnreadForUser\(/);
      expect(src).toContain("{bellAllowed && unreadNotifications && <NotificationBell");
    }
  });
});
