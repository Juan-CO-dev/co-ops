/**
 * The destination list's types (nav spec r5, PR 3; plan r5 section 2.2). Types only: no runtime.
 *
 * One list of every destination (lib/nav/destinations.ts) holds each page's id, route, name, room, Back office
 * group, tab family, parent, shop, who may see it, surface, `numbers` tag, search aliases and place-or-job.
 * Today's registries (NAV_LINKS, ADMIN_SECTIONS, the catering EDITORS) are derived from it by lib/nav/legacy.ts.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import type { RoleCode } from "@/lib/roles";

/** Spec section 1. */
export type RoomId = "today" | "catering" | "reports" | "back-office" | "me";
/** Spec 5.2, in display order. */
export type GroupId =
  | "people-and-schedule" | "menu-and-recipes" | "ordering-and-stock" | "catering-setup"
  | "checklists-and-reports" | "customers-and-marketing" | "system";
/** Spec 6.3. */
export type TabFamilyId =
  | "sales" | "staff-links" | "menu" | "supplies" | "recipe-changes" | "customers" | "schedule"
  | "catering-prices" | "lto" | "catering-customers" | "marketing" | "demand-signals" | "stock-loop";
/** The access plan's surfaces (r15 `ShopSurface` plus its PR 8 `schedule`). Swap for the import from
 *  lib/shop-access-shared.ts when access plan PR 1 lands; a test pins the two equal then. */
type Surface = "tasks" | "ops" | "catering" | "schedule" | "report_read";
/** Server switches. The module stays pure: the caller reads the environment and passes booleans. */
export type SwitchName = "pulseV2" | "vault" | "businessReport" | "demandSignals" | "marketingScorecard" | "customerProfiles";
export type Switches = Readonly<Partial<Record<SwitchName, boolean>>>;

/** Who may see it: the AdminSection vocabulary plus a switch. Read by canSee(), never by a page gate. */
interface Access {
  readonly minLevel: number;
  /** Roles below minLevel that also see it, by trusted role. */
  readonly alsoRoles?: readonly RoleCode[];
  /** When set, ONLY these roles see it (checked on top of the level rule). */
  readonly onlyRoles?: readonly RoleCode[];
  /** It exists only while this switch is on. */
  readonly requires?: SwitchName;
  /** A switch that lowers the floor while on (Shop pulse: PULSE_V2 opens it at level 2). */
  readonly floorWhenOn?: { readonly switch: SwitchName; readonly minLevel: number };
  /** A task (Destination.task set): from this level, an assignment today opens it below minLevel.
   *  Equals TASK_MIN_LEVEL[task] (lib/assignments-shared.ts); a test pins it. */
  readonly assignedFrom?: number;
  /** For these roles the destination also needs a fact to be true (today only: a GM and the business report). */
  readonly needsFact?: { readonly fact: "businessReportOffered"; readonly roles: readonly RoleCode[] };
}

/** The task types, as lib/assignments-shared.ts names them (pinned equal to TASK_TYPES by a test). */
export type TaskType = "am_prep" | "mid_day_prep" | "opening_report" | "cash_report" | "receiving" | "counts" | "ordering" | "pm_report";

/**
 * Per-request facts the pure list cannot know. The resolver's answer is FULLY RESOLVED for the facts given.
 * Absent facts mean "no": no assignment, not offered. That is exactly today's behaviour, so callers that pass
 * nothing (the legacy adapters) see no change. Closed: a test pins the keys. There is no "works as" fact.
 */
export interface Facts {
  /** This viewer's active assignments TODAY at the selected shop, counted as hasTaskAccess counts them
   *  (lib/assignments.ts: today's date, active row, the assignee still active and a member). */
  readonly assignedTasks?: ReadonlySet<TaskType>;
  /** The MoO+ setting offers the business report to GMs (lib/business-report.ts `businessReportOffered`).
   *  Read only for the roles in `needsFact.roles`; MoO, Owner and CGS never need it. */
  readonly businessReportOffered?: boolean;
}

export interface Destination {
  /** Stable id. Equals today's AdminSection id where the page has a Back office card. */
  readonly id: string;
  /** A real page route (no query, no trailing slash). */
  readonly route: string;
  /** The one name (spec 2). Typed TranslationKey: no casts. */
  readonly nameKey: TranslationKey;
  /** One muted line. Only keys that already exist (spec 5.2 "Descriptions for free"); PR 4 adds the rest. */
  readonly descriptionKey?: TranslationKey;
  readonly room: RoomId;
  /** The Back office group the row is listed under. Required in room back-office (except the hub); on another
   *  room only for the named cross-listed rows (Vendor mail, Catering setup). */
  readonly group?: GroupId;
  readonly tabFamily?: TabFamilyId;
  /** Destination id of the back-link parent. MIRRORS lib/nav-parents.ts today (parity test). */
  readonly parent?: string;
  /** Route patterns of pages that live under this destination and are not destinations themselves. */
  readonly children?: readonly string[];
  /** The page works on one shop picked in its URL (contract table or its own `location` param). */
  readonly takesShop: boolean;
  readonly access: Access;
  readonly surface?: Surface;
  /** Shows business numbers to someone it admits. Never resolves for the social media manager. */
  readonly numbers: boolean;
  /** Old names that must still find the page in search (spec 4.2). Not rendered. */
  readonly aliases?: { readonly en: readonly string[]; readonly es: readonly string[] };
  readonly kind: "place" | "job";
  /** The eight task destinations: the task type whose assignment opens it (with access.assignedFrom). */
  readonly task?: TaskType;
  /** A planned page with a muted Back office card (today only /admin/audit). Never in Go to or search. */
  readonly planned?: true;
  /** Label keys today's surfaces use when they differ from nameKey. Each must read the SAME name (guard b). */
  readonly labels?: { readonly chip?: TranslationKey; readonly card?: TranslationKey; readonly editor?: TranslationKey; readonly hub?: TranslationKey };
  /** Today's quirks the legacy adapters must reproduce. Deleted by the PRs that retire each surface. */
  readonly legacy?: { readonly chipScoped?: boolean; readonly editorId?: string };
}

/** Everything the resolver reads about a person. There is deliberately no "works as" field (guard g). */
export interface Viewer { readonly role: RoleCode; readonly level: number; readonly switches: Switches }
