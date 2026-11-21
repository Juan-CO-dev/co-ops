/**
 * The Back office, grouped (nav spec r5 section 5; nav PR 4 plan r2 section 2). Pure and client-safe.
 *
 * `/admin` reads its jobs and its headed groups of rows from here. Every row and job is a destination of the one
 * list (lib/nav/destinations.ts) and is shown by that destination's own "who may see it" (`canSee`), which
 * tests/nav-destinations-access.test.ts (guard d) ties to the page's gate. Nothing here grants access: a row is a
 * destination id, never a route literal, and tests/back-office-parity.test.ts proves that each role sees exactly the
 * pages it saw as Back office tiles, for every role and every switch combination.
 *
 * It reads the person's REAL role and level (guard g: never "works as") and the server switches the caller passes.
 */
import type { TranslationKey } from "@/lib/i18n/types";
import { GROUPS, byId } from "@/lib/nav/destinations";
import { canSee } from "@/lib/nav/resolve";
import type { Destination, GroupId, SwitchName, Viewer } from "@/lib/nav/types";
import { parWriteRoleAllowed } from "@/lib/par-permissions-shared";

/** Each group's name and its one line (spec 5.2). In GROUPS order. */
export const GROUP_LABELS: Readonly<Record<GroupId, { readonly nameKey: TranslationKey; readonly lineKey: TranslationKey }>> = {
  "people-and-schedule": { nameKey: "admin.backoffice.group.people_and_schedule.name", lineKey: "admin.backoffice.group.people_and_schedule.line" },
  "menu-and-recipes": { nameKey: "admin.backoffice.group.menu_and_recipes.name", lineKey: "admin.backoffice.group.menu_and_recipes.line" },
  "ordering-and-stock": { nameKey: "admin.backoffice.group.ordering_and_stock.name", lineKey: "admin.backoffice.group.ordering_and_stock.line" },
  "catering-setup": { nameKey: "admin.backoffice.group.catering_setup.name", lineKey: "admin.backoffice.group.catering_setup.line" },
  "checklists-and-reports": { nameKey: "admin.backoffice.group.checklists_and_reports.name", lineKey: "admin.backoffice.group.checklists_and_reports.line" },
  "customers-and-marketing": { nameKey: "admin.backoffice.group.customers_and_marketing.name", lineKey: "admin.backoffice.group.customers_and_marketing.line" },
  system: { nameKey: "admin.backoffice.group.system.name", lineKey: "admin.backoffice.group.system.line" },
};

/**
 * Each group's rows, in display order (plan r2, 2.2). One row per page until the tab strips (PR 11): Staff links and
 * Recipe changes stay three and two rows (lead decision 1). Menu and recipes goes by step, then the two recipe-change
 * rows (lead decision 3). The System group's only destination row is the planned Audit log; its two panels (System
 * status, This week in CO-OPS) are not destinations.
 */
export const GROUP_ROWS: Readonly<Record<GroupId, readonly string[]>> = {
  "people-and-schedule": ["schedule", "users", "stations", "toast-employees", "sevenshifts", "people-reconcile", "pm-criteria"],
  "menu-and-recipes": ["recipes", "items", "sandwiches", "recipe-notices", "shop-changes"],
  "ordering-and-stock": ["vendors", "skus", "products", "pars", "weights", "categories", "vendor-mail", "locations", "demand-signals"],
  "catering-setup": ["catering"],
  "checklists-and-reports": ["checklist-templates", "report-recipients"],
  "customers-and-marketing": ["customers", "marketing"],
  system: ["audit"],
};

/** The buying path (spec 5.2): each step's number and plain line, shown in place of the page's own description
 *  (lead decision 2). */
export const BUYING_PATH: Readonly<Record<string, { readonly step: 1 | 2 | 3 | 4 | 5 | 6; readonly lineKey: TranslationKey }>> = {
  vendors: { step: 1, lineKey: "admin.backoffice.step.vendors" },
  skus: { step: 2, lineKey: "admin.backoffice.step.skus" },
  products: { step: 3, lineKey: "admin.backoffice.step.products" },
  recipes: { step: 4, lineKey: "admin.backoffice.step.recipes" },
  items: { step: 5, lineKey: "admin.backoffice.step.items" },
  sandwiches: { step: 6, lineKey: "admin.backoffice.step.sandwiches" },
};

