/** Item 2: salaried cost to the PAYROLL shop (plan r2, Astra r2), pure (no I/O, no clock, no env).
 *
 * The payroll shop is an explicit, dated, audited assignment per 7SHIFTS ACCOUNT (0340 labor_payroll_shops,
 * one writer: save_labor_payroll_shop). It is the ONLY authority for where a salary is counted: links never
 * enter the allocation (a link is identity for display, never payroll), so unlinking or relinking a person
 * never moves a salaried row. There is no fallback and no split.
 *
 *  - allocateSalaried: per account in the week's universe (every account with a wage version in the source,
 *    plus every account with an assignment row), as of the week start. An in-force SHOP assignment whose shop
 *    is not stored this week (no live location link) is UNPLACED before the wage is looked at (Astra r2 P2 #3):
 *    otherwise a no-wage account's gap would have nowhere to be stored and the other shops would read complete.
 *    Any gap nulls the affected totals (unplaced: every stored shop; missing wage: its shop). Never 0.
 *  - payrollCensus: the onboarding / card view of EVERY 7shifts account in the mirror (Astra r2 P1): an
 *    account with no wage at all and no assignment is a "needs a decision" gap, never silently missing; so is
 *    an hourly account linked to a payroll-roster manager; and a roster manager with no 7shifts account is
 *    named. It carries no wage amount (has-salary flags only). */
import type { RoleCode } from "@/lib/roles";
import { pickWage, type WageVersion } from "./labor-wages-shared";

export type PayrollDisposition = "shop" | "excluded";
export interface PayrollShopRow {
  seq: number; sevenshifts_user_id: string; location_id: string | null; disposition: PayrollDisposition; valid_from: string;
  /** display only (the card's history); never read by the allocation */
  created_at?: string | null; created_by?: string | null; has_note?: boolean;
}
export interface LaborSalariedRow {
  location_id: string;
  /** NULL = unknown: nobody placed here, or any gap (unplaced anywhere, a missing wage here). Never 0 for unknown. */
  salaried_cents: number | null;
  salaried_people: number;
  /** salaried (or destination-less) accounts with no stored payroll shop this week: equal on every row */
  unplaced_people: number;
  /** accounts assigned here with no salary in 7shifts */
  missing_wage_people: number;
}
export type SalariedAccountState = "placed" | "excluded" | "unplaced_no_shop" | "unplaced_destination" | "missing_wage";
export interface SalariedAccount { account: string; state: SalariedAccountState; location_id: string | null; weekly_cents: number | null }

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The row in force for a week: the greatest valid_from <= the week start, then the greatest seq. */
export function payrollRowInForce(rows: readonly PayrollShopRow[], account: string, weekStart: string): PayrollShopRow | null {
  let best: PayrollShopRow | null = null;
  for (const r of rows) {
    if (String(r.sevenshifts_user_id) !== account || r.valid_from > weekStart) continue;
    if (!best || r.valid_from > best.valid_from || (r.valid_from === best.valid_from && r.seq > best.seq)) best = r;
  }
  return best;
}

/** The weekly salary of an account as of a date (the 0338 formula: weekly as is, annual / 52), or null. */
export function weeklySalaryOf(versions: readonly WageVersion[], date: string): number | null {
  const pick = pickWage(versions, "0", date);
  const w = pick.rate ?? pick.carryBack;
  if (!w || pick.payClass !== "salaried") return null;
  return w.wage_type === "weekly_salary" ? w.wage_cents : Math.round(w.wage_cents / 52);
}

function wagesByAccount(wages: readonly WageVersion[]): Map<string, WageVersion[]> {
  const by = new Map<string, WageVersion[]>();
  for (const w of wages) { const k = String(w.user_id); (by.get(k) ?? by.set(k, []).get(k)!).push(w); }
  return by;
}

