import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReceipt } from "@/lib/receipt-parse";
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: vi.fn() }));
function service(state: string, count: number): SupabaseClient {
  const q = {
    select: () => q, eq: () => q, update: () => q,
    maybeSingle: async () => ({ error: null, data: { id: "receipt", parse_state: state, raw_storage_path: null, attachment_paths: [] } }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, count }).then(resolve),
  };
  return { from: () => q } as unknown as SupabaseClient;
}
describe("manual receipt parsing mutation audit", () => {
  it("reports a durable failed parse as a mutation", async () => {
    const onWritten = vi.fn(async () => {});
    await expect(parseReceipt(service("unparsed", 1), "receipt", onWritten)).resolves.toEqual({ ok: false });
    expect(onWritten).toHaveBeenCalledOnce();
  });
  it.each([["parsed", 1], ["unparsed", 0]] as const)("does not audit no-op %s/%s", async (state, count) => {
    const onWritten = vi.fn(async () => {});
    await parseReceipt(service(state, count), "receipt", onWritten);
    expect(onWritten).not.toHaveBeenCalled();
  });
});
