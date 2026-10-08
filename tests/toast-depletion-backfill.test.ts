import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "../scripts/backfill-toast-depletion";

const mocks = vi.hoisted(() => ({ materialize: vi.fn(), audit: vi.fn(), select: vi.fn() }));
vi.mock("../lib/supabase-server", () => ({ getServiceRoleClient: () => ({}) }));
vi.mock("../lib/supabase-paginate", () => ({ selectAllRows: mocks.select }));
vi.mock("../lib/catering/toast-sales", () => ({ materializeCapturedDepletion: mocks.materialize }));
vi.mock("../lib/audit", () => ({ audit: mocks.audit }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.select.mockResolvedValue([
    { id: "one", location_id: "shop", business_date: "2026-10-05" },
    { id: "two", location_id: "shop", business_date: "2026-10-06" },
    { id: "retry", location_id: "shop", business_date: "2026-10-06" },
  ]);
  mocks.materialize.mockResolvedValue({ rows: 2, runId: "run", status: "success", reason: null });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

it("accepts named bounds, deduplicates days and summarizes degraded publications without failing", async () => {
  mocks.materialize.mockResolvedValueOnce({ rows: 1, runId: "run", status: "degraded", reason: "unreviewed" });
  await expect(main(["--from", "2026-07-23", "--through", "2026-10-06"])).resolves.toBeUndefined();
  expect(mocks.materialize).toHaveBeenCalledTimes(2);
  expect(mocks.materialize).toHaveBeenCalledWith("shop", "2026-10-05", { audit: false });
  expect(mocks.audit).toHaveBeenCalledTimes(1);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
    action: "toast_depletion.materialize", metadata: expect.objectContaining({
      from: "2026-07-23", through: "2026-10-06", days: 2, successful: 1, degraded: 1, failed: 0, rows: 3,
    }),
  }));
});

it("continues after a failed day and audits the summary before returning failure", async () => {
  mocks.materialize.mockRejectedValueOnce(new Error("failed"));
  await expect(main(["2026-07-23", "2026-10-06"])).rejects.toThrow("depletion_backfill_failed_days:1");
  expect(mocks.materialize).toHaveBeenCalledTimes(2);
  expect(mocks.audit).toHaveBeenCalledTimes(1);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ failed: 1, successful: 1 }) }));
});

it.each([
  ["--from", "2026-07-23"], ["--through", "2026-10-06"],
  ["--from", "2026-02-30", "--through", "2026-10-06"],
  ["--from", "2026-07-23", "--from", "2026-07-23", "--through", "2026-10-06"],
  ["--from", "2026-10-07", "--through", "2026-10-06"],
])("rejects invalid arguments before loading database rows: %j", async (...args) => {
  await expect(main(args)).rejects.toThrow("depletion_backfill_invalid_window");
  expect(mocks.select).not.toHaveBeenCalled();
});

it("refuses the open ET day", async () => {
  await expect(main(["--from", "2026-07-23", "--through", "2026-10-08"])).rejects.toThrow("depletion_backfill_open_day");
  expect(mocks.select).not.toHaveBeenCalled();
});
