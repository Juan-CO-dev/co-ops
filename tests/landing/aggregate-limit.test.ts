import { describe, expect, it, vi } from "vitest";
import { checkLandingAggregate } from "@/lib/landing/aggregate-limit-server";

const request = new Request("https://eat.example.com/api/landing/events", { headers: { host: "eat.example.com" } });
describe("landing aggregate SDK boundary", () => {
  it.each([undefined, "off", "", "unknown", "SDK"])("handles switch %j without SDK I/O", async value => {
    const check = vi.fn();
    expect(await checkLandingAggregate(request, { LANDING_AGGREGATE_LIMIT: value }, "landing-capi", { check })).toBe(value === undefined || value === "off" ? "skipped" : "unavailable");
    expect(check).not.toHaveBeenCalled();
  });
  it.each([
    [{ rateLimited: false }, "allowed"],
    [{ rateLimited: true }, "refused"],
    [{ rateLimited: false, error: "not-found" }, "unavailable"],
    [{ rateLimited: true, error: "blocked" }, "refused"],
  ] as const)("maps SDK result %j", async (result, expected) => {
    const check = vi.fn().mockResolvedValue(result);
    expect(await checkLandingAggregate(request, { LANDING_AGGREGATE_LIMIT: "sdk", NODE_ENV: "production" }, "landing-capi", { check })).toBe(expected);
    expect(check).toHaveBeenCalledExactlyOnceWith("landing-aggregate", { request, rateLimitKey: "landing-capi", timeout: 1000 });
  });
  it.each([new Error("fixture failure"), new DOMException("fixture timeout", "TimeoutError")])("fails closed on rejection %j", async error => {
    const check = vi.fn().mockRejectedValue(error);
    expect(await checkLandingAggregate(request, { LANDING_AGGREGATE_LIMIT: "sdk", NODE_ENV: "production" }, "landing-capi", { check })).toBe("unavailable");
  });
  it("fails closed on synchronous throws", async () => {
    const check = vi.fn(() => { throw new Error("fixture failure"); });
    expect(await checkLandingAggregate(request, { LANDING_AGGREGATE_LIMIT: "sdk", NODE_ENV: "production" }, "landing-capi", { check })).toBe("unavailable");
  });
});

it.each([undefined, "test", "development", ""])("refuses sdk for passed NODE_ENV=%j", async NODE_ENV => {
  const check = vi.fn();
  expect(await checkLandingAggregate(request, { LANDING_AGGREGATE_LIMIT: "sdk", NODE_ENV }, "landing-capi", { check })).toBe("unavailable");
  expect(check).not.toHaveBeenCalled();
});
it.each(["landing-capi", "landing-counter"] as const)("preserves separate route key %s", async rateLimitKey => {
  const check = vi.fn().mockResolvedValue({ rateLimited: false });
  expect(await checkLandingAggregate(request, { LANDING_AGGREGATE_LIMIT: "sdk", NODE_ENV: "production" }, rateLimitKey, { check })).toBe("allowed");
  expect(check).toHaveBeenCalledExactlyOnceWith("landing-aggregate", { request, rateLimitKey, timeout: 1000 });
});
