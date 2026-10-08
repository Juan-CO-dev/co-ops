import "server-only";
import { etCalendarDate, etYmdMinusDays } from "../operational-day";
import { ToastApiError } from "./client";

/** A deadline owns its queue and cancels authentication, response bodies and retry waits. */
export function captureBudget(ms = 60_000, parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("capture_deadline"));
  const timer = setTimeout(abort, ms);
  parent?.addEventListener("abort", abort, { once: true });
  if (parent?.aborted) abort();
  const signal = controller.signal;
  function check() { if (signal.aborted) throw new Error("capture_deadline"); }
  async function wait<T>(work: () => PromiseLike<T>): Promise<T> {
    check();
    let listener: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      listener = () => reject(new Error("capture_deadline"));
      signal.addEventListener("abort", listener, { once: true });
    });
    try { return await Promise.race([Promise.resolve().then(() => { check(); return work(); }), cancelled]); }
    finally { signal.removeEventListener("abort", listener); }
  }
  const sleep = (ms: number) => wait(() => new Promise<void>((resolve) => {
    const done = () => { clearTimeout(t); signal.removeEventListener("abort", done); resolve(); };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  }));
  let queue: Promise<unknown> = Promise.resolve();
  function request<T>(work: () => Promise<T>, backfill = false): Promise<T> {
    const previous = queue;
    const result = wait(() => previous.then(() => retryCaptureRequest(() => wait(work), sleep, backfill)));
    queue = result.catch(() => undefined);
    return result;
  }
  return { signal, check, wait, request, close() { clearTimeout(timer); parent?.removeEventListener("abort", abort); } };
}

export async function retryCaptureRequest<T>(
  request: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  backfill = false,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await sleep(250);
    try { return await request(); }
    catch (error) {
      if (!(error instanceof ToastApiError) || error.status !== 429 || attempt >= (backfill ? 5 : 1)) throw error;
      const delay = Math.max(1000 * 2 ** attempt, error.retryAfterMs ?? 0);
      if (delay > (backfill ? 60_000 : 5_000)) throw error;
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
    try { await port.fail(code); } catch { /* Preserve the original safe reason if the manifest is unavailable. */ }
    throw new Error(code);
  }
}

/** Never persist provider/DB messages: they can contain payload values. */
export function captureErrorCode(error: unknown): string {
  if (error instanceof ToastApiError) return `toast_http_${error.status}`;
  if (error instanceof Error && /^(?:capture_[a-z_]+|toast_capture_[a-z_]+|toast_http_[0-9]{3})$/.test(error.message)) return error.message;
  return "capture_failed";
}

export function backfillDates(from?: string, through = etYmdMinusDays(etCalendarDate(new Date().toISOString()), 1)): string[] {
  if (from === undefined) {
    const end = new Date(`${through}T00:00:00Z`);
    const year = end.getUTCFullYear() - 1;
    const month = end.getUTCMonth();
    const day = Math.min(end.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
    from = new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
  }
  for (const value of [from, through]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("capture_invalid_date");
  }
  const days = Math.round((Date.parse(through) - Date.parse(from)) / 86400000);
  if (days < 0 || days > 366) throw new Error("capture_invalid_range");
  return Array.from({ length: days + 1 }, (_, i) => new Date(Date.parse(through) - i * 86400000).toISOString().slice(0, 10));
}
