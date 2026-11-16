import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ parse: vi.fn(), service: vi.fn() }));
vi.mock("@/lib/receipt-parse", () => ({ parseReceipt: mocks.parse }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: mocks.service }));
/** Room for one whole parse (150 s call + 20 s around it) and a little more. */
const ROOM_MS = 200_000;
import { parseFetchedInboundMessage } from "@/lib/inbound-parse";
function database(receiptId: string | null = "receipt") {
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { email_receipt_id: receiptId } }) };
  return { from: vi.fn(() => chain) };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ANTHROPIC_API_KEY", "fixture"); });
afterEach(() => vi.unstubAllEnvs());
it("parses the ledger-linked receipt immediately", async () => {
  const sb = database(); mocks.service.mockReturnValue(sb);
  await parseFetchedInboundMessage("inbound", Date.now() + ROOM_MS);
  expect(mocks.parse).toHaveBeenCalledWith(sb, "receipt");
  expect(sb.from.mock.results[0]!.value.eq).toHaveBeenCalledWith("lane", "vendor_receipt");
});
it.each(["key", "budget"])("defers to sweep without %s", async missing => {
  const sb = database(); mocks.service.mockReturnValue(sb);
  if (missing === "key") vi.stubEnv("ANTHROPIC_API_KEY", "");
  await parseFetchedInboundMessage("inbound", Date.now() + (missing === "budget" ? 100_000 : ROOM_MS));
  expect(sb.from).not.toHaveBeenCalled(); expect(mocks.parse).not.toHaveBeenCalled();
});
