import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { captureModified } from "@/lib/toast/capture-modified";
import { modifiedRequestDates, modifiedRouteBudget, modifiedWindow, normalizeModifiedOrder } from "@/lib/toast/capture-modified-shared";
import { captureEnabled } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet } from "@/lib/toast/client";

vi.mock("@/lib/toast/capture", () => ({ captureEnabled: vi.fn(() => true) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/toast/client", async (original) => ({ ...await original<typeof import("@/lib/toast/client")>(), toastGet: vi.fn() }));
const start = "2026-10-08T10:00:00.000Z";
const end = "2026-10-08T11:00:00.000Z";
const cursor = { coverage_start: start, watermark: null, pending_start: start, pending_end: end };
const window = { start, end };
const raw = (guid = "old-order") => ({ guid, businessDate: 20260102, modifiedDate: start,
  customer: { email: "synthetic-private" }, checks: [{ guid: "check", payments: [{ guid: "payment", amount: 20,
    refund: { refundAmount: 5, refundBusinessDate: 20261008 } }] }] });
let rpc: ReturnType<typeof vi.fn>;
let dispatch: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
let completed: boolean;
let shops: { id: string; toast_restaurant_guid: string }[];
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  completed = false;
  shops = [{ id: "shop", toast_restaurant_guid: "restaurant" }];
  vi.mocked(captureEnabled).mockReturnValue(true);
  vi.mocked(toastGet).mockResolvedValue([raw()]);
  dispatch = async (name) => {
    if (name === "toast_modified_begin") return { data: completed ? { ...cursor, pending_start: null, pending_end: null } : cursor, error: null };
    if (name === "toast_modified_complete") { completed = true; return { data: true, error: null }; }
    return { data: 1, error: null };
  };
  rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: (signal: AbortSignal) => {
    expect(signal).toBeInstanceOf(AbortSignal);
    return dispatch(name, args);
  } }));
  const query = { select: () => query, eq: () => query, not: () => query, order: () => query,
    abortSignal: async () => ({ data: shops, error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query, rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.useRealTimers());
async function run() { const pending = captureModified(); await vi.runAllTimersAsync(); return pending; }

it("finds an old-order refund with modified bounds, preserves sale/refund dates and strips PII", async () => {
  expect(await run()).toMatchObject({ failures: 0, results: [{ windows: 1, changed: 1 }] });
  const path = vi.mocked(toastGet).mock.calls[0]![0];
  const params = new URL(path, "https://example.test").searchParams;
  expect(params.get("startDate")).toBe("2026-10-08T10:00:00.000+0000"); expect(params.get("endDate")).toBe("2026-10-08T11:00:00.000+0000");
  expect(params.has("businessDate")).toBe(false);
  const saved = rpc.mock.calls.find((c) => c[0] === "toast_modified_save")![1];
  expect(saved).toMatchObject({ p_location_id: "shop", p_orders: [{ order: { business_date: "2026-01-02" },
    payments: [{ refund_amount_cents: 500, refund_business_date: "2026-10-08" }], content_hash: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
  expect(JSON.stringify(saved)).not.toContain("synthetic-private");
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["toast_modified_begin", "toast_modified_save", "toast_modified_complete", "toast_modified_begin"]);
});
it("failed save retains window and retry starts page one; advances only after successful saves", async () => {
  const normal = dispatch;
  dispatch = async (name, args) => name === "toast_modified_save" ? { data: null, error: { code: "P0001", message: "private" } } : normal(name, args);
  expect(await run()).toMatchObject({ failures: 1, results: [{ error: "capture_modified_db_failed" }] });
  expect(completed).toBe(false);
  dispatch = normal;
  expect(await run()).toMatchObject({ failures: 0 });
  expect(vi.mocked(toastGet).mock.calls.map((c) => new URL(c[0], "https://example.test").searchParams.get("page"))).toEqual(["1", "1"]);
});
it("unchanged overlap yields no new capture and still completes", async () => {
  const normal = dispatch;
  dispatch = async (name, args) => name === "toast_modified_save" ? { data: 0, error: null } : normal(name, args);
  expect(await run()).toMatchObject({ failures: 0, results: [{ windows: 1, changed: 0 }] });
});
it("refuses stale cursor completion rather than claiming successful coverage", async () => {
  const normal = dispatch;
  dispatch = async (name, args) => name === "toast_modified_complete" ? { data: false, error: null } : normal(name, args);
  expect(await run()).toMatchObject({ failures: 1, results: [{ windows: 0, error: "capture_modified_cursor_conflict" }] });
});
it("batches at 20 and requires the terminal short page", async () => {
  vi.mocked(toastGet).mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => raw(`order-${i}`))).mockResolvedValueOnce([]);
  expect(await run()).toMatchObject({ failures: 0, results: [{ pages: 2, windows: 1 }] });
  const saves = rpc.mock.calls.filter((c) => c[0] === "toast_modified_save");
  expect(saves).toHaveLength(5);
  expect(saves.every((c) => (c[1].p_orders as unknown[]).length === 20)).toBe(true);
});
it("duplicate order GUIDs across pages fail without advancing", async () => {
  vi.mocked(toastGet).mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => raw(`order-${i}`))).mockResolvedValueOnce([raw("order-0")]);
  expect(await run()).toMatchObject({ failures: 1, results: [{ error: "capture_modified_duplicate_order" }] });
  expect(completed).toBe(false);
});
it("page cap cannot advertise incomplete coverage", async () => {
  vi.mocked(toastGet).mockImplementation(async (path) => {
    const page = new URL(path, "https://example.test").searchParams.get("page");
    return Array.from({ length: 100 }, (_, i) => raw(`${page}-${i}`));
  });
  expect(await run()).toMatchObject({ failures: 1, results: [{ pages: 10, windows: 0, error: "capture_modified_page_limit" }] });
  expect(completed).toBe(false);
});
it("caps windows per invocation", async () => {
  dispatch = async (name) => ({ data: name === "toast_modified_begin" ? cursor : name === "toast_modified_complete" ? true : 0, error: null });
  vi.mocked(toastGet).mockResolvedValue([]);
  expect(await run()).toMatchObject({ failures: 0, results: [{ windows: 4 }] });
  expect(toastGet).toHaveBeenCalledTimes(4);
});
it("a hung DB request is aborted in six seconds and cannot advance", async () => {
  dispatch = () => new Promise(() => {});
  const pending = captureModified();
  await vi.advanceTimersByTimeAsync(6_000);
  expect(await pending).toMatchObject({ failures: 1, results: [{ error: "capture_deadline" }] });
  expect(toastGet).not.toHaveBeenCalled();
});
it("bounds abort-ignoring provider and reserves the second shop's share", async () => {
  shops.push({ id: "second", toast_restaurant_guid: "restaurant-2" });
  vi.mocked(toastGet).mockImplementation(async (_path, restaurant) => restaurant === "restaurant" ? new Promise(() => {}) : []);
  const pending = captureModified();
  await vi.advanceTimersByTimeAsync(10_500);
  expect(await pending).toMatchObject({ failures: 1, results: [{ locationId: "shop", error: "capture_deadline" }, { locationId: "second", windows: 1, error: null }] });
});
it("parent cancellation stops all further work", async () => {
  const controller = new AbortController();
  vi.mocked(toastGet).mockImplementation(() => new Promise(() => {}));
  const pending = captureModified(controller.signal);
  await vi.advanceTimersByTimeAsync(300);
  controller.abort();
  expect(await pending).toMatchObject({ failures: 1 });
  expect(rpc.mock.calls.map((c) => c[0])).toEqual(["toast_modified_begin"]);
});
it("disabled and exhausted invocations perform no I/O", async () => {
  expect(await captureModified(undefined, 0)).toMatchObject({ skipped: true });
  vi.mocked(captureEnabled).mockReturnValue(false);
  expect(await captureModified()).toMatchObject({ skipped: true });
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});
it("missing schema and provider errors are safe and fail soft", async () => {
  dispatch = async () => ({ data: null, error: { code: "PGRST202", message: "private" } });
  expect(await run()).toMatchObject({ failures: 1, results: [{ error: "capture_schema_missing" }] });
});
it("validates fixed windows and normalizes boundary timestamps", () => {
  expect(modifiedWindow(cursor)).toEqual(window);
  expect(modifiedWindow({ ...cursor, pending_start: "2026-10-08T10:00:00.123456+00:00" })?.start)
    .toBe("2026-10-08T10:00:00.123456+00:00");
  expect(modifiedWindow({ ...cursor, pending_start: null, pending_end: null })).toBeNull();
  expect(() => modifiedWindow({ ...cursor, pending_end: "2026-10-08T11:00:01Z" })).toThrow();
  expect(() => modifiedWindow({ ...cursor, pending_start: "bad" })).toThrow();
  expect(normalizeModifiedOrder(raw(), window)?.order.modified_at).toBe(start);
  expect(normalizeModifiedOrder({ ...raw(), modifiedDate: end }, window)).toBeNull();
});
it("completes a microsecond-ended window containing an order in its final millisecond", async () => {
  const preciseEnd = "2026-10-08T11:00:00.123456+00:00";
  const preciseStart = "2026-10-08T10:00:00.123456+00:00";
  const normal = dispatch;
  dispatch = async (name, args) => name === "toast_modified_begin" && !completed
    ? { data: { ...cursor, pending_start: preciseStart, pending_end: preciseEnd }, error: null }
    : normal(name, args);
  vi.mocked(toastGet).mockResolvedValue([{ ...raw(), modifiedDate: "2026-10-08T11:00:00.123Z" }]);
  expect(await run()).toMatchObject({ failures: 0, results: [{ windows: 1, changed: 1 }] });
  expect(completed).toBe(true);
  expect(rpc.mock.calls.find((c) => c[0] === "toast_modified_complete")?.[1])
    .toMatchObject({ p_start: preciseStart, p_end: preciseEnd });
});
it.each([
  ["2026-10-08T11:00:00.123Z", true],
  ["2026-10-08T07:00:00.123-0400", true],
  ["2026-10-08T11:00:00.124Z", false],
  ["2026-10-08T10:00:00.123Z", false],
  ["2026-10-08T10:00:00.124Z", true],
])("compares %s against microsecond bounds (accepted: %s)", (modifiedDate, accepted) => {
  const precise = { start: "2026-10-08T10:00:00.123456Z", end: "2026-10-08T11:00:00.123456Z" };
  const normalize = () => normalizeModifiedOrder({ ...raw(), modifiedDate }, precise);
  if (accepted) expect(normalize()).not.toBeNull();
  else expect(normalize()).toBeNull();
});
it("validates cursor ordering and the hour limit without dropping microseconds", () => {
  const preciseStart = "2026-10-08T10:00:00.123456Z";
  expect(modifiedWindow({ ...cursor, coverage_start: preciseStart, pending_start: preciseStart,
    pending_end: "2026-10-08T10:00:00.123457Z" })).not.toBeNull();
  for (const overrides of [
    { coverage_start: "2026-10-08T10:00:00.123457Z" },
    { pending_end: preciseStart },
    { pending_end: "2026-10-08T10:00:00.123455Z" },
    { pending_end: "2026-10-08T11:00:00.123457Z" },
  ]) {
    expect(() => modifiedWindow({ ...cursor, pending_start: preciseStart, ...overrides }))
      .toThrow("capture_modified_bad_cursor");
  }
});
it.each([[0, true, 20_000], [70_000, true, 10_000], [80_000, true, 0], [100_000, false, 10_000], [111_000, false, 0]])(
  "respects route/labor reserves at %ims", (elapsed, labor, expected) => {
    expect(modifiedRouteBudget(1_000, 1_000 + (elapsed as number), labor as boolean)).toBe(expected);
  });

it.each([
  ["2026-10-08T10:00:12.51345+00:00", "2026-10-08T10:00:12.513+0000", "2026-10-08T10:00:12.514+0000"],
  ["2026-10-08T10:00:12.513000+00:00", "2026-10-08T10:00:12.513+0000", "2026-10-08T10:00:12.513+0000"],
  ["2026-10-08T23:59:59.999999+00:00", "2026-10-08T23:59:59.999+0000", "2026-10-09T00:00:00.000+0000"],
  ["2026-10-08T06:00:12.513001-04:00", "2026-10-08T10:00:12.513+0000", "2026-10-08T10:00:12.514+0000"],
])("rounds HTTP bounds outward for %s", (instant, floor, ceil) => {
  const dates = modifiedRequestDates({ start: instant, end: instant });
  expect(decodeURIComponent(dates.startDate)).toBe(floor);
  expect(decodeURIComponent(dates.endDate)).toBe(ceil);
});
it("skips both widened edges, pages by raw length, and completes with exact CAS strings", async () => {
  const precise = { start: "2026-10-08T10:00:12.51345+00:00", end: "2026-10-08T11:00:12.51345+00:00" };
  const normal = dispatch;
  dispatch = async (name, args) => name === "toast_modified_begin" && !completed
    ? { data: { ...cursor, pending_start: precise.start, pending_end: precise.end }, error: null }
    : normal(name, args);
  vi.mocked(toastGet).mockResolvedValueOnce(Array.from({ length: 100 }, () => ({ ...raw(), modifiedDate: "2026-10-08T10:00:12.513+0000" })))
    .mockResolvedValueOnce([{ ...raw(), modifiedDate: precise.end }, { ...raw(), modifiedDate: "2026-10-08T11:00:12.514+0000" },
      { ...raw(), modifiedDate: precise.start }]);
  expect(await run()).toMatchObject({ failures: 0, results: [{ windows: 1, pages: 2, changed: 1 }] });
  const params = new URL(vi.mocked(toastGet).mock.calls[0]![0], "https://example.test").searchParams;
  expect(params.get("startDate")).toBe("2026-10-08T10:00:12.513+0000");
  expect(params.get("endDate")).toBe("2026-10-08T11:00:12.514+0000");
  expect(rpc.mock.calls.filter(c => c[0] === "toast_modified_save")).toHaveLength(1);
  expect(rpc).toHaveBeenCalledWith("toast_modified_complete", { p_location_id: "shop", p_start: precise.start, p_end: precise.end });
});
it.each([null, "", "bad", "2026-10-08T10:00:00", "2026-13-08T10:00:00Z"])("malformed modifiedDate %s fails without advancing", async (modifiedDate) => {
  vi.mocked(toastGet).mockResolvedValue([{ ...raw(), modifiedDate }]);
  expect(await run()).toMatchObject({ failures: 1, results: [{ error: "capture_modified_bad_date" }] });
  expect(completed).toBe(false);
});
