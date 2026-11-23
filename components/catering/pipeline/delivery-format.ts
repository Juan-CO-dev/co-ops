/**
 * Catering delivery D2: one way to show an instant on the delivery screens, in ET, through lib/i18n/format.
 * Client-safe, no clock.
 */
import { formatDateLabel, formatTime } from "@/lib/i18n/format";
import type { Language } from "@/lib/i18n/types";
import { etDisplayDate } from "@/lib/operational-day";

/** "Tue, Nov 24 10:40 AM" in ET. */
export function deliveryWhen(iso: string, language: Language): string {
  return `${formatDateLabel(etDisplayDate(iso), language)} ${formatTime(iso, language)}`;
}
