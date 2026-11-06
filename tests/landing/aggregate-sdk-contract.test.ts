import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkRateLimit } from "@vercel/firewall";
import { checkLandingAggregate } from "@/lib/landing/aggregate-limit-server";

const env = { NODE_ENV: "production", LANDING_AGGREGATE_LIMIT: "sdk", META_CAPI_ACCESS_TOKEN: "fixture-meta-token" };
const request = (host = true) => new Request("https://eat.example.com/api/landing/events", {
  headers: host ? { host: "eat.example.com" } : {},
});
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each([
  [204, "allowed"], [429, "refused"], [403, "refused"], [404, "unavailable"],
  [302, "unavailable"], [401, "unavailable"], [500, "unavailable"],
] as const)("real pinned SDK maps HTTP %s to %s", async (status, expected) => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", transport);
  expect(await checkLandingAggregate(request(), env, "landing-capi", { check: checkRateLimit })).toBe(expected);
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, init] = transport.mock.calls[0]!;
  expect(new URL(String(url)).pathname).toContain("/.well-known/vercel/rate-limit-api/landing-aggregate");
  expect(String(url)).not.toContain(env.META_CAPI_ACCESS_TOKEN);
  const headers = new Headers(init?.headers);
  expect(headers.has("authorization")).toBe(false);
  expect(JSON.stringify([...headers.entries()])).not.toContain(env.META_CAPI_ACCESS_TOKEN);
  expect(init?.body).toBeUndefined();
});
it("real pinned SDK fetch rejection fails closed", async () => {
  const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("fixture network failure"));
  vi.stubGlobal("fetch", transport);
  expect(await checkLandingAggregate(request(), env, "landing-capi", { check: checkRateLimit })).toBe("unavailable");
  expect(transport).toHaveBeenCalledTimes(1);
});
it("missing Host fails closed before SDK transport", async () => {
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", transport);
  expect(await checkLandingAggregate(request(false), env, "landing-capi", { check: checkRateLimit })).toBe("unavailable");
  expect(transport).not.toHaveBeenCalled();
});