/** A job: a button to a page, never a card among places (spec 1, rule 2). */
export interface BackOfficeJob {
  readonly id: string;
  readonly labelKey: TranslationKey;
  /** The destination it opens. The job is shown exactly when that destination is (plus `alsoNeeds`). */
  readonly target: string;
  /** A second rule the job needs on top of its page's: only "Change a par", which a viewer who may only READ pars
   *  must not see (lead decision 7: the page's floor AND parWriteRoleAllowed). */
  readonly alsoNeeds?: "parWrite";
}

/** The jobs row (spec 5.1.3), in this order. */
export const BACK_OFFICE_JOBS: readonly BackOfficeJob[] = [
  { id: "add-person", labelKey: "admin.backoffice.job.add_person", target: "users" },
  { id: "add-sandwich", labelKey: "catalog.jobs.sandwich.title", target: "new-sandwich" },
  { id: "add-item", labelKey: "catalog.jobs.new_item.title", target: "new-item" },
  { id: "change-par", labelKey: "admin.backoffice.job.change_par", target: "pars", alsoNeeds: "parWrite" },
  { id: "edit-checklist", labelKey: "admin.backoffice.job.edit_checklist", target: "checklist-templates" },
];

/** Destinations that carry a Back office group but are not rows, each with its reason. Closed: a test fails if any
 *  other grouped destination is missing from both GROUP_ROWS and this list. */
export const NOT_A_ROW: Readonly<Record<string, string>> = {
  "schedule-settings": "the Schedule's Settings tab, reached from the schedule board",
  "demand-signals-sources": "the Demand signals Sources tab (MoO+), reached from the signals page",
  "customers-catering": "a Customers tab (Catering accounts), reached from the Customers page",
  "customers-consent": "a Customers tab (Marketing consent), reached from the Customers page",
  "new-sandwich": "a job (Add a sandwich), in the jobs row",
  "new-item": "a job (Add an item we buy), in the jobs row",
};

/** Every switch a row or job needs. The hub reads exactly these from the environment; the rest stay off. */
export const BACK_OFFICE_SWITCHES: readonly SwitchName[] = ["demandSignals", "marketingScorecard"];

export interface BackOfficeRow {
  readonly id: string;
  readonly href: string;
  readonly nameKey: TranslationKey;
  readonly lineKey?: TranslationKey;
  readonly step?: number;
  /** A planned page: muted, "Planned", no link (today only the Audit log). */
  readonly planned: boolean;
}

export interface BackOfficeGroup {
  readonly id: GroupId;
  readonly nameKey: TranslationKey;
  readonly lineKey: TranslationKey;
  readonly rows: readonly BackOfficeRow[];
}

export interface BackOffice {
  readonly jobs: readonly { readonly id: string; readonly labelKey: TranslationKey; readonly href: string; readonly target: string }[];
  /** The six headed groups, in GROUPS order; a group with no visible row is dropped. */
  readonly groups: readonly BackOfficeGroup[];
  /** The System group (always shown: its two panels are for everyone at /admin); `rows` may be empty. */
  readonly system: BackOfficeGroup;
}

/** Shown by the destination's own rule. A planned page is judged on its level rule (its muted card was), never
 *  opened: the row renders with no link. */
function visible(d: Destination, v: Viewer): boolean {
  return canSee(d.planned ? { ...d, planned: undefined } : d, v);
}

function rowOf(d: Destination): BackOfficeRow {
  const path = BUYING_PATH[d.id];
  const row: BackOfficeRow = { id: d.id, href: d.route, nameKey: d.nameKey, planned: d.planned === true };
  const lineKey = path?.lineKey ?? d.descriptionKey;
  return { ...row, ...(lineKey ? { lineKey } : {}), ...(path ? { step: path.step } : {}) };
}

function groupOf(id: GroupId, v: Viewer): BackOfficeGroup {
  return { id, ...GROUP_LABELS[id], rows: GROUP_ROWS[id].map(byId).filter((d) => visible(d, v)).map(rowOf) };
}

/** The Back office this viewer sees: the jobs, the non-empty groups and the System group. */
export function backOfficeFor(v: Viewer): BackOffice {
  const jobs = BACK_OFFICE_JOBS
    .filter((j) => canSee(byId(j.target), v) && (j.alsoNeeds !== "parWrite" || parWriteRoleAllowed(v.role)))
    .map((j) => ({ id: j.id, labelKey: j.labelKey, href: byId(j.target).route, target: j.target }));
  const groups = GROUPS.filter((g) => g !== "system").map((g) => groupOf(g, v)).filter((g) => g.rows.length > 0);
  return { jobs, groups, system: groupOf("system", v) };
}
