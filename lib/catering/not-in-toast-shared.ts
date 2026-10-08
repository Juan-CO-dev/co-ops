/** Read-only ezCater logistics; never contains customer contacts or provider payloads. */
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
