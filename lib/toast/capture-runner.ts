import "server-only";
import { ToastApiError } from "./client";

/** Shared request queue: one process stays below ordersBulk's ~5 requests/sec. */
let queue: Promise<unknown> = Promise.resolve();
export async function captureRequest<T>(request: () => Promise<T>): Promise<T> {
  const result = queue.then(() => retryCaptureRequest(request));
  queue = result.catch(() => undefined);
  return result;
}

export async function retryCaptureRequest<T>(
  request: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await sleep(250);
    try { return await request(); }
    catch (error) {
      if (!(error instanceof ToastApiError) || error.status !== 429 || attempt >= 5) throw error;
      const delay = Math.max(1000 * 2 ** attempt, error.retryAfterMs ?? 0);
      // A very long server cooldown belongs to a later run, never retry sooner than requested.
      if (delay > 60_000) throw error;
      await sleep(delay);
    }
  }
}

export interface CaptureRunPort {
  page(page: number): Promise<unknown>;
  save(page: number, orders: unknown[]): Promise<void>;
  complete(pages: number): Promise<void>;
  fail(code: string): Promise<void>;
}

/** Restart an unfinished date at page one: upstream offset pages are not stable checkpoints. */
export async function runCapturePages(port: CaptureRunPort): Promise<{ pages: number; orders: number }> {
  let orders = 0;
  try {
    for (let page = 1; page <= 500; page++) {
      const raw = await port.page(page);
      if (!Array.isArray(raw) || raw.length > 100) throw new Error("capture_bad_page");
      await port.save(page, raw);
      orders += raw.length;
      if (raw.length < 100) {
        await port.complete(page);
        return { pages: page, orders };
      }
    }
    throw new Error("capture_page_limit");
  } catch (error) {
    const code = captureErrorCode(error);
    await port.fail(code);
    throw new Error(code);
  }
}

/** Never persist provider/DB messages: they can contain payload values. */
export function captureErrorCode(error: unknown): string {
  if (error instanceof ToastApiError) return `toast_http_${error.status}`;
  if (error instanceof Error && /^capture_[a-z_]+$/.test(error.message)) return error.message;
  return "capture_failed";
}

export function backfillDates(from = "2025-07-23", through = "2026-07-22"): string[] {
  for (const value of [from, through]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("capture_invalid_date");
  }
  const days = Math.round((Date.parse(through) - Date.parse(from)) / 86400000);
  if (days < 0 || days > 366) throw new Error("capture_invalid_range");
  return Array.from({ length: days + 1 }, (_, i) => new Date(Date.parse(through) - i * 86400000).toISOString().slice(0, 10));
}
