import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ingest: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/email-receipts", () => ({ ingestInboundReceipt: mocks.ingest }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/supabase-server", () => ({ getServiceRoleClient: () => { throw new Error("unexpected client"); } }));
import { processInboundMessage } from "@/lib/inbound-router";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("real router, receiving fetch and finalizer make exactly one receiving GET and only two permitted RPCs", async () => {
  vi.stubEnv("RESEND_API_KEY", "synthetic-test-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://inbox.example.test");
  const row = { id: "transport", message_id: "<transport>", provider_email_id: "provider-id", from_address: "guest@example.test",
    subject: "Catering for Friday", to_addresses: ["events@example.test"], cc_addresses: [], received_for: [],
    lane: "catering", route_reason: "catering_address", location_id: null, fetch_attempts: 0, received_at: "2026-11-11T12:00:00Z" };
  const fetchSpy = vi.fn(async () => Response.json({ id: row.provider_email_id, text: "Need catering for an event",
    headers: [{ name: "Message-ID", value: "<provider>" }], attachments: [{ filename: "menu.pdf", download_url: "https://forbidden.test/file" }] }));
  vi.stubGlobal("fetch", fetchSpy);
  let child: Record<string, unknown> | null = null;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === "record_catering_inbound") child = { id: "child", inbound_message_id: row.id, revision: 0, disposition: "recorded", ...args.p_content as object };
    else if (name !== "finalize_catering_inbound") throw new Error(`Forbidden RPC ${name}`);
    return { data: { revision: 1, replayed: false }, error: null };
  });
  const from = vi.fn((table: string) => {
    if (!["inbound_messages", "catering_inbound_messages", "inbound_address_aliases", "locations", "catering_customers"].includes(table)) throw new Error(`Forbidden table ${table}`);
    let update = false;
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "lt", "lte", "order", "range", "limit", "ilike", "returns", "maybeSingle", "single"]) query[method] = () => query;
    query.update = () => { if (table !== "inbound_messages") throw new Error("Forbidden update"); update = true; return query; };
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "inbound_messages" ? row : table === "catering_inbound_messages" ? child : [], error: null, count: update ? 1 : null }).then(resolve);
    return query;
  });
  expect(await processInboundMessage(row.id, { from, rpc } as unknown as Parameters<typeof processInboundMessage>[1])).toBe("catering_fetched");
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, options] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("https://api.resend.com/emails/receiving/provider-id?html_format=cid");
  expect(url).not.toContain("/attachments");
  expect(options.method ?? "GET").toBe("GET");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["record_catering_inbound", "finalize_catering_inbound"]);
  expect(mocks.ingest).not.toHaveBeenCalled();
});
