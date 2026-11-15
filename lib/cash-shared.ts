/**
 * Cash — CLIENT-SAFE shared surface (pure money math + constants + types; no
 * I/O, no server imports). Split from cash.ts on 2026-07-23: the `server-only`
 * guard on lib/supabase-server.ts surfaced cash-client.tsx and
 * DenominationCounter.tsx runtime imports dragging the service-role module
 * (via cash.ts -> audit.ts) into the client graph (PR #165 CI catch — fifth
 * and final chain; verified last by transitive census).
 */

import { etCalendarDate, etYmdMinusDays } from "@/lib/operational-day";

/** KH+ — matches the closing-finalize gate (the closer deposits). */
export const CASH_REPORT_BASE_LEVEL = 4;

/**
 * W03 follow-up (owner ruling, Juan 2026-11-15): GM (7) and above file or edit a cash report for
 * ANY date. Everyone below GM who can file cash (key holders, shift leads, the level-6 managers,
 * an assignee) is limited to the CURRENT business week, Monday through Sunday.
 */
export const CASH_ANY_DATE_MIN_LEVEL = 7;

/**
 * The cash business day an instant falls on: the ET calendar date — the same helper the /cash page
 * has always used for its `today` (`etCalendarDate`). One definition for the page and the write gate.
 */
