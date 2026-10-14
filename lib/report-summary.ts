import type { ReportListItem, ReportTypeKey } from "@/lib/reports-hub";

export type LastCloseState = "done" | "auto_closed" | "not_finalized" | "missing";
export const LAST_CLOSE_TYPES: ReportTypeKey[] = ["opening", "am_prep", "mid_day", "closing", "cash", "pm"];
// phase2_complete is final: opening Phase 3 is unwired (only six confirmed,
// last 2026-05-09); finalizeMidDayPhase2 writes it too. CC ruling 2026-10-07.
export function reportIsFinalized(item: Pick<ReportListItem, "status" | "type">): boolean {
  return item.type === "maintenance" || ["confirmed", "phase2_complete", "submitted", "completed", "incomplete_confirmed", "auto_finalized", "ok", "flags"].includes(item.status);
}

/** How far back the Reports Hub looks for the last close (today plus the six days before it). */
export const LAST_CLOSE_LOOKBACK_DAYS = 7;

/**
 * D-62 (Juan 2026-10-13) — the shop card's "Last close" is the MOST RECENT CLOSED DAY, not a fixed
 * "yesterday": the day of the newest finalized CLOSING in the window (today, once tonight's closing is
 * confirmed). It used to read "Last close · Mon, Oct 12 · No activity recorded" right after today's
 * closing was confirmed. "Finalized" is the hub's own `reportIsFinalized`, so a closing the system
 * auto-closed still marks its day closed (the card then says "auto closed" on it, which is the honest
 * report). No closed day in the window → the caller's fallback (yesterday), as before.
 */
export function lastCloseDate(items: ReadonlyArray<Pick<ReportListItem, "type" | "status" | "date">>, fallback: string): string {
  let best: string | null = null;
  for (const item of items) {
    if (item.type !== "closing" || !reportIsFinalized(item)) continue;
    if (best === null || item.date > best) best = item.date;
  }
  return best ?? fallback;
}

/** Empty shops have no activity, never six claims that work was missed. */
export function composeLastClose(items: ReportListItem[], level: number) {
  return {
    noActivity: items.length === 0,
    ownScope: level < 4,
    submissions: items,
    reports: LAST_CLOSE_TYPES.filter((type) => type !== "cash" || level >= 4).map((type) => {
      const candidates = items.filter((item) => item.type === type);
      const item = candidates.find((candidate) => candidate.status !== "auto_finalized" && reportIsFinalized(candidate))
        ?? candidates.find(reportIsFinalized) ?? candidates[0];
      const state: LastCloseState = !item ? "missing" : item.status === "auto_finalized" ? "auto_closed" : reportIsFinalized(item) ? "done" : "not_finalized";
      return { type, state, item };
    }),
  };
}

export function composeReportSummary(items: ReportListItem[]) {
  const signals = { underPar: 0, overPar: 0, skipped: 0, notStarted: 0, tempFlags: 0, cashOverShortCents: null };
  let cashOver = 0;
  let cashShort = 0;
  for (const item of items) {
    const s = item.signalSummary;
    if (!s) continue;
    signals.underPar += s.underPar;
    signals.overPar += s.overPar;
    signals.skipped += s.skipped;
    signals.notStarted += s.notStarted ?? 0;
    signals.tempFlags += s.tempFlags;
    if ((s.cashOverShortCents ?? 0) > 0) cashOver++;
    if ((s.cashOverShortCents ?? 0) < 0) cashShort++;
  }
  return { total: items.length, finalized: items.filter(reportIsFinalized).length, autoClosed: items.filter((item) => item.status === "auto_finalized").length, signals, cashOver, cashShort };
}