export function allocateSalaried(input: {
  weekStart: string; storedShops: readonly string[]; payrollShops: readonly PayrollShopRow[]; wages: readonly WageVersion[];
}): { rows: LaborSalariedRow[]; accounts: SalariedAccount[] } {
  const stored = [...new Set(input.storedShops)].sort(cmp);
  const storedSet = new Set(stored);
  const by = wagesByAccount(input.wages);
  const universe = [...new Set([...by.keys(), ...input.payrollShops.map((r) => String(r.sevenshifts_user_id))])].sort(cmp);
  const accounts: SalariedAccount[] = [];
  for (const account of universe) {
    const a = payrollRowInForce(input.payrollShops, account, input.weekStart);
    const weekly = weeklySalaryOf(by.get(account) ?? [], input.weekStart);
    // Astra r2 P2 #3: an unavailable destination is classified BEFORE the wage.
    if (a?.disposition === "shop" && !storedSet.has(a.location_id ?? "")) {
      accounts.push({ account, state: "unplaced_destination", location_id: a.location_id, weekly_cents: weekly }); continue;
    }
    if (weekly !== null) {
      if (a?.disposition === "shop") accounts.push({ account, state: "placed", location_id: a.location_id, weekly_cents: weekly });
      else if (a?.disposition === "excluded") accounts.push({ account, state: "excluded", location_id: null, weekly_cents: weekly });
      else accounts.push({ account, state: "unplaced_no_shop", location_id: null, weekly_cents: weekly });
    } else if (a?.disposition === "shop") {
      accounts.push({ account, state: "missing_wage", location_id: a.location_id, weekly_cents: null });
    }
    // no salary + none / excluded: ignored
  }
  const unplaced = accounts.filter((x) => x.state === "unplaced_no_shop" || x.state === "unplaced_destination").length;
  const rows = stored.map((loc): LaborSalariedRow => {
    const placed = accounts.filter((x) => x.state === "placed" && x.location_id === loc);
    const missing = accounts.filter((x) => x.state === "missing_wage" && x.location_id === loc).length;
    const people = placed.length;
    const cents = placed.reduce((s, x) => s + (x.weekly_cents ?? 0), 0);
    return { location_id: loc, salaried_cents: people > 0 && unplaced === 0 && missing === 0 ? cents : null,
      salaried_people: people, unplaced_people: unplaced, missing_wage_people: missing };
  });
  return { rows, accounts };
}

/** The roles whose holders may be on a payroll as salaried (level 6+). The CGS is not salaried (Juan
 * 2026-11-17), so is not on it; anyone outside the roster who IS salaried shows up by their wage. */
export const PAYROLL_ROSTER_ROLES: readonly RoleCode[] = ["owner", "moo", "gm", "agm", "catering_mgr", "prep_mgr", "social_media_mgr"];

export type PayrollChip = "shop" | "excluded" | "needs_shop" | "needs_decision" | "no_salary" | "destination_unavailable";
export const PAYROLL_GAP_CHIPS: readonly PayrollChip[] = ["needs_shop", "needs_decision", "no_salary", "destination_unavailable"];
export interface CensusAccount {
  id: string; first_name: string | null; last_name: string | null; preferred_first_name: string | null; employee_id: string | null; active: boolean;
}
export interface CensusInput {
  /** the current payroll week (the card's "as of") */
  weekStart: string;
  /** shops with a live 7shifts location link (the only payroll destinations) */
  storedShops: readonly string[];
  /** EVERY 7shifts account in the mirror, active or not */
  accounts: readonly CensusAccount[];
  /** the current wage versions of those accounts (fact_wage_current_versions) */
  wages: readonly WageVersion[];
  /** live person links (display + the roster check only) */
  links: readonly { sevenshifts_user_id: string; user_id: string; linked_at_location_id: string }[];
  users: readonly { id: string; name: string; role: string; active: boolean }[];
  payrollShops: readonly PayrollShopRow[];
}
export interface CensusHistoryEntry {
  seq: number; validFrom: string; disposition: PayrollDisposition; locationId: string | null;
  createdAt: string | null; createdBy: string | null; hasNote: boolean;
}
export interface CensusRow {
  account: string; name: string; employeeId: string | null; active: boolean;
  linkedUsers: { id: string; name: string; role: string }[];
  hasWage: boolean; hasSalary: boolean;
  chip: PayrollChip; gap: boolean; locationId: string | null;
  /** the account's newest row (p_expected_seq of the next save), null = none yet */
  newestSeq: number | null;
  history: CensusHistoryEntry[];
}
export interface PayrollCensus {
  weekStart: string; rows: CensusRow[];
  rosterNoAccount: { id: string; name: string; role: string }[];
  /** hourly accounts with nothing to decide (not listed) */
  hourlyHidden: number;
  gapCount: number;
}