export function cashBusinessDay(nowIso: string): string {
  return etCalendarDate(nowIso);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A well-formed REAL calendar date (2026-02-30 is refused, not normalized). */
function isCalendarYmd(ymd: string): boolean {
  return YMD_RE.test(ymd) && etYmdMinusDays(ymd, 0) === ymd;
}

/** Monday..Sunday of the week containing business day `dayYmd`. Calendar math only (DST-immune). */
export function cashWeekOf(dayYmd: string): { monday: string; sunday: string } {
  const [y, m, d] = dayYmd.split("-").map(Number);
  const dow = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay(); // 0 = Sunday
  const monday = etYmdMinusDays(dayYmd, (dow + 6) % 7);
  return { monday, sunday: etYmdMinusDays(monday, -6) };
}

/**
 * May an actor at `level` file or edit the cash report for `dateYmd` at instant `nowIso`? null = yes;
 * `outside_current_week` = below GM and the date is outside this business week (or not a real date).
 * Pure: lib/cash.ts runs it before any I/O. An unknown level fails closed.
 */
export function cashDateRefusal(level: number, dateYmd: string, nowIso: string): "outside_current_week" | null {
  if (level >= CASH_ANY_DATE_MIN_LEVEL) return null;
  if (!isCalendarYmd(dateYmd)) return "outside_current_week";
  // CC ruling 2026-11-15: "this week" means Monday through TODAY — cash for a day that has not
  // happened yet is never real, so a later day of the same week is refused too.
  const today = cashBusinessDay(nowIso);
  const { monday } = cashWeekOf(today);
  return dateYmd >= monday && dateYmd <= today ? null : "outside_current_week";
}
/** $200 float kept in the register. */
export const DEFAULT_FLOAT_CENTS = 20000;

/**
 * W03/B040: every closing status that closes the cash edit window — the closer's two PIN
 * attestations AND the system's `auto_finalized` (opener release / the 16 h auto-release). The
 * gate used to list only the first two, so a key holder could rewrite a past night's deposit
 * after the system had closed it. ONE list: lib/cash.ts's write gate, the /cash page's up-front
 * lock and migration 0304's in-transaction re-check (pinned equal by tests) all read it.
 */
export const CASH_LOCKING_CLOSING_STATUSES = ["confirmed", "incomplete_confirmed", "auto_finalized"] as const;

/** Does a closing instance in this status lock the day's cash report? (null = no instance.) */
export function closingLocksCash(status: string | null | undefined): boolean {
  return status != null && (CASH_LOCKING_CLOSING_STATUSES as readonly string[]).includes(status);
}

/** US denomination units in cents, largest first (bills then coins). */
export const DENOMINATION_UNITS_CENTS = [10000, 5000, 2000, 1000, 500, 100, 25, 10, 5, 1] as const;

/** unit_cents (as string key) -> quantity. */
export type Denominations = Record<string, number>;
export interface OnShiftEntry { userId: string | null; name: string }

export interface CashTotals { overShortCents: number; depositCents: number }

/**
 * The one money rule. deposit = drawer - float; over/short = deposit - projected
 * (negative = short, positive = over). Pure + total; the server recomputes with
 * this at write time and never trusts client-sent totals.
 */
export function computeCashTotals(input: {
  projectedCents: number;
  drawerTotalCents: number;
  floatCents: number;
}): CashTotals {
  const depositCents = input.drawerTotalCents - input.floatCents; // actual deposit (drawer minus float)
  const overShortCents = depositCents - input.projectedCents;     // over/short = actual - projected
  return { overShortCents, depositCents };
}

/**
 * THE over/short wording (B8 #6): the entry form and the submitted view both read this, so an
 * even night says "Even" on both — never "$0.00 over". `amountCents` is the magnitude.
 */
export function overShortReadout(overShortCents: number): {
  key: "cash.readout.even" | "cash.readout.over" | "cash.readout.short";
  amountCents: number;
} {
  if (overShortCents === 0) return { key: "cash.readout.even", amountCents: 0 };
  return overShortCents > 0
    ? { key: "cash.readout.over", amountCents: overShortCents }
    : { key: "cash.readout.short", amountCents: -overShortCents };
}

/** Sum a denomination map to cents. Ignores non-positive / unknown-unit entries. */
export function sumDenominations(denoms: Denominations): number {
  let total = 0;
  for (const unit of DENOMINATION_UNITS_CENTS) {
    const qty = denoms[String(unit)];
    if (typeof qty === "number" && Number.isFinite(qty) && qty > 0) {
      total += unit * Math.floor(qty);
    }
  }
  return total;
}

/**
 * B3 / issue #59: the live deposit + over/short readout is meaningless until
 * the closer has entered something. With both fields empty it computed
 * "Deposit -$200.00 · $200.00 short" (an empty drawer minus the float).
 * Show it only once the projected field AND a drawer figure (the hand total,
 * or at least one denomination count) have been entered.
 */
export function cashReadoutVisible(input: {
  projected: string;
  mode: "hand" | "denomination";
  handTotal: string;
  denoms: Denominations;
  /**
   * Denomination units (keys of `denoms`) the closer has TYPED into, zeros included.
   * `denoms` itself never stores a zero, so without this a legitimately counted empty
   * drawer ("0" in every field) would look untouched and the readout would never show.
   */
  enteredDenoms?: readonly string[];
}): boolean {
  if (input.projected.trim() === "") return false;
  return drawerFigureEntered(input);
}

/**
 * W03/B007: has the closer entered a drawer figure at all (the hand total, or at least one
 * denomination field — a typed 0 included)? An untouched form used to submit
 * `drawerTotalCents: 0` and file a negative deposit; Submit is now held until this (and the
 * projected figure) are in, and the client tells the server when a zero drawer was COUNTED.
 */
export function drawerFigureEntered(input: {
  mode: "hand" | "denomination";
  handTotal: string;
  denoms: Denominations;
  enteredDenoms?: readonly string[];
}): boolean {
  return input.mode === "hand"
    ? input.handTotal.trim() !== ""
    : sumDenominations(input.denoms) > 0 || (input.enteredDenoms?.length ?? 0) > 0;
}

/**
 * W03/B007 (server): a $0 drawer files only when the client says it was counted empty
 * (`drawerCountedEmpty: true`). Without it, a 0 is an untouched form (or an older client that
 * sent 0 for an empty field), never a count. A non-zero drawer is always a figure someone typed.
 */
export function uncountedDrawer(drawerTotalCents: number, drawerCountedEmpty: unknown): boolean {
  return drawerTotalCents === 0 && drawerCountedEmpty !== true;
}

/**
 * One denomination input event. `denoms` keeps only positive counts (the wire shape the
 * server validates), while `entered` remembers which fields the closer has typed into so a
 * typed 0 counts as an answer and clearing the field makes it untouched again.
 */
export function applyDenominationInput(
  denoms: Denominations,
  entered: readonly string[],
  unitKey: string,
  raw: string,
): { denoms: Denominations; entered: string[] } {
  const trimmed = raw.replace(/-/g, "").trim();
  const nextDenoms = { ...denoms };
  const nextEntered = entered.filter((k) => k !== unitKey);
  if (trimmed === "") {
    delete nextDenoms[unitKey];
  } else {
    nextEntered.push(unitKey);
    const q = Math.max(0, Math.floor(Number(trimmed)));
    if (Number.isFinite(q) && q > 0) nextDenoms[unitKey] = q;
    else delete nextDenoms[unitKey];
  }
  return { denoms: nextDenoms, entered: nextEntered };
}
