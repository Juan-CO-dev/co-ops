/**
 * The Dashboard on the day engine (nav PR 7, plan r2 section 2.1): the page's pure helpers. Client-safe, zero I/O, no
 * clock, no env. The page and its components read the plan through these and nothing else: which surfaces a viewer holds
 * at the selected shop (interim), the viewer the engine is given, each row's name and link, the greeting, the one
 * aggregate-failure predicate, the shortcuts, and the AM prep submitter's "Edit" (C.46 A2).
 *
 * It reads the REAL role only and never "works as" (tests/dashboard-works-as.test.ts scans it).
 */
import { taskHref } from "@/lib/assignments-shared";
import { closingStationAnchor } from "@/lib/assignment-sections";
import { deriveCloseState } from "@/lib/dashboard-status-shared";
import { lensFor, type DayItem, type DayPlan, type DayPlanInput, type DayViewer, type Surface } from "@/lib/day-plan-shared";
import type { TranslationKey } from "@/lib/i18n/types";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { byId } from "@/lib/nav/destinations";
import { canSee } from "@/lib/nav/resolve";
import type { Destination, Switches } from "@/lib/nav/types";
import type { RoleCode } from "@/lib/roles";
import { shopParamNames } from "@/lib/shop-context-shared";

// ── Surfaces and the viewer ──────────────────────────────────────────────────────────────────────────────────────────

/** The surfaces a member holds at their shop (the set PR 5's fixtures give a member). */
export const MEMBER_SURFACES: ReadonlySet<Surface> = new Set<Surface>(["tasks", "ops", "catering", "schedule", "report_read"]);
const NO_SURFACES: ReadonlySet<Surface> = new Set<Surface>();

/**
 * INTERIM (spec 10), on today's helpers: a viewer who may work in the shop (`lockLocationContext`: a member, or level 9+)
 * holds every member surface there; anyone else holds none. Every shop the Dashboard can select comes from
 * `accessibleLocations`, so in production every viewer holds every surface at the selected shop. Replaced by the access
 * plan PR 1's surface module.
 */
export function dashboardSurfaces(actor: LocationActor, shopId: string): ReadonlySet<Surface> {
  return lockLocationContext(actor, shopId) ? MEMBER_SURFACES : NO_SURFACES;
}

/** The session fields the Dashboard's viewer is built from (the REAL role; a session carries no "works as"). */
export interface DashboardAuth {
  readonly user: { readonly id: string };
  readonly role: RoleCode;
  readonly level: number;
  readonly locations: readonly string[];
}

/** The engine's viewer for this shop: the real role, the level, the surfaces held here, the request's switches. */
export function dayViewerFor(auth: DashboardAuth, shopId: string, switches: Switches): DayViewer {
  return {
    userId: auth.user.id, role: auth.role, level: auth.level,
    surfaces: dashboardSurfaces({ role: auth.role, locations: [...auth.locations] }, shopId), switches,
  };
}

// ── Row names and links ──────────────────────────────────────────────────────────────────────────────────────────────

/** Items whose name is not their destination's: catering (a level-4 catering item points at `mid-shift`). */
export const ITEM_NAME_KEY: Readonly<Partial<Record<DayItem["id"], TranslationKey>>> = {
  catering_today: "day.task.catering_today",
};

/** The row's name key; `station` → null (its card title is built from the station's own name). */
export function itemNameKey(item: Pick<DayItem, "id" | "destId">): TranslationKey | null {
  if (item.id === "station") return null;
  return ITEM_NAME_KEY[item.id] ?? byId(item.destId).nameKey;
}

const withShop = (route: string, shopId: string) => `${route}?location=${encodeURIComponent(shopId)}`;

/** Where the row's name and its "Do it" go. Every listed item opens (the lens already removed what the viewer may not open). */
export function itemHref(item: Pick<DayItem, "id" | "destId" | "section" | "task">, shopId: string): string {
  if (item.id === "station") {
    const base = withShop("/operations/closing", shopId);
    return item.section ? `${base}#${closingStationAnchor(item.section)}` : base;
  }
  if (item.task) return taskHref(item.task, shopId);
  if (item.id === "closing") return withShop("/operations/closing", shopId);
  if (item.id === "catering_today" && item.destId === "mid-shift") return withShop("/mid-shift/catering", shopId);
  const d = byId(item.destId);
  return d.takesShop ? withShop(d.route, shopId) : d.route;
}

/** The AM prep report in edit mode: exactly the old tile's href (C.46 A2). The page's own gate decides. */
export const AM_PREP_EDIT_HREF = (shopId: string): string => `/operations/am-prep?location=${encodeURIComponent(shopId)}&edit=true`;
/** "Assign" opens Team today at the shop. */
export const ASSIGN_HREF = (shopId: string): string => withShop("/assignments", shopId);

