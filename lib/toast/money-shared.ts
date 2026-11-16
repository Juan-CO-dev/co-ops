/** Toast money parsers. Pure, zero I/O. `captureCents` is the strict capture parser (moved here
 * unchanged from capture-shared.ts, which re-exports it); `lineCents` is the lenient twin used
 * ONLY for selection prices when TOAST_LINE_PRICES is on (item 1 PR B, plan r3 §3.2). */
export function captureCents(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === "number" ? x : typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : NaN;
  const cents = Math.round((n + Math.sign(n) * Number.EPSILON) * 100);
  if (!Number.isSafeInteger(cents)) throw new Error("toast_capture_invalid_money");
  return cents;
}

/** Same rounding as captureCents for every value it accepts; null (never a throw) for the rest. */
export function lineCents(x: unknown): number | null {
  try { return captureCents(x); } catch { return null; }
}
