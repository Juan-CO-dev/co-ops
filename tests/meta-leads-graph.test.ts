import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { fetchMetaLead } from "@/lib/meta-leads/graph";

const expected = { leadgenId: "123", formId: "456" };
const dependencies = { pageToken: "stub-page-token", appSecret: "stub-app-secret" };
describe("Meta Graph retrieval", () => {
  it("uses shared pin, header credential, appsecret proof, redirect refusal and deadline", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: "123", form_id: "456", field_data: [] }));
    expect(await fetchMetaLead(expected, { ...dependencies, send })).toMatchObject({ ok: true });
    const [url, options] = send.mock.calls[0]!;
    expect(String(url)).toContain("https://graph.facebook.com/v25.0/123?");
    expect(String(url)).not.toContain(dependencies.pageToken);
    expect(new URL(String(url)).searchParams.get("appsecret_proof")).toBe(createHmac("sha256", dependencies.appSecret).update(dependencies.pageToken).digest("hex"));
    expect(options).toMatchObject({ headers: { Authorization: `Bearer ${dependencies.pageToken}` }, redirect: "error", cache: "no-store" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([[401, "graph_auth"], [403, "graph_auth"], [429, "graph_rate_limit"], [404, "graph_not_found"], [500, "graph_unavailable"]])("closes HTTP %s", async (status, error) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response("provider secret", { status: Number(status) }));
    expect(await fetchMetaLead(expected, { ...dependencies, send })).toEqual({ ok: false, error });
  });
  it("classifies Graph 400 token expiry without returning or logging provider text", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 190, message: dependencies.pageToken } }, { status: 400 }));
    expect(await fetchMetaLead(expected, { ...dependencies, send })).toEqual({ ok: false, error: "graph_auth" });
    expect(logger).not.toHaveBeenCalled(); logger.mockRestore();
  });
  it("classifies Graph 400 quota error", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { code: 4 } }, { status: 400 }));
    expect(await fetchMetaLead(expected, { ...dependencies, send })).toEqual({ ok: false, error: "graph_rate_limit" });
  });
  it.each([{ id: "999", form_id: "456" }, { id: "123", form_id: "999" }, { id: "123" }, { id: "123", form_id: "456", created_time: "bad-date" }])("rejects mismatched or malformed evidence %j", async fields => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...fields, field_data: [] }));
    expect(await fetchMetaLead(expected, { ...dependencies, send })).toEqual({ ok: false, error: "invalid_payload" });
  });
  it("closes thrown errors, including credentials embedded by transport", async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error(dependencies.pageToken));
    expect(await fetchMetaLead(expected, { ...dependencies, send })).toEqual({ ok: false, error: "graph_unavailable" });
    send.mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    expect(await fetchMetaLead(expected, { ...dependencies, send })).toEqual({ ok: false, error: "graph_timeout" });
  });
});
