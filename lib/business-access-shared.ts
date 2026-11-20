/**
 * Business report ACCESS (item 9, Juan 2026-11-19; plan CHIEF item-09-BUSINESS-REPORT-ACCESS-PLAN-r6.md).
 *
 *   "the business report should be GM+, with MoO+ seeing the full all shops business report and GMs get their per
 *    shop business report. MoO+ should be able to switch on or off the things the GMs can see."
 *
 * Pure: zero I/O, no env, no clock, client-safe. ONE table of groups drives everything:
 *
 *   - GM_VISIBILITY_KEYS: the twelve switches a MoO / Owner / CGS saves (0349 business_report_gm_visibility; SQL twin
 *     valid_business_report_gm_visibility, pinned equal in tests/business-report-visibility-0349-migration.test.ts).
 *   - businessAccessFor(role, settings): what ONE viewer gets. MoO / Owner / CGS: everything, always (the settings
 *     never apply). GM: the settings, fail closed. Anyone else: nothing.
 *   - BUSINESS_ACCESS_GROUPS: every leaf path of the serialized report, each in the base or in exactly one group,
 *     and redactBusinessDto, the ONE place a key is removed for access (the loader's last statement).
 *
 * WHAT THE SWITCHES PROMISE (plan r6 section 2): ABSENCE, enforced on the server. A group that is off is not in a
 * GM's payload, page, CSV or PDF. They do NOT promise that a hidden figure cannot be worked out from visible ones.
 *
 * JUAN'S RULING 2026-11-19 (plan r6): "the GMs at each shop are doing the hiring and onboarding. So they inherently
 * know and see the pay of everyone at the shop." So HOURLY pay is not a secret from a shop's GM: each person's
 * hourly cost (`person_cost`) and labor dollars per 15 minutes (`quarter_cost`) are switches, ON by default, and a GM
 * only ever reads a shop they belong to. What the grouping still protects is SALARIED amounts (a shop's payroll can
 * carry an owner's or a director's salary), within a stated model (tests/business-report-pay-inference.test.ts):
 * fully loaded off = no salaried total and no salaried share can be worked out, whatever hourly switch is on. A
 * salaried amount per person has its OWN switch (`person_salary`, OFF by default). The report lists no such amount
 * today, for anyone; the switch is held now so that the day it does, a GM gets it only where a MoO+ turned it on, and
 * until then the redactor blanks any amount on a salaried person's row for a viewer without it.
 *
 * MoO / Owner / CGS never read the settings: everything, always. The two labor constants (PERSON_COST_MIN /
 * QUARTER_COST_MIN) are no longer read by the business report; they still decide the schedule board's per-hour
 * money. The overtime premium is not a switch: the hours a GM sees tie it to the hourly total, so it is shown with
 * hourly cost and hidden with it.
 */
import type { RoleCode } from "@/lib/roles";
import type { BusinessReportTab } from "@/lib/business-report-shared";

// ── The settings ────────────────────────────────────────────────────────────────────────────────

export const GM_VISIBILITY_KEYS = ["report", "hourly_cost", "loaded", "quarters", "quarter_cost", "channels", "people", "person_cost", "person_salary", "servers",
  "compare", "export"] as const;
export type GmVisibilityKey = (typeof GM_VISIBILITY_KEYS)[number];
export type GmVisibility = Record<GmVisibilityKey, boolean>;

/** A switch is in effect (and savable ON) only when every switch it needs is ON. */
export const GM_VISIBILITY_NEEDS: Record<GmVisibilityKey, readonly GmVisibilityKey[]> = {
  report: [], hourly_cost: ["report"], loaded: ["hourly_cost"], quarters: ["report"], quarter_cost: ["quarters", "hourly_cost"], channels: ["report"],
  people: ["report"], person_cost: ["people", "hourly_cost"], person_salary: ["people", "loaded"], servers: ["report"], compare: ["report"], export: ["report"],
};
/** No row saved yet (Juan 2026-11-19): everything ON, hourly cost per person and labor dollars per 15 minutes
 * included, except the salaried side: fully loaded labor (salaries, burden) and a salary per person are OFF. */
