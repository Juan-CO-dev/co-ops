import { describe, expect, it, vi } from "vitest";
// Never let transport tests consult any connected registry, even with inherited env.
vi.mock("@/lib/landing/ad-codes-server", () => ({ createAdCodeResolver: () => async () => "unattributed" }));
import { handleMetaEvent } from "@/lib/landing/meta-server";

const env = { LANDING_HOSTS: "eat.example.com", SITE_ORIGIN: "https://eat.example.com", STAFF_ORIGIN: "https://staff.example.com", META_PIXEL_ID: "12345", NEXT_PUBLIC_META_PIXEL_ID: "12345", META_CAPI_ACCESS_TOKEN: "test-secret", META_GRAPH_API_VERSION: "v25.0", LANDING_CAPI_ENABLED: "true", LANDING_META_UA_APPROVED: "true", LANDING_WAF_STATE: "active", LANDING_WAF_VERIFIED_AT: "2026-10-16", LANDING_WAF_RULE_IDS: "ip,aggregate" };
const payload = { event_name: "OrderClick", mode: "pickup", event_id: "d7e520f5-d054-4146-90bb-d7821f0780b6", event_time: 1792108800, consent: "accepted", source_url: "https://eat.example.com/", store: "dupont", ad: "subsim-photo", placement: "hero", fbc: "fb.1.1792108800000.real-click" };
const now = () => payload.event_time * 1000;
it.each([{}, {placement:"lineup",item:"frex"}])("forwards a legacy order shape without mode: %j",async details=>{
  const send=vi.fn(async()=>new Response(null,{status:200}));
  const {mode: _mode,...legacy}=payload;
  const response=await handleMetaEvent(request({...legacy,...details}),{env,now,send});
  expect(response.status).toBe(204);
  const calls=send.mock.calls as unknown as [string,RequestInit][];
  const data=JSON.parse(calls[0]![1].body as string).data[0];
  expect(data.custom_data).toMatchObject({store:"dupont",...details});
  expect(data.custom_data).not.toHaveProperty("mode");
});
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
    expect(event.event_name).toBe('InitiateCheckout');
    expect(event.custom_data).toEqual({mode:'pickup',ad:'unattributed',placement:'hero',store:'dupont',content_name:'OrderClick'});
    expect(event.user_data).toEqual({ client_user_agent: "test-browser", fbc: payload.fbc });
    expect(event).toHaveProperty("action_source", "website");
  });
  it("fails closed on protection outage, refusal and absent matching data", async () => {
    const send = vi.fn();
    for (const [state,status] of [["unavailable",503],["refused",429],["dormant",204]] as const) expect((await handleMetaEvent(request(), { env: { ...env, LANDING_WAF_STATE: state }, send, now })).status).toBe(status);
    expect((await handleMetaEvent(request({ ...payload, fbc: undefined }), { env, send, now })).status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });
  it("redacts upstream failure", async () => {
    for (const send of [vi.fn().mockResolvedValue(new Response("secret", { status: 429 })), vi.fn().mockResolvedValue(new Response("secret", { status: 500 })), vi.fn().mockRejectedValue(new Error("secret timeout"))]) {
      const response = await handleMetaEvent(request(), { env, send, now });
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("secret");
    }
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


it.each([
  {event_name:"OrderClick",mode:"delivery",store:undefined},
  {event_name:"FindLocation",mode:undefined,store:"dupont"},
])("forwards direct intent with the same consent guard (%j)",async patch=>{
  const send=vi.fn().mockResolvedValue(new Response(null,{status:200}));
  const body={...payload,...patch};
  for(const headers of [{cookie:""},{dnt:"1"},{"sec-gpc":"1"}]) expect((await handleMetaEvent(request(body,headers),{env,send,now})).status).toBe(403);
  expect(send).not.toHaveBeenCalled();
  expect((await handleMetaEvent(request(body),{env,send,now})).status).toBe(204);
  const event=JSON.parse(send.mock.calls[0]![1].body).data[0];
  expect(event.event_name).toBe(patch.event_name === 'OrderClick' ? 'InitiateCheckout' : patch.event_name);
  if(patch.mode) {expect(event.custom_data.mode).toBe("delivery");expect(event.custom_data).not.toHaveProperty("store");}
  else {expect(event.custom_data.store).toBe("dupont");expect(event.custom_data).not.toHaveProperty("mode");}
});

describe("CAPI launch readiness", () => {
  it.each([["skipped", 204, 0], ["refused", 429, 0], ["unavailable", 503, 0], ["allowed", 204, 1]] as const)("production aggregate %s", async (result, status, sends) => {
    const aggregate = vi.fn().mockResolvedValue(result);
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const config = { ...env, VERCEL_ENV: "production" };
    const req = request();
    const resolveAd = vi.fn().mockResolvedValue("unattributed");
    const response = await handleMetaEvent(req, { env: config, now, send, aggregate, resolveAd });
    expect(response.status).toBe(status);
    expect(await response.text()).toBe("");
    expect(aggregate).toHaveBeenCalledExactlyOnceWith(req, config, "landing-capi");
    expect(send).toHaveBeenCalledTimes(sends);
    expect(resolveAd).toHaveBeenCalledTimes(sends);
    if (sends) expect(aggregate.mock.invocationCallOrder[0]).toBeLessThan(resolveAd.mock.invocationCallOrder[0]!);
    if (sends) expect(aggregate.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  });
  it("keeps production dormant with the real unset aggregate switch", async () => {
    const send = vi.fn();
    expect((await handleMetaEvent(request(), { env: { ...env, VERCEL_ENV: "production" }, now, send })).status).toBe(204);
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    { LANDING_CAPI_ENABLED: "false" }, { META_PIXEL_ID: "invalid" }, { META_CAPI_ACCESS_TOKEN: undefined },
    { META_GRAPH_API_VERSION: "invalid" }, { NEXT_PUBLIC_META_PIXEL_ID: "67890" },
    { VERCEL_ENV: "production", META_TEST_EVENT_CODE: "TEST" },
    { LANDING_WAF_STATE: "dormant" }, { LANDING_WAF_STATE: "refused" }, { LANDING_WAF_STATE: "unavailable" },
    { LANDING_META_UA_APPROVED: "false" },
  ])("does not consult aggregate after an earlier env gate %j", async patch => {
    const aggregate = vi.fn(); const send = vi.fn();
    await handleMetaEvent(request(), { env: { ...env, ...patch }, now, send, aggregate });
    expect(aggregate).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it.each([
    () => request(payload, { origin: "null" }),
    () => request({ ...payload, event_name: "invalid" }),
    () => request({ ...payload, fbc: undefined }),
    () => request(payload, { "user-agent": "" }),
    () => request(payload, { "user-agent": "x".repeat(513) }),
  ])("does not consult aggregate after request or matching gates", async makeRequest => {
    const aggregate = vi.fn(); const send = vi.fn();
    await handleMetaEvent(makeRequest(), { env, now, send, aggregate });
    expect(aggregate).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  });
  it.each([
    ["preview", "production", true], ["development", "production", true],
    ["production", "production", false], ["production", "development", false],
    [undefined, "production", false], [undefined, "development", true], [undefined, undefined, true],
    ["unknown", "development", false], ["", "development", false],
  ] as const)("test code for VERCEL_ENV=%s NODE_ENV=%s", async (vercel, node, allowed) => {
    const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const aggregate = vi.fn().mockResolvedValue("skipped");
    const response = await handleMetaEvent(request(), { env: { ...env, VERCEL_ENV: vercel, NODE_ENV: node, META_TEST_EVENT_CODE: "TEST" }, now, send, aggregate });
    expect(response.status).toBe(allowed ? 204 : 503);
    expect(send).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(aggregate).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (allowed) expect(JSON.parse(send.mock.calls[0]![1].body).test_event_code).toBe("TEST");
  });
});

it.each([undefined, "", "unknown", "production", "preview"])("skipped aggregate with production build and VERCEL_ENV=%j", async VERCEL_ENV => {
  const aggregate = vi.fn().mockResolvedValue("skipped");
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const resolveAd = vi.fn().mockResolvedValue("unattributed");
  const response = await handleMetaEvent(request(), { env: { ...env, VERCEL_ENV, NODE_ENV: "production" }, now, aggregate, send, resolveAd });
  expect(response.status).toBe(204);
  expect(aggregate).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(VERCEL_ENV === "preview" ? 1 : 0);
  expect(resolveAd).toHaveBeenCalledTimes(VERCEL_ENV === "preview" ? 1 : 0);
});


it.each([
  ['OrderClick', 'InitiateCheckout', {mode:'pickup',placement:'lineup',item:'frex',store:'dupont'}],
  ['OrderClick', 'InitiateCheckout', {mode:undefined,placement:'shops',vendor:'ubereats',store:'dupont'}],
  ['CateringClick', 'CateringClick', {mode:undefined,placement:'catering',store:undefined}],
  ['Lead', 'Lead', {mode:undefined,placement:'catering',store:undefined}],
  ['FindLocation', 'FindLocation', {mode:undefined,placement:'shops',store:'dupont'}],
] as const)('maps inbound %s to Meta %s without losing context (%j)', async (name, wireName, details) => {
  const send = vi.fn().mockResolvedValue(new Response(null, {status:200}));
  expect((await handleMetaEvent(request({...payload,...details,event_name:name}), {env,now,send,resolveAd:async candidate => String(candidate)})).status).toBe(204);
  const event = JSON.parse(send.mock.calls[0]![1].body).data[0];
  expect(event.event_name).toBe(wireName);
  expect(event.event_id).toBe(payload.event_id);
  expect(event.custom_data).toEqual({
    ad:payload.ad, ...Object.fromEntries(Object.entries(details).filter(([,value])=>value!==undefined)),
    ...(name === 'OrderClick' ? {content_name:'OrderClick'} : {}),
  });
});

it('refuses the Meta wire name at the internal inbound boundary', async () => {
  const send = vi.fn();
  expect((await handleMetaEvent(request({...payload,event_name:'InitiateCheckout'}), {env,now,send})).status).toBe(400);
  expect(send).not.toHaveBeenCalled();
});
