import { afterEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";
import { proxy as original, config } from "./pre-chunk-a-proxy.fixture";
vi.mock("@/lib/auth", () => ({ verifyJwt: vi.fn(async () => ({ user_id:"u", app_role:"employee", role_level:1, session_id:"s" })) }));
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, ""])("empty allowlist preserves byte-identical staff routing decisions (%s)", async (hosts) => {
  vi.stubEnv("LANDING_HOSTS", hosts);
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  for (const path of ["/", "/order", "/order/start", "/api/portal/test", "/api/cron/test", "/api/webhooks/test", "/api/locations", "/verify", "/admin", "/training", "/foo.png", "/brand/test.png", "/_next/static/a.js", "/_next/image", "/_next/staticfoo", "/robots.txt", "/sitemap.xml"]) {
    for (const cookie of ["", "co_ops_session=test"]) {
      const request = new NextRequest(`https://staff.example.test${path}`, {headers:{host:"staff.example.test", cookie}});
      const before = matcher.test(path) ? await original(request) : NextResponse.next();
      const after = await proxy(request);
      const decision = (response: NextResponse) => JSON.stringify({ status:response.status, location:response.headers.get("location"), rewrite:response.headers.get("x-middleware-rewrite"), next:response.headers.get("x-middleware-next") });
      expect(decision(after), `${path} ${cookie}`).toBe(decision(before));
    }
  }
});
it("logs no request data when an invalid host falls back to staff", async () => {
 const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 try {
  vi.stubEnv("LANDING_HOSTS","eat.example.test");
  const response=await proxy(new NextRequest("https://staff.example.test/", {headers:{host:"private@example.test", "x-forwarded-host":"sensitive.example.test"}}));
  expect(response.status).toBe(200);
  expect(warn.mock.calls).toEqual([["[landing] invalid host; landing dormant"]]);
 } finally {warn.mockRestore();}
});
