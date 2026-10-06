/**
 * Lost orders on the insights calendar — the PURE half (client-safe, zero I/O).
 *
 * Wave 1 branch C (Juan, 2026-10-06: "in the catering insights calendar we should mark the
 * lost orders"). Lost leads are DISPLAY ONLY: they ride beside the RPC's booked calendar as a
 * separate list and never enter a money total, a count or any insights v2 window figure
 * (0194/0195 money split). The RPC stays exactly as it was.
 */
import type { CalendarEvent } from "@/lib/catering/insights-shared";

/** A lead in stage `lost` that has an event date (so it can be plotted). */
export type LostCalendarEvent = Omit<CalendarEvent, "stage"> & { stage: "lost" };

/** The device's remembered "Show lost" choice. Default ON. */
export const SHOW_LOST_STORAGE_KEY = "co.catering.insights.showLost";

/** Read the saved choice. Storage may be absent, blocked or throwing: every path falls back to ON. */
export function readShowLost(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const st = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
    if (!st) return true;
    return st.getItem(SHOW_LOST_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Save the choice; never throws (blocked storage just means the device forgets). */
export function writeShowLost(value: boolean, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const st = storage === undefined ? (typeof window === "undefined" ? null : window.localStorage) : storage;
    if (!st) return;
    st.setItem(SHOW_LOST_STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* blocked storage: the toggle still works for this session */
  }
}

/** Everything the calendar plots: booked always, lost only while "Show lost" is on. */
export function calendarEventsToPlot(
  booked: CalendarEvent[],
  lost: LostCalendarEvent[],
  showLost: boolean,
): Array<CalendarEvent | LostCalendarEvent> {
  return showLost ? [...booked, ...lost] : booked;
}
