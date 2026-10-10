import { afterEach, expect, it, vi } from "vitest";
import { claimCronRoute } from "@/lib/cron-route-lease";
import { getServiceRoleClient } from "@/lib/supabase-server";
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
afterEach(() => vi.clearAllMocks());

it.each([true, false])("returns the database claim result %s", async (data) => {
  const abortSignal = vi.fn(async () => ({ data, error: null }));
  const rpc = vi.fn(() => ({ abortSignal }));
  vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>);
  expect(await claimCronRoute("toast-sales-today")).toBe(data);
  expect(rpc).toHaveBeenCalledWith("claim_cron_route", { p_job: "toast-sales-today" });
  expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});
it.each([{ data: true, error: { message: "unavailable" } }, { data: null, error: null }, { data: "true", error: null }])(
  "refuses failed or malformed claims %j", async (result) => {
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc: () => ({ abortSignal: async () => result }) } as unknown as ReturnType<typeof getServiceRoleClient>);
    await expect(claimCronRoute("toast-catering-scan")).rejects.toThrow("cron_route_claim_failed");
  });
