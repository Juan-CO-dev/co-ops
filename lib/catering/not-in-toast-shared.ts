/** Read-only ezCater logistics — and, since item 21 PR 2, house (non-ezCater) catering leads of a shop whose
 * cross-check is enabled (`source: "house"`; order_id = the lead id, order_number = its ring code). Never contains
 * customer contacts or provider payloads. */
import { addDays, etClock, etWallTime } from "@/lib/report-digests-shared";

export interface NotInToastOrder {
  order_id: string;
  lead_id: string | null;
  location_id: string;
  event_date: string;
  order_number: string | null;
  handoff_time: string | null;
  event_timestamp: string | null;
  headcount: number | null;
  total_cents: number | null;
  /** Absent = ezCater (the original rows). */
  source?: "ezcater" | "house";
}

export type NotRungSource = "ezcater" | "house";
export const notRungSource = (order: Pick<NotInToastOrder, "source">): NotRungSource => (order.source === "house" ? "house" : "ezcater");

/** THE label of a not-rung row, for every consumer of readNotInToast (review r2 P2): it names the SOURCE — a house
 * lead is never called ezCater — and the code, or that there is none yet. Returns an i18n key + params so a client
 * (`t`) and a server (`serverT`) render the same words in en + es. */
export function notRungLabel(source: NotRungSource, code: string | null | undefined): { key: `catering.not_rung.label.${string}`; params: Record<string, string> } {
  return code ? { key: `catering.not_rung.label.${source}`, params: { code } } : { key: `catering.not_rung.label.${source}_no_code`, params: {} };
}

/** Handoff/ready time wins over delivery-by. Invalid/missing times never mean midnight. */
export function toastReadyAt(order: NotInToastOrder): string | null {
  for (const value of [order.handoff_time, order.event_timestamp]) {
    if (value && /T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) && Number.isFinite(Date.parse(value))) return value;
  }
  return null;
}

export type ToastRingTiming = "upcoming" | "due" | "overdue" | "opening_unknown";

/** Opening is supplied by the shop schedule, never inferred from pickup or a cron hour.
 * Missing ready time expires at the NEXT ET midnight (including 23/25-hour DST days). */
export function toastRingTiming(order: NotInToastOrder, now: Date, openingMinutes: number | null): ToastRingTiming {
  const today = etClock(now).day;
  if (order.event_date > today) return "upcoming";
  if (order.event_date < today) return "overdue";
  const ready = toastReadyAt(order);
  const deadline = ready ? Date.parse(ready) : etWallTime(addDays(order.event_date, 1), 0).getTime();
  if (now.getTime() > deadline) return "overdue";
  if (openingMinutes === null) return "opening_unknown";
  return now >= etWallTime(order.event_date, openingMinutes) ? "due" : "upcoming";
}