// ── Greeting and the aggregate failure ───────────────────────────────────────────────────────────────────────────────

/** By the minutes into the plan date (the request's one instant, through the loader). */
export function greetingKey(nowMin: number): "dashboard.greeting.morning" | "dashboard.greeting.afternoon" | "dashboard.greeting.evening" {
  return nowMin < 12 * 60 ? "dashboard.greeting.morning" : nowMin < 17 * 60 ? "dashboard.greeting.afternoon" : "dashboard.greeting.evening";
}

/**
 * Every fact failed (the engine's `day.fail.all` note). THE one predicate: under it the page draws no phase line and no
 * Next up claim (Astra F2, Q5); the rows stay, unknown, with the notice. No other inference.
 */
export function aggregateFailure(plan: Pick<DayPlan, "notes">): boolean {
  return plan.notes.some((n) => n.reason.key === "day.fail.all");
}

// ── Shortcuts (spec 3.6) ─────────────────────────────────────────────────────────────────────────────────────────────

const TRAINEE_LIST = ["training", "my-feedback", "assignments", "profile"] as const;
/** Spec 3.6 as destination ids, per real role, in order. The level 0-1 roles get the trainee list (Q8). */
export const SHORTCUTS: Readonly<Record<RoleCode, readonly string[]>> = {
  trainee: TRAINEE_LIST,
  hired_not_yet_worked: TRAINEE_LIST,
  prospect: TRAINEE_LIST,
  employee: ["assignments", "production", "maintenance", "training", "my-feedback"],
  key_holder: ["mid-shift", "assignments", "production", "maintenance", "reports"],
  trainer: ["mid-shift", "assignments", "production", "maintenance", "reports"],
  shift_lead: ["mid-shift", "assignments", "catering-workspace", "reports", "maintenance"],
  agm: ["mid-shift", "schedule", "assignments", "reports", "recipes", "admin"],
  prep_mgr: ["production", "pars", "recipes", "catering-prep-demand", "mid-shift", "admin"],
  catering_mgr: ["catering-workspace", "catering-inbox", "catering-prep-demand", "schedule", "assignments", "admin"],
  gm: ["mid-shift", "schedule", "vendor-mail", "reports", "catering-workspace", "admin"],
  moo: ["mid-shift", "business", "schedule", "vendor-mail", "catering-workspace", "admin"],
  owner: ["business", "sales", "mid-shift", "catering-insights", "marketing", "admin"],
  cgs: ["business", "sales", "mid-shift", "catering-insights", "marketing", "admin"],
  social_media_mgr: ["training", "my-feedback"],
};

/**
 * The role's own list, each kept only when its real gate admits the viewer (`canSee`), the viewer holds its surface here,
 * and (for the social media manager) it shows no business numbers. No backfill from outside the list; no facts passed.
 */
export function shortcutsFor(viewer: Pick<DayViewer, "role" | "level" | "surfaces" | "switches">): Destination[] {
  const nav = { role: viewer.role, level: viewer.level, switches: viewer.switches };
  const smm = lensFor(viewer.role) === "smm";
  return SHORTCUTS[viewer.role].map((id) => byId(id))
    .filter((d) => canSee(d, nav) && (d.surface === undefined || viewer.surfaces.has(d.surface)) && !(smm && d.numbers));
}

/** The shortcut's link: the shop rides in the route's own declared parameter, unless the route is shop-less or its chip is bare. */
export function shortcutHref(d: Pick<Destination, "route" | "takesShop" | "legacy">, shopId: string | null): string {
  const param = shopParamNames(d.route)[0];
  return shopId && d.takesShop && param && d.legacy?.chipScoped !== false ? `${d.route}?${param}=${encodeURIComponent(shopId)}` : d.route;
}

// ── The AM prep submitter's Edit (Q2 carve-out, C.46 A2) ────────────────────────────────────────────────────────────

/**
 * The "Edit" link for the AM prep row, only for the person who finished today's AM prep (the instance's `confirmed_by`,
 * read instance-first by the loader, E3). No template-first read. The AM prep page's own `canEditReport` gate still decides.
 */
export function amPrepEditFor(input: Pick<DayPlanInput, "planDate" | "facts">, userId: string, shopId: string): string | undefined {
  if (input.facts.kind !== "shop" || input.facts.amPrep.kind !== "ok") return undefined;
  const am = input.facts.amPrep.value;
  if (am.forDate !== input.planDate || !am.finishedById || am.finishedById !== userId) return undefined;
  const s = deriveCloseState(am.status).status;
  return s === "closed" || s === "auto_finalized" ? AM_PREP_EDIT_HREF(shopId) : undefined;
}
