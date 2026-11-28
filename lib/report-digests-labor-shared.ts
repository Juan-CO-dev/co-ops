/**
 * Digest LABOR MONEY (digests round 3, PR 4) — the shared contract: the switch, the budgets, the facts the pre-load
 * seals, the access of one recipient, and the store the composers read. PURE: zero I/O, no env read.
 *
 * WHAT IT IS. With the switch on, the shop digest and the unified digest gain finished-span labor-money lines (the
 * latest final day, the payroll week so far, the last full payroll week, fully loaded, cost by role) for the people the
 * business report itself would show them to. NOTHING here is about today: day D never carries money.
 *
 * THE SWITCH. `DIGEST_LABOR_MONEY=1` AND the business report's own three switches. Off = no labor-money read, no
 * settings read, no new line: every byte and every call order of the digests is what it was.
 *
 * ONE PRE-LOAD, BEFORE THE FIRST COMPOSE (lib/preload-runner.ts, lib/report-digests-engine.ts). The ordinary
 * facts load first (so the digest's own Toast pull is over), then the GM settings, then the hourly facts, then the role
 * facts, each a piece with its own cap, all under one budget. Composing reads nothing: a recipient's email is built from
 * values that were fixed before anyone was composed, so it cannot depend on the order of recipients or on a read the
 * recipient cannot see.
 *
 * UNKNOWN IS NEVER ZERO. A figure prints only when every closing check it needs finished and passed. Everything else
 * is one of three sentences: "Labor cost not available", "Cost by role not available", "Labor figures are updating".
 */
import { businessAccessFor, type BusinessAccess, type GmVisibility } from "@/lib/business-access-shared";
import { businessReportEnabled } from "@/lib/business-report-shared";
import { laborHourlyKey, laborRolesKey, type HourlyLaborFacts, type RoleLaborFacts } from "@/lib/business-labor-shared";
import { preloadValue, type PreloadPiece, type PreloadResults, type PreloadTimers } from "@/lib/preload-runner";
import { isRoleCode } from "@/lib/roles";

// The budgets, the facts and their keys live in lib/business-labor-shared.ts (the core may import no digest module).
export * from "@/lib/business-labor-shared";

// ── The switch ──────────────────────────────────────────────────────────────────────────────────

/** `DIGEST_LABOR_MONEY=1` AND the business report's three switches. Unset = OFF. Read env only in buildIO. */
export function digestLaborMoneyEnabled(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.DIGEST_LABOR_MONEY === "1" && businessReportEnabled(env);
}

// ── What phase A seals, and the access of one recipient ─────────────────────────────────────────

/** The GM visibility settings as read once per run. `settings: null` = no row was ever saved (the defaults). */
export type GmSettingsResult = { kind: "settings"; settings: GmVisibility | null } | { kind: "unavailable" };

/**
 * THE labor-money access of one recipient, by ROLE (the business report's own rule, `businessAccessFor`):
 *
 * | Case                                                      | MoO / Owner / CGS | GM           | Anyone else |
 * |-----------------------------------------------------------|-------------------|--------------|-------------|
 * | no settings row saved                                     | everything        | the defaults | none        |
 * | a saved row                                               | everything        | the row      | none        |
 * | malformed row / missing table / error / throw / timeout   | everything        | NONE         | none        |
 * | `report` off                                              | everything        | none         | none        |
 *
 * null = no labor money at all. `settings` is what phase A sealed (null = it was not read, or did not finish: a GM
 * then gets nothing; MoO / Owner / CGS never need it).
 */
export function laborBusinessAccess(role: string, settings: GmSettingsResult | null): BusinessAccess | null {
  if (!isRoleCode(role)) return null;
  if (role === "moo" || role === "owner" || role === "cgs") return businessAccessFor(role, null);
  if (role !== "gm") return null;
  if (!settings || settings.kind !== "settings") return null;
  const access = businessAccessFor("gm", settings.settings);
  return access.report ? access : null;
}

// ── The loaders' contract and the sealed store ──────────────────────────────────────────────────

/** `DigestIO.laborMoney`: present only with the switch on. The engine runs these as pieces of ONE pre-load. */
export interface LaborMoneyIO {
  /** A REAL advancing clock in ms (never `io.now`, which is a fixed date). */
  clock: () => number;
  timers?: PreloadTimers;
  /** Phase A: the GM visibility settings, ONE read. */
  settings(): PreloadPiece<GmSettingsResult>;
  /** Phase B: one shop and business day. */
  hourly(locationId: string, day: string): PreloadPiece<HourlyLaborFacts>;
  /** Phase C: that shop and day's cost by role, from the hourly facts' `roleStep`. */
  roles(locationId: string, day: string, hourly: HourlyLaborFacts): PreloadPiece<RoleLaborFacts>;
}

/** The sealed, read-only result of a run's pre-load, as the composers see it. Never written onto the shop facts. */
export interface LaborMoneyStore {
  /** null = no entry (never loaded, cut, or the pre-load did not run): a holder reads "Labor cost not available". */
  hourly(locationId: string, day: string): HourlyLaborFacts | null;
  /** null = no entry: a holder of cost by role reads "Cost by role not available". */
  roles(locationId: string, day: string): RoleLaborFacts | null;
}

export function laborMoneyStore(results: PreloadResults): LaborMoneyStore {
  return {
    hourly: (locationId, day) => preloadValue<HourlyLaborFacts>(results, laborHourlyKey(locationId, day)),
    roles: (locationId, day) => preloadValue<RoleLaborFacts>(results, laborRolesKey(locationId, day)),
  };
}