export const GM_VISIBILITY_DEFAULTS: GmVisibility = {
  report: true, hourly_cost: true, loaded: false, quarters: true, quarter_cost: true, channels: true, people: true, person_cost: true, person_salary: false,
  servers: true, compare: true, export: true,
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** No child ON under a parent that is OFF. */
export function coherentGmVisibility(s: GmVisibility): boolean {
  return GM_VISIBILITY_KEYS.every((k) => !s[k] || GM_VISIBILITY_NEEDS[k].every((p) => s[p]));
}
/** Exactly the twelve keys, each a boolean, coherent: or null. (The stored row's reader and the route's settings.) */
export function parseGmVisibility(v: unknown): GmVisibility | null {
  if (!isRecord(v)) return null;
  if (Object.keys(v).sort().join() !== [...GM_VISIBILITY_KEYS].sort().join()) return null;
  if (!GM_VISIBILITY_KEYS.every((k) => typeof v[k] === "boolean")) return null;
  const out = Object.fromEntries(GM_VISIBILITY_KEYS.map((k) => [k, v[k] as boolean])) as GmVisibility;
  return coherentGmVisibility(out) ? out : null;
}
/** Every coherent combination, enumerated from the NEEDS graph (tests run the real loader and export over all). */
export function gmVisibilityCombinations(): GmVisibility[] {
  const out: GmVisibility[] = [];
  for (let bits = 0; bits < 1 << GM_VISIBILITY_KEYS.length; bits++) {
    const s = Object.fromEntries(GM_VISIBILITY_KEYS.map((k, i) => [k, (bits & (1 << i)) !== 0])) as GmVisibility;
    if (coherentGmVisibility(s)) out.push(s);
  }
  return out;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface GmVisibilitySave { settings: GmVisibility; /** the newest saved row the person saw (null = none yet) */ expectedId: string | null }
/** The route's exact body, or null. */
export function parseGmVisibilitySave(body: unknown): GmVisibilitySave | null {
  if (!isRecord(body) || Object.keys(body).sort().join() !== "expectedId,settings") return null;
  const settings = parseGmVisibility(body.settings);
  const id = body.expectedId;
  if (!settings || !(id === null || (typeof id === "string" && UUID.test(id)))) return null;
  return { settings, expectedId: id === null ? null : id.toLowerCase() };
}

export const BUSINESS_VISIBILITY_ROLES: readonly RoleCode[] = ["owner", "cgs", "moo"];
/** Owner / CGS / MoO by trusted ROLE (0349's writer re-checks it on the locked users row). */
export function canManageBusinessVisibility(role: RoleCode): boolean {
  return BUSINESS_VISIBILITY_ROLES.includes(role);
}
export const BUSINESS_VISIBILITY_ERROR_CODES = ["forbidden", "invalid", "moved", "unchanged", "unavailable", "generic"] as const;
export type BusinessVisibilityErrorCode = (typeof BUSINESS_VISIBILITY_ERROR_CODES)[number];

// ── What one viewer gets ────────────────────────────────────────────────────────────────────────

export interface BusinessAccess {
  /** The report at all. */
  report: boolean;
  /** Hourly labor money: cost, the overtime premium, labor % and its tone. */
  hourlyCost: boolean;
  /** Fully loaded labor: salaries, burden, fully loaded cost and %. */
  loaded: boolean;
  /** The 15-minute grid (checks, sales, labor hours). */
  quarters: boolean;
  channels: boolean;
  /** Hours and overtime hours per person. */
  people: boolean;
  /** Sales per server. */
  servers: boolean;
  compare: boolean;
  /** CSV and PDF downloads. */
  export: boolean;
  /** Each HOURLY person's labor cost (Juan 2026-11-19: a GM knows their shop's hourly pay). Never a salaried amount. */
  personCost: boolean;
  /** Labor dollars and % per 15 minutes (hourly labor only). */
  quarterCost: boolean;
  /** A salaried amount per person: its own switch, OFF by default. The report lists none today. */
  personSalary: boolean;
}
const ACCESS_KEYS = ["report", "hourlyCost", "loaded", "quarters", "channels", "people", "servers", "compare", "export", "personCost", "quarterCost", "personSalary"] as const satisfies readonly (keyof BusinessAccess)[];
const NONE: BusinessAccess = { report: false, hourlyCost: false, loaded: false, quarters: false, channels: false, people: false, servers: false, compare: false,
  export: false, personCost: false, quarterCost: false, personSalary: false };
const FULL_ROLES: ReadonlySet<RoleCode> = new Set<RoleCode>(["moo", "owner", "cgs"]);

/**
 * THE access of one viewer. `settings` = the newest stored row's settings, or null when no row was ever saved (the
 * defaults). It is only ever read for a GM, and read FAIL CLOSED: a key that is missing or not `true` is off, and a
 * child is off unless every switch it needs is on, even on a row the validator would have refused.
 */
export function businessAccessFor(role: RoleCode, settings: unknown): BusinessAccess {
  const full = FULL_ROLES.has(role);
  if (!full && role !== "gm") return { ...NONE };
  const s: Record<string, unknown> = full ? {} : settings === null ? GM_VISIBILITY_DEFAULTS : isRecord(settings) ? settings : {};
  const on = (k: GmVisibilityKey): boolean => full || (s[k] === true && GM_VISIBILITY_NEEDS[k].every(on));
  // Every key is a switch; `on` already holds a child off under a parent that is off (cost per person needs the
  // people list AND hourly cost; a salary per person needs the people list AND fully loaded labor).
  return { report: on("report"), hourlyCost: on("hourly_cost"), loaded: on("loaded"), quarters: on("quarters"), channels: on("channels"),
    people: on("people"), servers: on("servers"), compare: on("compare"), export: on("export"),
    personCost: on("person_cost"), quarterCost: on("quarter_cost"), personSalary: on("person_salary") };
}
export function sameBusinessAccess(a: BusinessAccess, b: BusinessAccess): boolean {
  return ACCESS_KEYS.every((k) => a[k] === b[k]);
}

/** A GM reads the shops they belong to; MoO / Owner / CGS any shop. By ROLE, never by level; `all` is never a shop. */
export function businessShopAllowed(viewer: { role: RoleCode; locations?: readonly string[] }, locationId: string): boolean {
  if (locationId === "all") return false;
  if (FULL_ROLES.has(viewer.role)) return true;
  return viewer.role === "gm" && !!viewer.locations?.includes(locationId);
}
/** "All shops" (each shop's report, stacked): MoO / Owner / CGS by ROLE. */
export function businessAllShopsAllowed(role: RoleCode): boolean {
  return FULL_ROLES.has(role);
}

const TAB_NEEDS: Record<BusinessReportTab, (a: BusinessAccess) => boolean> = {
  overview: (a) => a.report, hours: (a) => a.quarters, channels: (a) => a.channels, people: (a) => a.people || a.servers, compare: (a) => a.compare,
};
const TAB_ORDER: readonly BusinessReportTab[] = ["overview", "hours", "channels", "people", "compare"];
export function businessTabAllowed(access: BusinessAccess, tab: BusinessReportTab): boolean {
  return access.report && TAB_NEEDS[tab](access);
}
export function businessTabsFor(access: BusinessAccess): BusinessReportTab[] {
  return TAB_ORDER.filter((tab) => businessTabAllowed(access, tab));
}

// ── The serialized payload, by group ────────────────────────────────────────────────────────────

const keys = (prefix: string, ks: readonly string[]) => ks.map((k) => `${prefix}.${k}`);
const LABOR_SCOPES = ["days[].labor", "weeks[].labor", "total.labor"] as const;
const each = (ks: readonly string[]) => LABOR_SCOPES.flatMap((s) => keys(s, ks));
/** Hours and net sales, and why they are not final: in every GM report. */
export const LABOR_BASE_KEYS = ["state", "minutes", "otMinutes", "denominator", "denominator.cents", "denominator.state", "hoursUnverified"] as const;
export const LABOR_HOURLY_KEYS = ["pureHourlyCents", "otPremiumCents", "pct", "tone", "wageEstimated"] as const;
export const LABOR_LOADED_KEYS = ["loadedState", "salariedCents", "burdenCents", "fullyLoadedCents", "loadedPct", "loadedTone", "burdenEstimated", "salaryEstimated", "salaryGaps"] as const;
const SALES_KEYS = ["date", "coverage", "checks", "toastChecksCents", "toastAmountMissing", "toastNetCents", "ezcaterCents", "ezcaterOrders",
  "ezcaterMissing", "refundCents", "totalCents", "giftCardCents", "ezcaterLinkedCents"] as const;
const RUSH_KEYS = ["state", "uncompared", "untimed", "baselineUntimed", "windows[].startAt", "windows[].endAt", "windows[].quarters", "windows[].checks", "windows[].cents",
  "windows[].baselineChecks", "windows[].baselineCents"] as const;
const CUT_KEYS = ["key", "label", "provider", "cents", "checks", "amountMissing", "unassigned"] as const;

export type BusinessAccessGroup = "hourlyCost" | "loaded" | "quarters" | "quarterCost" | "channels" | "people" | "personCost" | "servers";
interface Group {
  /** What the redactor removes when the group is off (a key of the DTO, or of every element of a list). */
  roots: readonly string[];
  /** Every leaf path the group may put in the serialized payload. */
  paths: readonly string[];
}
/**
 * Every leaf path of the serialized report (`x[]` = each element of x), in the base or in exactly ONE group. An
 * unknown path fails tests/business-report-gm-payload.test.ts; `compare`, `export` and `report` hold no key (they
 * are refusals), and neither does `personSalary` (the report lists no salaried amount per person; see
 * `blankSalariedAmounts`). The 15-minute grid's two keys stay in the base as `null` when the grid is not shared.
 */
export const BUSINESS_ACCESS_GROUPS: Record<"base" | BusinessAccessGroup, Group> = {
  base: { roots: [], paths: [
    "locationId",
    ...keys("range", ["range", "from", "to", "days", "shortened", "empty", "previous.from", "previous.to", "lastYear", "lastYear.from", "lastYear.to", "lastYearReason"]),
    ...keys("access", ACCESS_KEYS),
    "days[].date", ...keys("days[].sales", SALES_KEYS), "days[].cuts", ...each(LABOR_BASE_KEYS),
    "days[].largeChecks.checks", "days[].largeChecks.cents", "days[].rush", ...keys("days[].rush", RUSH_KEYS),
    "weeks[].weekStart", "weeks[].from", "weeks[].to", "weeks[].target", "weeks[].loadedTarget",
    ...keys("total.sales", ["totalCents", "toastChecksCents", "toastNetCents", "ezcaterCents", "refundCents", "coverage"]), "total.target", "total.loadedTarget",
    "quarters", "quartersUnassigned", "quartersReason",
    "largeChecks.checks", "largeChecks.cents",
    ...keys("rushRule", ["multiplier", "historyWeeks", "minHistory", "minChecks", "minBaselineChecks", "minRunQuarters"]),
  ] },
  hourlyCost: { roots: each(LABOR_HOURLY_KEYS), paths: each(LABOR_HOURLY_KEYS) },
  loaded: { roots: each(LABOR_LOADED_KEYS), paths: each(LABOR_LOADED_KEYS) },
  quarters: { roots: ["quarters", "quartersUnassigned"], paths: [
    ...keys("quarters[]", ["date", "quarterStartAt", "wallQuarter", "fold", "toastCents", "checks", "amountMissing", "laborMinutes", "basis", "tone"]),
    ...keys("quartersUnassigned[]", ["date", "toastCents", "checks", "amountMissing"]),
  ] },
  quarterCost: { roots: ["quarters[].straightCents", "quarters[].pct"], paths: ["quarters[].straightCents", "quarters[].pct"] },
  channels: { roots: ["channels"], paths: [...keys("channels.included[]", CUT_KEYS), ...keys("channels.excluded[]", CUT_KEYS)] },
  people: { roots: ["people"], paths: keys("people[]", ["personKey", "label", "source", "payClass", "minutes", "otMinutes", "weeksSuppressed"]) },
  personCost: { roots: ["people[].straightCostCents"], paths: ["people[].straightCostCents"] },
  servers: { roots: ["servers"], paths: keys("servers[]", CUT_KEYS) },
};
const GROUP_NAMES = ["hourlyCost", "loaded", "quarters", "quarterCost", "channels", "people", "personCost", "servers"] as const satisfies readonly BusinessAccessGroup[];
/** The leaf paths a viewer with this access may receive: the base and every group that is on. */
export function businessDtoPaths(access: BusinessAccess): string[] {
  return [...BUSINESS_ACCESS_GROUPS.base.paths, ...GROUP_NAMES.filter((g) => access[g]).flatMap((g) => BUSINESS_ACCESS_GROUPS[g].paths)];
}

/** Removes `path` (`a.b`, `list[].key`) from `node`, wherever it is. */
function remove(node: unknown, path: readonly string[]): void {
  if (!isRecord(node) || path.length === 0) return;
  const [head, ...rest] = path as [string, ...string[]];
  const list = head.endsWith("[]");
  const key = list ? head.slice(0, -2) : head;
  if (rest.length === 0) { delete node[key]; return; }
  const next = node[key];
  if (list) { if (Array.isArray(next)) for (const el of next) remove(el, rest); } else remove(next, rest);
}

/** The keys of a people row that are NOT money (hand-listed: anything else on a salaried person's row is an amount). */
export const PERSON_NON_MONEY_KEYS: readonly string[] = ["personKey", "label", "source", "payClass", "minutes", "otMinutes", "weeksSuppressed"];
/**
 * A salaried person's row carries no amount for a viewer without `personSalary`: every key of the row that is not
 * in PERSON_NON_MONEY_KEYS and holds a value is set to null. The loader prices hourly people only, so today this
 * changes nothing; it is the server-side hold that keeps a salaried amount (an owner's or a director's salary on a
 * shop's payroll) out of a GM's payload if a later read ever prices that row, whatever `personCost` says.
 */
function blankSalariedAmounts(dto: unknown): void {
  const people = isRecord(dto) ? dto.people : undefined;
  if (!Array.isArray(people)) return;
  for (const p of people) {
    if (!isRecord(p) || p.payClass === "hourly") continue;
    for (const k of Object.keys(p)) if (!PERSON_NON_MONEY_KEYS.includes(k) && p[k] !== null) p[k] = null;
  }
}

/** What is left of a report once the groups a viewer may not see are gone. */
export type Redacted<T> = T & { access: BusinessAccess };
/**
 * THE redaction (the loader's last statement; the only place a key is removed for access). Every root of every
 * group that is OFF is deleted from the report, and the access it was cut with is stamped on it: the page and the
 * export judge tabs and downloads on THAT (`assertBusinessSurface`), never on an earlier read. The 15-minute grid
 * that is not shared is `null` with `quartersReason: "not_shared"` (a list that is absent is never "none"). The
 * one VALUE it changes: an amount on a salaried person's row, for a viewer without `personSalary`.
 * Mutates and returns `dto` (the loader built it for this one request).
 */
export function redactBusinessDto<T extends { quarters?: unknown; quartersUnassigned?: unknown; quartersReason?: unknown }>(dto: T, access: BusinessAccess): Redacted<T> {
  for (const g of GROUP_NAMES) {
    if (access[g]) continue;
    if (g === "quarters") { dto.quarters = null; dto.quartersUnassigned = null; dto.quartersReason = "not_shared"; continue; }
    for (const root of BUSINESS_ACCESS_GROUPS[g].roots) remove(dto, root.split("."));
  }
  if (!access.personSalary) blankSalariedAmounts(dto);
  return Object.assign(dto, { access: { ...access } });
}

// ── i18n ────────────────────────────────────────────────────────────────────────────────────────

/** Every string of the "what GMs can see" card (en + es, pinned by tests/business-visibility-i18n.test.ts). */
export const BUSINESS_VISIBILITY_I18N_KEYS = [
  "business.visibility.title", "business.visibility.intro", "business.visibility.count", "business.visibility.unavailable", "business.visibility.promise",
  "business.visibility.group.access", "business.visibility.group.money", "business.visibility.group.tabs", "business.visibility.group.downloads",
  ...GM_VISIBILITY_KEYS.map((k) => `business.visibility.switch.${k}` as const), ...GM_VISIBILITY_KEYS.map((k) => `business.visibility.hint.${k}` as const),
  "business.visibility.needs", "business.visibility.salary_note", "business.visibility.state.on", "business.visibility.state.off",
  "business.visibility.save", "business.visibility.saving", "business.visibility.success", "business.visibility.no_changes", "business.visibility.last_saved",
  "business.visibility.never_saved", "business.visibility.open_report", "business.visibility.aria.switch",
  ...BUSINESS_VISIBILITY_ERROR_CODES.map((c) => `business.visibility.error.${c}` as const),
] as const;
