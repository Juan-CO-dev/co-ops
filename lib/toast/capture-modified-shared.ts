import { captureBusinessDate, normalizeToastOrder } from "./capture-shared";

export const MODIFIED_MAX_WINDOWS = 4;
export const MODIFIED_MAX_PAGES = 10;
export const MODIFIED_BATCH_SIZE = 20;
export const MODIFIED_DB_TIMEOUT_MS = 6_000;

export interface ModifiedWindow { start: string; end: string }

/** Date.parse handles offsets but drops sub-millisecond digits from DB cursors. */
function microseconds(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})$/.exec(value);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) return null;
  const remainder = (match[1] ?? "").padEnd(6, "0").slice(3);
  return BigInt(milliseconds) * BigInt(1_000) + BigInt(remainder);
}

/** The database owns fixed retry windows; refuse malformed cursor responses. */
export function modifiedWindow(input: unknown): ModifiedWindow | null {
  if (!input || typeof input !== "object") throw new Error("capture_modified_bad_cursor");
  const row = input as Record<string, unknown>;
  if (row.pending_start === null && row.pending_end === null) return null;
  const { pending_start: start, pending_end: end, coverage_start: coverageStart } = row;
  const startUs = microseconds(start), endUs = microseconds(end), coverageUs = microseconds(coverageStart);
  if (typeof start !== "string" || typeof end !== "string" || typeof coverageStart !== "string"
    || startUs === null || endUs === null || coverageUs === null || startUs < coverageUs
    || endUs <= startUs || endUs - startUs > BigInt(3_600_000_000)) {
    throw new Error("capture_modified_bad_cursor");
  }
  // Preserve PostgreSQL microseconds: completion compares these exact instants.
  return { start, end };
}

/** Preserve the original business date, even for a refund months after sale. */
export function normalizeModifiedOrder(raw: unknown, window: ModifiedWindow) {
  const date = captureBusinessDate(raw && typeof raw === "object" ? (raw as Record<string, unknown>).businessDate : null);
  if (!date) throw new Error("capture_modified_bad_date");
  const order = normalizeToastOrder(raw, date);
  const modified = microseconds(order.order.modified_at);
  const start = microseconds(window.start), end = microseconds(window.end);
  if (modified === null || start === null || end === null || modified < start || modified >= end) {
    throw new Error("capture_modified_outside_window");
  }
  order.payments.sort((a, b) => a.payment_guid < b.payment_guid ? -1 : a.payment_guid > b.payment_guid ? 1 : 0);
  return order;
}

export function modifiedRouteBudget(startedAt: number, now: number, laborEnabled: boolean): number {
  const remaining = Math.max(0, 120_000 - (now - startedAt) - 10_000);
  return Math.min(20_000, Math.max(0, remaining - (laborEnabled ? 30_000 : 0)));
}
