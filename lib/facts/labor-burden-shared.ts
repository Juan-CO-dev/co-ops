/** Board two labor views PR 2: THE BURDEN SETTING, pure (no I/O, no clock, no env).
 *
 * The burden % (employer payroll taxes + benefits) is a dated, append-only setting (0338 labor_burden_settings;
 * one writer, 0346's save_labor_burden): a COMPANY default (location NULL) with an optional per-SHOP override,
 * and (0346) a shop row that says "follow the company from <date>". Read time only: it never enters a build,
 * so a backdated row re-prices every week from its date at once.
 *
 * Juan 2026-11-18: the burden is an ESTIMATE until payroll gives the real figure (12% default, always labelled
 * estimated); the owner, the CGS and the MoO edit it.
 *
 *  - burdenFor is the TS twin of 0346's fact_labor_burden_for (the card shows what the pricer will read; the
 *    PRICER itself always asks SQL): the shop's row in force when it carries a rate, else the company row in
 *    force, else the default.
 *  - burdenCardView is what the card renders: the company scope, then every shop, each with the rate it reads
 *    this payroll week, its history and the head a save sends back (p_expected_id).
 *  - parseBurdenSave is the route's exact body. */
import type { RoleCode } from "@/lib/roles";
import { LABOR_BURDEN_DEFAULT_PCT, LABOR_FLOOR_WEEK } from "./labor-config-shared";
import { isSunday } from "./labor-payroll-shared";

export type BurdenSource = "estimated" | "payroll";
export const LABOR_BURDEN_MAX_PCT = 50;
export const LABOR_BURDEN_NOTE_MAX = 500;
export const LABOR_BURDEN_ROLES: readonly RoleCode[] = ["owner", "cgs", "moo"];
/** Owner / CGS / MoO by trusted ROLE (0346's writer re-checks it on the locked users row). */
export function canManageLaborBurden(role: RoleCode): boolean {
  return LABOR_BURDEN_ROLES.includes(role);
}

