import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "../scripts/backfill-toast-labor";

const pull = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast/labor", () => ({ runToastLaborPull: pull }));
beforeEach(() => {
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  pull.mockReset().mockResolvedValue({ ran: true, modified: 0, results: [{ ok: true, rows: 3 }] });
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("runs seven-day chunks sequentially with the backfill heartbeat context", async () => {
  let busy = false;
  pull.mockImplementation(async () => {
    expect(busy).toBe(false); busy = true;
    await Promise.resolve(); busy = false;
    return { ran: true, modified: 1, results: [{ ok: true, rows: 3 }] };
  });
  await main(["--from", "2025-01-01", "--through", "2025-01-09"]);
  expect(pull).toHaveBeenCalledTimes(2);
  expect(pull.mock.calls.map((c) => c[0].length)).toEqual([7, 2]);
  expect(pull.mock.calls[0]![1]).toEqual({ deadlineMs: 300_000, context: "backfill" });
  expect(console.log).toHaveBeenCalledWith(JSON.stringify({ from: "2025-01-01", through: "2025-01-07", rows: 3, modified: 1, failures: [] }));
});
it("TOAST_LABOR_GUARD=1: the per-chunk line carries the result's guard counts under a guard key", async () => {
  const guard = { received: 5, inserted: 2, updated: 1, unchanged: 0, skipped_same_stamp: 0, skipped_older: 1, skipped_no_stamp: 0, duplicates: 1 };
  pull.mockResolvedValue({ ran: true, modified: 2, results: [{ ok: true, rows: 3 }], guard });
  await main(["--from", "2025-01-01", "--through", "2025-01-03"]);
  expect(pull).toHaveBeenCalledTimes(1);
  expect(console.log).toHaveBeenCalledTimes(1);
  expect(vi.mocked(console.log).mock.calls[0]![0]).toBe(
    '{"from":"2025-01-01","through":"2025-01-03","rows":3,"modified":2,"failures":[],"guard":{"received":5,"inserted":2,"updated":1,"unchanged":0,"skipped_same_stamp":0,"skipped_older":1,"skipped_no_stamp":0,"duplicates":1}}');
});
it("a result without guard: the per-chunk line has NO guard key", async () => {
  await main(["--from", "2025-01-01", "--through", "2025-01-03"]);
  expect(console.log).toHaveBeenCalledTimes(1);
  const line = vi.mocked(console.log).mock.calls[0]![0] as string;
  expect(line).toBe('{"from":"2025-01-01","through":"2025-01-03","rows":3,"modified":0,"failures":[]}');
  expect(line).not.toContain("guard");
});
it("refuses disabled runs before the pull and stops after a failed chunk", async () => {
  vi.stubEnv("TOAST_LABOR_PULL", "0");
  await expect(main(["--from", "2025-01-01", "--through", "2025-01-09"])).rejects.toThrow("toast_labor_disabled");
  expect(pull).not.toHaveBeenCalled();
  vi.stubEnv("TOAST_LABOR_PULL", "1");
  pull.mockResolvedValue({ ran: true, modified: 0, results: [{ ok: false, rows: 0, error: "toast_labor_deadline" }] });
  await expect(main(["--from", "2025-01-01", "--through", "2025-01-09"])).rejects.toThrow("toast_labor_backfill_failed");
  expect(pull).toHaveBeenCalledTimes(1);
});
