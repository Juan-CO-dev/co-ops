import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { main } from "../scripts/backfill-toast-orders";
import { captureToastDaySystem, probeToastDate, captureEnabled } from "@/lib/toast/capture";
import { getServiceRoleClient } from "@/lib/supabase-server";

vi.mock("@/lib/toast/capture", () => ({ captureToastDaySystem: vi.fn(), probeToastDate: vi.fn(), captureEnabled: vi.fn(() => true) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.mocked(captureEnabled).mockReturnValue(true);
  vi.mocked(probeToastDate).mockResolvedValue({ pages: 1, orders: 1 });
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "run", pages: 1, orders: 1, skipped: false });
  const query = { select: () => query, eq: () => query, not: () => query, order: () => query,
    returns: async () => ({ data: [{ id: "shop" }], error: null }) };
  vi.mocked(getServiceRoleClient).mockReturnValue({ from: () => query } as unknown as ReturnType<typeof getServiceRoleClient>);
});
afterEach(() => vi.restoreAllMocks());

it("honors explicit windows newest-first and opts only backfill into longer retries", async () => {
  await main(["backfill", "--from", "2026-10-04", "--through", "2026-10-06", "--retry-completed"]);
  expect(probeToastDate).toHaveBeenCalledWith("shop");
  expect(vi.mocked(captureToastDaySystem).mock.calls).toEqual([
    ["shop", "2026-10-06", { resume: false, backfill: true }],
    ["shop", "2026-10-05", { resume: false, backfill: true }],
    ["shop", "2026-10-04", { resume: false, backfill: true }],
  ]);
});

it.each([["backfill", "--from"], ["backfill", "--through", "2026-02-30"], ["probe", "--through", "2026-10-06"]])("refuses invalid flags/dates before I/O: %j", async (...args) => {
  await expect(main(args)).rejects.toThrow();
  expect(getServiceRoleClient).not.toHaveBeenCalled();
});

it("stops on a skipped missing-schema date instead of reporting backfill completion", async () => {
  vi.mocked(captureToastDaySystem).mockResolvedValue({ runId: "", pages: 0, orders: 0, skipped: true, reason: "capture_schema_missing" });
  await expect(main(["backfill", "--from", "2026-10-04", "--through", "2026-10-06"])).rejects.toThrow("capture_schema_missing");
  expect(captureToastDaySystem).toHaveBeenCalledTimes(1);
});