export function payrollCensus(input: CensusInput): PayrollCensus {
  const stored = new Set(input.storedShops);
  const by = wagesByAccount(input.wages);
  const usersById = new Map(input.users.map((u) => [u.id, u]));
  const roster = new Set<string>(PAYROLL_ROSTER_ROLES);
  const linksOf = new Map<string, { id: string; name: string; role: string }[]>();
  for (const l of input.links) {
    const u = usersById.get(l.user_id);
    if (!u) continue;
    const k = String(l.sevenshifts_user_id);
    const list = linksOf.get(k) ?? linksOf.set(k, []).get(k)!;
    if (!list.some((x) => x.id === u.id)) list.push({ id: u.id, name: u.name, role: u.role });
  }
  const rowsOf = new Map<string, PayrollShopRow[]>();
  for (const r of input.payrollShops) { const k = String(r.sevenshifts_user_id); (rowsOf.get(k) ?? rowsOf.set(k, []).get(k)!).push(r); }
  const ids = [...new Set([...input.accounts.map((a) => String(a.id)), ...rowsOf.keys()])];
  const accountById = new Map(input.accounts.map((a) => [String(a.id), a]));
  const rows: CensusRow[] = [];
  let hourlyHidden = 0;
  for (const id of ids) {
    const a = accountById.get(id);
    const versions = by.get(id) ?? [];
    const own = rowsOf.get(id) ?? [];
    const inForce = payrollRowInForce(own, id, input.weekStart);
    const hasWage = versions.length > 0;
    const hasSalary = weeklySalaryOf(versions, input.weekStart) !== null;
    const linkedUsers = (linksOf.get(id) ?? []).sort((x, y) => cmp(x.name, y.name) || cmp(x.id, y.id));
    const rosterLinked = linkedUsers.some((u) => roster.has(u.role) && usersById.get(u.id)?.active);
    let chip: PayrollChip | null;
    if (inForce?.disposition === "shop" && !stored.has(inForce.location_id ?? "")) chip = "destination_unavailable";
    else if (inForce?.disposition === "shop") chip = hasSalary ? "shop" : "no_salary";
    else if (inForce?.disposition === "excluded") chip = "excluded";
    else if (hasSalary) chip = "needs_shop";
    else if (!hasWage || rosterLinked) chip = "needs_decision";
    else chip = null;
    if (chip === null) { hourlyHidden++; continue; }
    const name = a ? [a.preferred_first_name ?? a.first_name, a.last_name].filter((x) => x && x.trim()).join(" ") : "";
    const history = [...own].sort((x, y) => y.seq - x.seq).map((r): CensusHistoryEntry => ({
      seq: r.seq, validFrom: r.valid_from, disposition: r.disposition, locationId: r.location_id,
      createdAt: r.created_at ?? null, createdBy: r.created_by ?? null, hasNote: r.has_note === true }));
    rows.push({ account: id, name, employeeId: a?.employee_id ?? null, active: a?.active ?? false, linkedUsers, hasWage, hasSalary,
      chip, gap: PAYROLL_GAP_CHIPS.includes(chip), locationId: inForce?.disposition === "shop" ? inForce.location_id : null,
      newestSeq: history[0]?.seq ?? null, history });
  }
  rows.sort((x, y) => Number(y.gap) - Number(x.gap) || cmp(x.name, y.name) || cmp(x.account, y.account));
  const linkedUserIds = new Set(input.links.map((l) => l.user_id));
  const rosterNoAccount = input.users.filter((u) => u.active && roster.has(u.role) && !linkedUserIds.has(u.id))
    .map((u) => ({ id: u.id, name: u.name, role: u.role })).sort((x, y) => cmp(x.name, y.name) || cmp(x.id, y.id));
  return { weekStart: input.weekStart, rows, rosterNoAccount, hourlyHidden, gapCount: rows.filter((r) => r.gap).length + rosterNoAccount.length };
}

