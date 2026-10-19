import { describe, expect, it, vi } from "vitest";
// Never let transport tests consult any connected registry, even with inherited env.
vi.mock("@/lib/landing/ad-codes-server", () => ({ createAdCodeResolver: () => async () => "unattributed" }));
import { handleMetaEvent } from "@/lib/landing/meta-server";
import { parseLandingEvent } from "@/lib/landing/tracking-schema-shared";
import { boundedJson } from "@/lib/landing/request-server";
const env = { LANDING_HOSTS: "eat.example.com", SITE_ORIGIN: "https://eat.example.com", STAFF_ORIGIN: "https://staff.example.com", META_PIXEL_ID: "12345", NEXT_PUBLIC_META_PIXEL_ID: "99999", META_CAPI_ACCESS_TOKEN: "test-secret", META_GRAPH_API_VERSION: "v25.0", LANDING_CAPI_ENABLED: "true", LANDING_META_UA_APPROVED: "true", LANDING_WAF_STATE: "active", LANDING_WAF_VERIFIED_AT: "2026-10-16", LANDING_WAF_RULE_IDS: "ip,aggregate" };
const event = { event_name: "OrderClick", event_id: "d7e520f5-d054-4146-90bb-d7821f0780b6", event_time: 1792108800, consent: "accepted", source_url: env.SITE_ORIGIN + "/", store: "dupont", ad: "subsim-photo", placement: "hero", fbc: "fb.1.1792108800000.real-click" };
describe("landing CAPI schema edge contracts", () => {
  it("refuses mismatched browser and server datasets", async () => {
    const send = vi.fn();
    const req = new Request(env.SITE_ORIGIN + "/api/landing/events", { method: "POST", headers: { host: "eat.example.com", origin: env.SITE_ORIGIN, cookie: "landing_consent=accepted", "content-type": "application/json", "user-agent": "test-browser" }, body: JSON.stringify(event) });
    expect((await handleMetaEvent(req, { env, send, now: () => event.event_time * 1000 })).status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });
  it("supports bounded genuine click IDs up to 500 characters", () => {
    expect(parseLandingEvent({ ...event, fbc: "fb.1.1792108800000." + "a".repeat(500) }, env.SITE_ORIGIN, event.event_time * 1000)).not.toBeNull();
    expect(parseLandingEvent({ ...event, fbc: "fb.1.1792108800000." + "a".repeat(501) }, env.SITE_ORIGIN, event.event_time * 1000)).toBeNull();
  });
  it("supports only allowlisted footer vendors without inferring a store", () => {
    for (const vendor of ["ubereats", "doordash"]) expect(parseLandingEvent({ ...event, store: undefined, placement: "footer", vendor }, env.SITE_ORIGIN, event.event_time * 1000)).not.toBeNull();
    for (const patch of [{ vendor: "unknown", placement: "footer" }, { vendor: "ubereats", placement: "hero" }, { vendor: "ubereats", event_name: "Lead", placement: "footer" }]) expect(parseLandingEvent({ ...event, ...patch }, env.SITE_ORIGIN, event.event_time * 1000)).toBeNull();
    expect(parseLandingEvent({ ...event, store: undefined }, env.SITE_ORIGIN, event.event_time * 1000)).toBeNull();
  });
  it('accepts only the verified Dupont Uber Eats shop placement',()=>{
    expect(parseLandingEvent({...event,vendor:'ubereats',placement:'shops'},env.SITE_ORIGIN,event.event_time*1000)).not.toBeNull();
    for(const patch of [{store:undefined},{store:'capitol-hill'},{vendor:'doordash'},{placement:'hero'},{event_name:'Lead'}]) {
      expect(parseLandingEvent({...event,vendor:'ubereats',placement:'shops',...patch},env.SITE_ORIGIN,event.event_time*1000)).toBeNull();
    }
  });
  it("rejects malformed, wrong-media and declared-oversize JSON", async () => {
    for (const [body, headers, status] of [["{", { "content-type": "application/json" }, 400], ["{}", { "content-type": "text/plain" }, 415], ["{}", { "content-type": "application/json", "content-length": "999999" }, 413]] as const) {
      const result = await boundedJson(new Request("https://eat.example.com", { method: "POST", headers, body }));
      expect("error" in result && result.error.status).toBe(status);
    }
  });
});

it.each([undefined, ""])("sends a valid server-only event without a public Pixel ID (%s)", async (publicPixelId) => {
  const send = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  const req = new Request(env.SITE_ORIGIN + "/api/landing/events", { method: "POST", headers: { host: "eat.example.com", origin: env.SITE_ORIGIN, cookie: "landing_consent=accepted", "content-type": "application/json", "user-agent": "test-browser" }, body: JSON.stringify(event) });
  const response = await handleMetaEvent(req, { env: { ...env, NEXT_PUBLIC_META_PIXEL_ID: publicPixelId }, send, now: () => event.event_time * 1000 });
  expect(response.status).toBe(204);
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0]![1].body).data[0].event_id).toBe(event.event_id);
});

it.each(['sticky','hero','catering'])('accepts direct %s placement and rejects vendor misuse',placement=>{
  expect(parseLandingEvent({...event,placement},env.SITE_ORIGIN,event.event_time*1000)).not.toBeNull();
  expect(parseLandingEvent({...event,placement,vendor:'ubereats'},env.SITE_ORIGIN,event.event_time*1000)).toBeNull();
});
