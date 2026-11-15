/**
 * Audit W06/B155 — the proxy forwards the SERVED path (x-co-path) on authenticated staff requests, so a server-side
 * session denial can send the person back to the page they asked for. A client-sent x-co-path is stripped (cannot be
 * forged), Next's internal _rsc parameter is dropped, and public paths get none.
 */
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/auth", () => ({ verifyJwt: vi.fn(async () => ({ user_id: "u", app_role: "gm", role_level: 7, session_id: "s" })) }));
import { proxy } from "@/proxy";

afterEach(() => vi.unstubAllEnvs());
const run = (url: string, headers: Record<string, string>) => {
  vi.stubEnv("LANDING_HOSTS", "");
  return proxy(new NextRequest(url, { headers: { host: "staff.example.test", ...headers } }));
};

it("forwards the served path to the server for the sign-in return link", async () => {
  const res = await run("https://staff.example.test/catering/inbox/abc?tab=2", { cookie: "co_ops_session=test", "x-co-path": "//evil" });
  expect(res.headers.get("x-middleware-request-x-co-path")).toBe("/catering/inbox/abc?tab=2");
});

it("drops Next's internal _rsc parameter", async () => {
  const res = await run("https://staff.example.test/admin/vendors/v1?_rsc=abc123", { cookie: "co_ops_session=test" });
  expect(res.headers.get("x-middleware-request-x-co-path")).toBe("/admin/vendors/v1");
});

it("a public path gets no served path, and a forged one is stripped", async () => {
  const res = await run("https://staff.example.test/order", { "x-co-path": "/admin" });
  expect(res.headers.get("x-middleware-request-x-co-path")).toBeNull();
});