/** Who sets payroll shops (and sees the card): the owner, the CGS and the MoO, by TRUSTED ROLE (never a level);
 * 0340's save_labor_payroll_shop re-checks the same three on the locked users row. */
export const PAYROLL_SHOP_ROLES: readonly RoleCode[] = ["owner", "cgs", "moo"];
export function canManagePayrollShops(role: RoleCode | string): boolean {
  return (PAYROLL_SHOP_ROLES as readonly string[]).includes(role);
}

/** Every refusal the card can show (en + es: labor.payroll.error.<code>). */
export const PAYROLL_SHOP_ERROR_CODES = ["forbidden", "invalid", "invalid_date", "unknown_account", "moved", "invalid_destination",
  "note_required", "unavailable", "generic"] as const;
export type PayrollShopErrorCode = (typeof PAYROLL_SHOP_ERROR_CODES)[number];

export interface PayrollShopSave {
  account: string; disposition: PayrollDisposition; locationId: string | null; validFrom: string; note: string; expectedSeq: number | null;
}
const SAVE_KEYS = ["account", "disposition", "locationId", "validFrom", "note", "expectedSeq"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The route's exact body, or null (a 400). The SQL writer re-judges every rule. */
export function parsePayrollShopSave(b: unknown): PayrollShopSave | null {
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !(SAVE_KEYS as readonly string[]).includes(k))) return null;
  if (typeof o.account !== "string" || !/^[1-9][0-9]{0,17}$/.test(o.account)) return null;
  if (o.disposition !== "shop" && o.disposition !== "excluded") return null;
  const loc = o.locationId ?? null;
  if (loc !== null && (typeof loc !== "string" || !UUID.test(loc))) return null;
  if ((o.disposition === "shop") !== (loc !== null)) return null;
  if (typeof o.validFrom !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.validFrom)) return null;
  const note = o.note ?? "";
  if (typeof note !== "string" || note.length > 500) return null;
  const exp = o.expectedSeq ?? null;
  if (exp !== null && (typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= 0)) return null;
  return { account: o.account, disposition: o.disposition, locationId: loc as string | null, validFrom: o.validFrom, note, expectedSeq: exp as number | null };
}

/** Every label of the Payroll shop card (en + es, tú; pinned by tests/labor-payroll-i18n.test.ts as the whole
 * labor.payroll namespace). */
export const PAYROLL_SHOP_I18N_KEYS = [
  "labor.payroll.title", "labor.payroll.intro", "labor.payroll.count", "labor.payroll.gaps", "labor.payroll.alert", "labor.payroll.week",
  "labor.payroll.unavailable",
  "labor.payroll.chip.shop", "labor.payroll.chip.excluded", "labor.payroll.chip.needs_shop", "labor.payroll.chip.needs_decision",
  "labor.payroll.chip.no_salary", "labor.payroll.chip.destination_unavailable",
  "labor.payroll.employee_id", "labor.payroll.inactive", "labor.payroll.linked", "labor.payroll.not_linked",
  "labor.payroll.field.shop", "labor.payroll.field.starts", "labor.payroll.field.note",
  "labor.payroll.option.choose", "labor.payroll.option.excluded", "labor.payroll.note_help", "labor.payroll.backdate_confirm",
  "labor.payroll.save", "labor.payroll.saving", "labor.payroll.success",
  "labor.payroll.history", "labor.payroll.history_empty", "labor.payroll.history_row", "labor.payroll.history_note",
  "labor.payroll.roster_title", "labor.payroll.roster_help", "labor.payroll.hourly_hidden",
  "labor.payroll.aria.row", "labor.payroll.aria.shop", "labor.payroll.aria.starts", "labor.payroll.aria.note",
  ...PAYROLL_SHOP_ERROR_CODES.map((c) => `labor.payroll.error.${c}` as const),
] as const;

/** A payroll week starts on Sunday (the SQL writer refuses any other day). */
export function isSunday(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && new Date(`${ymd}T12:00:00Z`).getUTCDay() === 0;
}
/** The Sunday that starts the payroll week holding an ET calendar date. */
export function payrollWeekOf(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}
