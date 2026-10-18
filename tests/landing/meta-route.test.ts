import { describe, expect, it, vi } from "vitest";
// Never let transport tests consult any connected registry, even with inherited env.
vi.mock("@/lib/landing/ad-codes-server", () => ({ createAdCodeResolver: () => async () => "unattributed" }));
import { handleMetaEvent } from "@/lib/landing/meta-server";

const env = { LANDING_HOSTS: "eat.example.com", SITE_ORIGIN: "https://eat.example.com", STAFF_ORIGIN: "https://staff.example.com", META_PIXEL_ID: "12345", NEXT_PUBLIC_META_PIXEL_ID: "12345", META_CAPI_ACCESS_TOKEN: "test-secret", META_GRAPH_API_VERSION: "v25.0", LANDING_CAPI_ENABLED: "true", LANDING_META_UA_APPROVED: "true", LANDING_WAF_STATE: "active", LANDING_WAF_VERIFIED_AT: "2026-10-16", LANDING_WAF_RULE_IDS: "ip,aggregate" };
const payload = { event_name: "OrderClick", event_id: "d7e520f5-d054-4146-90bb-d7821f0780b6", event_time: 1792108800, consent: "accepted", source_url: "https://eat.example.com/", store: "dupont", ad: "subsim-photo", placement: "hero", fbc: "fb.1.1792108800000.real-click" };
const now = () => payload.event_time * 1000;
function request(body: unknown = payload, headers: Record<string, string | undefined> = {}) { return new Request("https://eat.example.com/api/landing/events", { method: "POST", headers: { host: "eat.example.com", origin: env.SITE_ORIGIN, "content-type": "application/json", cookie: "landing_consent=accepted", "user-agent": "test-browser", ...Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) }, body: JSON.stringify(body) }); }
describe("public landing CAPI boundary", () => {
  it("no-ops with missing or partial config after validation", async () => {
    const send = vi.fn();
    for (const config of [{}, { META_PIXEL_ID: "12345" }]) expect((await handleMetaEvent(request(), { env: { LANDING_HOSTS: env.LANDING_HOSTS, SITE_ORIGIN: env.SITE_ORIGIN, STAFF_ORIGIN: env.STAFF_ORIGIN, ...config }, send, now })).status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{}, { origin: "" }, { origin: "null" }, { origin: "https://evil.example" }, { origin: "http://eat.example.com" }, { "x-forwarded-host": "evil.example" }, { host: "staff.example.com" }, { host: "" }])("rejects host/origin even while dormant (%j)", async (headers) => {
    const send = vi.fn();
    const effective = Object.keys(headers).length ? headers : { origin: "https://eat.example.com/path" };
    expect((await handleMetaEvent(request(payload, effective), { env, send, now })).status).toBeGreaterThanOrEqual(400);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ event_name: "Purchase" }, { event_name: "PageView" }, { event_id: "no" }, { event_time: 1 }, { event_time: payload.event_time + 61 }, { consent: "rejected" }, { store: "unknown" }, { ad: "email@example.com" }, { placement: "unknown" }, { source_url: "https://evil.example/" }, { source_url: "https://eat.example.com/?email=x" }, { email: "pii" }, { fbc: "made-up" }])("refuses invalid payload %j", async (patch) => {
    const send = vi.fn();
    expect((await handleMetaEvent(request({ ...payload, ...patch }), { env, send, now })).status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([{ cookie: "" }, { cookie: "landing_consent=rejected" }, { cookie: "landing_consent=accepted; landing_consent=rejected" }, { dnt: "1" }, { "sec-gpc": "1" }])("requires first-party consent and honors privacy headers %j", async (headers) => {
    const send = vi.fn();
    expect((await handleMetaEvent(request(payload, headers), { env, send, now })).status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
  it("limits body bytes even without a content length", async () => {
    expect((await handleMetaEvent(request({ ...payload, junk: "x".repeat(9000) }), { env, now })).status).toBe(413);
  });
  it("uses stable browser event ID and only minimum approved matching fields", async () => {
    const send = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    for (let i=0;i<2;i++) expect((await handleMetaEvent(request(), { env, send, now })).status).toBe(204);
    const [url, init] = send.mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v25.0/12345/events");
    expect(url).not.toContain("test-secret");
    const event = JSON.parse(init.body).data[0];
    expect(event.event_id).toBe(payload.event_id);
    expect(event.event_name).toBe(payload.event_name);
    expect(event.user_data).toEqual({ client_user_agent: "test-browser", fbc: payload.fbc });
    expect(event).toHaveProperty("action_source", "website");
  });
  it("fails closed on protection outage, refusal and absent matching data", async () => {
    const send = vi.fn();
    for (const [state,status] of [["unavailable",503],["refused",429],["dormant",204]] as const) expect((await handleMetaEvent(request(), { env: { ...env, LANDING_WAF_STATE: state }, send, now })).status).toBe(status);
    expect((await handleMetaEvent(request({ ...payload, fbc: undefined }), { env, send, now })).status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });
  it("redacts upstream failure and rejects production test codes", async () => {
    for (const send of [vi.fn().mockResolvedValue(new Response("secret", { status: 429 })), vi.fn().mockResolvedValue(new Response("secret", { status: 500 })), vi.fn().mockRejectedValue(new Error("secret timeout"))]) {
      const response = await handleMetaEvent(request(), { env, send, now });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("secret");
    }
    const send = vi.fn();
    expect((await handleMetaEvent(request(), { env: { ...env, NODE_ENV: "production", META_TEST_EVENT_CODE: "TEST" }, send, now })).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
});

it('independently revalidates new and retired codes before CAPI transport',async()=>{
 for(const accepted of ['new-campaign','unattributed']) {
  const send=vi.fn().mockResolvedValue(new Response(null,{status:200})); const resolveAd=vi.fn(async()=>accepted);
  expect((await handleMetaEvent(request({...payload,ad:'new-campaign'}),{env,send,now,resolveAd})).status).toBe(204);
  expect(resolveAd).toHaveBeenCalledWith('new-campaign');
  expect(JSON.parse(send.mock.calls[0]![1].body).data[0].custom_data.ad).toBe(accepted);
 }
});