export interface BurdenRow {
  id: string;
  /** null = the company default */
  location_id: string | null;
  /** null exactly on a follow-the-company row */
  burden_pct: number | null; source: BurdenSource | null;
  valid_from: string; follows_company: boolean;
  created_at: string; created_by: string | null; has_note: boolean;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Newest first: valid_from, then created_at, then id (0346's ORDER BY). */
const byForce = (a: BurdenRow, b: BurdenRow) => cmp(b.valid_from, a.valid_from) || cmp(b.created_at, a.created_at) || cmp(b.id, a.id);
/** Newest SAVE first (the head a save is bound to): created_at, then id. */
const bySave = (a: BurdenRow, b: BurdenRow) => cmp(b.created_at, a.created_at) || cmp(b.id, a.id);

/** One scope's row in force for a payroll week: the greatest valid_from <= the week start, then the newest. */
export function burdenRowInForce(rows: readonly BurdenRow[], locationId: string | null, weekStart: string): BurdenRow | null {
  return rows.filter((r) => r.location_id === locationId && r.valid_from <= weekStart).sort(byForce)[0] ?? null;
}

export interface BurdenInForce { pct: number; basis: BurdenSource; scope: "shop" | "company" | "default" }
/** The burden a shop's payroll week reads (0346 fact_labor_burden_for). */
export function burdenFor(rows: readonly BurdenRow[], locationId: string, weekStart: string): BurdenInForce {
  const own = burdenRowInForce(rows, locationId, weekStart);
  if (own && !own.follows_company && own.burden_pct !== null && own.source !== null) return { pct: own.burden_pct, basis: own.source, scope: "shop" };
  return companyBurden(rows, weekStart);
}
function companyBurden(rows: readonly BurdenRow[], weekStart: string): BurdenInForce {
  const co = burdenRowInForce(rows, null, weekStart);
  if (co && co.burden_pct !== null && co.source !== null) return { pct: co.burden_pct, basis: co.source, scope: "company" };
  return { pct: LABOR_BURDEN_DEFAULT_PCT, basis: "estimated", scope: "default" };
}

export interface BurdenHistoryEntry {
  id: string; validFrom: string; pct: number | null; source: BurdenSource | null; followsCompany: boolean;
  createdAt: string; createdBy: string | null; hasNote: boolean;
  /** starts after this payroll week */
  scheduled: boolean;
}
export interface BurdenScopeView extends BurdenInForce {
  /** null = the company default */
  locationId: string | null; name: string | null;
  /** the newest row of this scope (p_expected_id of the next save); null = none yet */
  headId: string | null;
  /** a shop reading its OWN rate this week (the only state "follow the company" can end) */
  canFollowCompany: boolean;
  history: BurdenHistoryEntry[];
}
export interface BurdenCardView {
  /** the current payroll week (the card's "as of") */
  weekStart: string;
  /** the company first, then the shops in the order given */
  scopes: BurdenScopeView[];
  /** scopes whose rate this week is an estimate (the card's alert count) */
  estimatedCount: number;
}

export function burdenCardView(rows: readonly BurdenRow[], shops: readonly { id: string; name: string }[], weekStart: string): BurdenCardView {
  const scope = (locationId: string | null, name: string | null): BurdenScopeView => {
    const own = rows.filter((r) => r.location_id === locationId);
    const inForce = locationId === null ? companyBurden(rows, weekStart) : burdenFor(rows, locationId, weekStart);
    return {
      ...inForce, locationId, name, headId: [...own].sort(bySave)[0]?.id ?? null,
      canFollowCompany: locationId !== null && inForce.scope === "shop",
      history: [...own].sort(byForce).map((r) => ({ id: r.id, validFrom: r.valid_from, pct: r.burden_pct, source: r.source, followsCompany: r.follows_company,
        createdAt: r.created_at, createdBy: r.created_by, hasNote: r.has_note, scheduled: r.valid_from > weekStart })),
    };
  };
  const scopes = [scope(null, null), ...shops.map((s) => scope(s.id, s.name))];
  return { weekStart, scopes, estimatedCount: scopes.filter((s) => s.basis === "estimated").length };
}

export interface BurdenSave {
  /** null = the company default */
  locationId: string | null;
  followCompany: boolean;
  burdenPct: number | null; source: BurdenSource | null;
  /** a Sunday on or after the labor history's first week */
  validFrom: string;
  note: string;
  /** the scope's newest row the person saw (BurdenScopeView.headId) */
  expectedId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["burdenPct", "expectedId", "followCompany", "locationId", "note", "source", "validFrom"];
const uuidOrNull = (v: unknown): v is string | null => v === null || (typeof v === "string" && UUID.test(v));
/** A start the writer accepts: a real Sunday, never before the labor history's first payroll week. */
export function validBurdenStart(ymd: string): boolean {
  return YMD.test(ymd) && isSunday(ymd) && ymd >= LABOR_FLOOR_WEEK;
}

/** The route's exact body, or null. Ids come back in canonical lowercase. */
export function parseBurdenSave(body: unknown): BurdenSave | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).sort().join() !== KEYS.join()) return null;
  if (!uuidOrNull(b.locationId) || !uuidOrNull(b.expectedId) || typeof b.followCompany !== "boolean") return null;
  if (typeof b.validFrom !== "string" || !validBurdenStart(b.validFrom)) return null;
  if (typeof b.note !== "string" || b.note.length > LABOR_BURDEN_NOTE_MAX) return null;
  if (b.followCompany) {
    if (b.locationId === null || b.burdenPct !== null || b.source !== null) return null;
  } else {
    if (typeof b.burdenPct !== "number" || !Number.isFinite(b.burdenPct) || b.burdenPct < 0 || b.burdenPct > LABOR_BURDEN_MAX_PCT) return null;
    if (b.source !== "estimated" && b.source !== "payroll") return null;
  }
  return { locationId: b.locationId?.toLowerCase() ?? null, followCompany: b.followCompany, burdenPct: b.followCompany ? null : (b.burdenPct as number),
    source: b.followCompany ? null : (b.source as BurdenSource), validFrom: b.validFrom, note: b.note, expectedId: b.expectedId?.toLowerCase() ?? null };
}

export const LABOR_BURDEN_ERROR_CODES = ["forbidden", "invalid", "invalid_date", "moved", "already_following", "unavailable", "generic"] as const;
export type LaborBurdenErrorCode = (typeof LABOR_BURDEN_ERROR_CODES)[number];

/** Every string of the card (en + es, pinned by tests/labor-burden-i18n.test.ts). */
export const LABOR_BURDEN_I18N_KEYS = [
  "labor.burden.title", "labor.burden.intro", "labor.burden.count", "labor.burden.estimated_badge", "labor.burden.estimate_note", "labor.burden.week",
  "labor.burden.unavailable", "labor.burden.scope.company", "labor.burden.row", "labor.burden.chip.estimated", "labor.burden.chip.payroll",
  "labor.burden.reads.shop", "labor.burden.reads.company", "labor.burden.reads.default",
  "labor.burden.field.mode", "labor.burden.mode.rate", "labor.burden.mode.follow", "labor.burden.field.pct", "labor.burden.field.source",
  "labor.burden.source.estimated", "labor.burden.source.payroll", "labor.burden.field.starts", "labor.burden.field.note",
  "labor.burden.reprice_warning", "labor.burden.follow_help", "labor.burden.save", "labor.burden.saving", "labor.burden.success",
  "labor.burden.history", "labor.burden.history_empty", "labor.burden.history_rate", "labor.burden.history_follow", "labor.burden.history_scheduled",
  "labor.burden.history_note", "labor.burden.aria.row", "labor.burden.aria.mode", "labor.burden.aria.pct", "labor.burden.aria.source",
  "labor.burden.aria.starts", "labor.burden.aria.note",
  ...LABOR_BURDEN_ERROR_CODES.map((c) => `labor.burden.error.${c}` as const),
] as const;
