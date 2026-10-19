import { describe, expect, it, vi } from "vitest";
import { parseOrderClick } from "@/lib/landing/order-click-shared";
import { handleOrderClick } from "@/lib/landing/order-click-server";

const env = { LANDING_HOSTS: "eat.example.com", SITE_ORIGIN: "https://eat.example.com", STAFF_ORIGIN: "https://staff.example.com", LANDING_COUNTER_ENABLED: "true" };
const request = (body: unknown, headers: Record<string, string | undefined> = {}) => new Request("https://eat.example.com/api/landing/order-click", { method: "POST", headers: { host: "eat.example.com", origin: env.SITE_ORIGIN, "content-type": "application/json", cookie: "landing_consent=accepted", ...Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)) }, body: JSON.stringify(body) });

describe("independent order counter", () => {
  it("bounds cardinality and never accepts identifiers or unknown stores", () => {
    expect(parseOrderClick({ store: "capitol-hill", ad: "subsim-photo" })).toEqual({ store: "capitol-hill", ad: "subsim-photo" });
    expect(parseOrderClick({ store: "dupont", ad: "unknown" })).toEqual({ store: "dupont", ad: "unknown" });
    for (const value of [{ store: "other", ad: "subsim-photo" }, { store: "dupont", ad: "x".repeat(100) }, { store: "dupont", ad: "subsim-photo", event_id: "id" }, { store: "dupont", ad: "subsim-photo", ip: "1.2.3.4" }, null]) expect(parseOrderClick(value)).toBeNull();
  });
  it("writes only normalized keys once, independently of Meta and WAF", async () => {
    const increment = vi.fn().mockResolvedValue(undefined);
    expect((await handleOrderClick(request({ store: "dupont", ad: "unknown" }), { env, increment })).status).toBe(204);
    expect(increment).toHaveBeenCalledExactlyOnceWith({ store: "dupont", ad: "unknown" });
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
