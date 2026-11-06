import { describe, expect, it, vi } from "vitest";
import { parseOrderClick } from "@/lib/landing/order-click-shared";
import { handleOrderClick } from "@/lib/landing/order-click-server";

const env = { LANDING_HOSTS: "eat.example.com", SITE_ORIGIN: "https://eat.example.com", STAFF_ORIGIN: "https://staff.example.com", LANDING_COUNTER_ENABLED: "true" };
const request = (body: unknown, headers: Record<string, string | undefined> = {}) => new Request("https://eat.example.com/api/landing/order-click", { method: "POST", headers: { host: "eat.example.com", origin: env.SITE_ORIGIN, "content-type": "application/json", cookie: "landing_consent=accepted", ...Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) }, body: JSON.stringify(body) });

describe("independent order counter", () => {
  it("bounds cardinality and never accepts identifiers or unknown stores", () => {
    expect(parseOrderClick({ store: "capitol-hill", ad: "subsim-photo" })).toEqual({ intent: "legacy", store: "capitol-hill", ad: "subsim-photo" });
    expect(parseOrderClick({ store: "dupont", ad: "unknown" })).toEqual({ intent: "legacy", store: "dupont", ad: "unknown" });
    for (const value of [{ store: "other", ad: "subsim-photo" }, { store: "dupont", ad: "x".repeat(100) }, { store: "dupont", ad: "subsim-photo", event_id: "id" }, { store: "dupont", ad: "subsim-photo", ip: "1.2.3.4" }, null]) expect(parseOrderClick(value)).toBeNull();
  });
  it("writes only normalized keys once, independently of Meta and WAF", async () => {
    const increment = vi.fn().mockResolvedValue(undefined);
    expect((await handleOrderClick(request({ store: "dupont", ad: "unknown" }), { env, increment })).status).toBe(204);
    expect(increment).toHaveBeenCalledExactlyOnceWith({ intent: "legacy", store: "dupont", ad: "unknown" });
  });
  it("does no DB work when dormant, denied, invalid or wrong-origin", async () => {
    const increment = vi.fn();
    expect((await handleOrderClick(request({ store: "dupont", ad: "subsim-photo" }), { env: { ...env, LANDING_COUNTER_ENABLED: undefined }, increment })).status).toBe(204);
    for (const headers of [{ cookie: "" }, { dnt: "1" }, { "sec-gpc": "1" }, { origin: "null" }, { origin: "https://foreign.example" }, { host: "staff.example.com" }]) {
      expect((await handleOrderClick(request({ store: "dupont", ad: "subsim-photo" }, headers), { env, increment })).status).toBeGreaterThanOrEqual(400);
    }
    expect(increment).not.toHaveBeenCalled();
  });
  it("reports DB failure without retry or diagnostics", async () => {
    const increment = vi.fn().mockRejectedValue(new Error("secret DB error"));
    const response = await handleOrderClick(request({ store: "dupont", ad: "subsim-photo" }), { env, increment });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
    expect(increment).toHaveBeenCalledTimes(1);
  });
});

describe("counter aggregate protection", () => {
  const click = { store: "dupont", ad: "subsim-photo" };
  it("increments with the real aggregate switch off even in production", async () => {
    const increment = vi.fn().mockResolvedValue(undefined);
    expect((await handleOrderClick(request(click), { env: { ...env, VERCEL_ENV: "production", LANDING_AGGREGATE_LIMIT: "off" }, increment })).status).toBe(204);
    expect(increment).toHaveBeenCalledTimes(1);
  });
  it.each([["refused", 429, 0], ["unavailable", 503, 0], ["allowed", 204, 1], ["skipped", 204, 1]] as const)("maps aggregate %s before increment", async (result, status, writes) => {
    const aggregate = vi.fn().mockResolvedValue(result); const increment = vi.fn().mockResolvedValue(undefined);
    const req = request(click);
    const response = await handleOrderClick(req, { env, aggregate, increment });
    expect(response.status).toBe(status); expect(await response.text()).toBe("");
    expect(aggregate).toHaveBeenCalledExactlyOnceWith(req, env);
    expect(increment).toHaveBeenCalledTimes(writes);
    if (writes) expect(aggregate.mock.invocationCallOrder[0]).toBeLessThan(increment.mock.invocationCallOrder[0]!);
  });
  it.each([{ LANDING_COUNTER_ENABLED: "false" }, { LANDING_WAF_STATE: "refused" }, { LANDING_WAF_STATE: "unavailable" }])("honors earlier gates %j", async patch => {
    const aggregate = vi.fn(); const increment = vi.fn();
    await handleOrderClick(request(click), { env: { ...env, ...patch }, aggregate, increment });
    expect(aggregate).not.toHaveBeenCalled(); expect(increment).not.toHaveBeenCalled();
  });
});
