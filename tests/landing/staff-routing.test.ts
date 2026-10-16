import { afterEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";
import nextConfig from "@/next.config";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as auth from "@/lib/auth";
import * as landingConfig from "@/lib/landing/config";
import * as language from "@/lib/landing/language-shared";
import * as hosts from "@/lib/landing/host-shared";
import * as security from "@/lib/security-headers";
import * as sim from "@/lib/sim-isolation-shared";
import { proxy as original, config } from "./pre-chunk-a-proxy.fixture";
vi.mock("@/lib/auth", () => ({ verifyJwt: vi.fn(async () => ({ user_id:"u", app_role:"employee", role_level:1, session_id:"s" })) }));
afterEach(() => vi.unstubAllEnvs());
const identityHeaders = ["user-id", "app-role", "role-level", "session-id"];
function decision(response: NextResponse) {
  return { status: response.status, location: response.headers.get("location"), rewrite: response.headers.get("x-middleware-rewrite"), next: response.headers.get("x-middleware-next"), identity: identityHeaders.map(name => response.headers.get(`x-middleware-request-x-co-${name}`)) };
}
it("leaves trailing slash normalization to stock Next", () => {
  expect(nextConfig).not.toHaveProperty("skipTrailingSlashRedirect");
});
// Compile controlled mutations in memory: no live source edits or shared-worktree races.
function compile(source: string): { proxy: typeof proxy; default: typeof nextConfig } {
  const dependencies: Record<string, unknown> = {
    "next/server": { NextRequest, NextResponse }, "@/lib/auth": auth,
    "./lib/auth": auth, "./lib/landing/config": landingConfig,
    "./lib/landing/language-shared": language, "./lib/landing/host-shared": hosts,
    "./lib/security-headers": security, "./lib/sim-isolation-shared": sim,
  };
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function("require", "exports", output)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unexpected mutation dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports as ReturnType<typeof compile>;
}
it.each([
  ["identity forwarding removed", "proxy.ts", "headers.set('x-co-user-id', claims.user_id);", "", "/admin", "co_ops_session=test"],
  ["custom slash redirect restored", "proxy.ts", "const path = req.nextUrl.pathname;", "const path = req.nextUrl.pathname; if (path.endsWith('/') && path !== '/') return NextResponse.redirect(new URL(path.slice(0, -1), req.url), 308);", "/admin/", ""],
  ["real public branch redirects", "proxy.ts", "if (isPublicPath(path)) return NextResponse.next();", "if (isPublicPath(path)) return NextResponse.redirect(new URL('/wrong', req.url));", "/order", ""],
  ["fixture public branch redirects", "tests/landing/pre-chunk-a-proxy.fixture.ts", "if (isPublicPath(pathname)) return NextResponse.next();", "if (isPublicPath(pathname)) return NextResponse.redirect(new URL('/wrong', req.url));", "/order", ""],
])("fingerprint rejects mutation: %s", async (_name, file, before, after, path, cookie) => {
  vi.stubEnv("LANDING_HOSTS", "");
  const source = readFileSync(file!, "utf8");
  expect(source).toContain(before);
  const request = new NextRequest(`https://staff.example.test${path}`, {headers:{host:"staff.example.test", cookie:cookie!}});
  const baseline = decision(await compile(source).proxy(request));
  const mutated = decision(await compile(source.replace(before!, after!)).proxy(request));
  expect(() => expect(mutated).toEqual(baseline)).toThrow();
});
it("config pin rejects the skipTrailingSlashRedirect mutation", () => {
  const source = readFileSync("next.config.ts", "utf8");
  const before = "const nextConfig: NextConfig = {";
  expect(source).toContain(before);
  const mutated = compile(source.replace(before, before + " skipTrailingSlashRedirect: true,")).default;
  expect(() => expect(mutated).not.toHaveProperty("skipTrailingSlashRedirect")).toThrow();
});
it("compares the fixture's defensive public branch even outside its matcher", async () => {
  vi.stubEnv("LANDING_HOSTS", "");
  for (const path of ["/", "/order", "/order/", "/api/portal/test", "/brand/test.png"]) {
    const request = new NextRequest(`https://staff.example.test${path}`, {headers:{host:"staff.example.test"}});
    expect(decision(await original(request))).toEqual(decision(NextResponse.next()));
    expect(decision(await proxy(request))).toEqual(decision(await original(request)));
  }
});

it.each([undefined, ""])("empty allowlist preserves byte-identical staff routing decisions (%s)", async (hosts) => {
  vi.stubEnv("LANDING_HOSTS", hosts);
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  for (const path of ["/", "/admin/", "/training/", "/order/", "/foo//", "/order", "/order/start", "/api/portal/test", "/api/cron/test", "/api/webhooks/test", "/api/locations", "/verify", "/admin", "/training", "/foo.png", "/brand/test.png", "/_next/static/a.js", "/_next/image", "/_next/staticfoo", "/robots.txt", "/sitemap.xml"]) {
    for (const cookie of ["", "co_ops_session=test"]) {
      const request = new NextRequest(`https://staff.example.test${path}`, {headers:{host:"staff.example.test", cookie}});
      const before = matcher.test(path) ? await original(request) : NextResponse.next();
      const after = await proxy(request);
      expect(decision(after), `${path} ${cookie}`).toEqual(decision(before));
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
