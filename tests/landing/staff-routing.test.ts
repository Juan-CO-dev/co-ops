import { afterEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { proxy } from "@/proxy";
import nextConfig from "@/next.config";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as auth from "@/lib/auth";
import * as landingConfig from "@/lib/landing/config";
import * as language from "@/lib/landing/language-shared";
import * as indexing from '@/lib/landing/indexing-shared';
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
    "./lib/landing/indexing-shared": indexing, "./lib/security-headers": security, "./lib/sim-isolation-shared": sim,
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
  ["real public branch redirects", "proxy.ts", "if (isPublicPath(path)) return NextResponse.next({ request: { headers } });", "if (isPublicPath(path)) return NextResponse.redirect(new URL('/wrong', req.url));", "/order", ""],
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
it.each(["preview","production"])("logs once with no request data for invalid host (%s)", async deployment => {
 vi.stubEnv("VERCEL_ENV",deployment);
 const warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
 try {
  vi.stubEnv("LANDING_HOSTS","eat.example.test");
  const response=await proxy(new NextRequest("https://staff.example.test/", {headers:{host:"private@example.test", "x-forwarded-host":"sensitive.example.test"}}));
  expect(response.status).toBe(200);
  expect(warn.mock.calls).toEqual([["[landing] invalid host; landing dormant"]]);
 } finally {warn.mockRestore();}
});

it('keeps all staff response headers byte-identical with landing production enabled', async () => {
  vi.stubEnv('VERCEL_ENV','production'); vi.stubEnv('LANDING_HOSTS','eat.example.test');
  vi.stubEnv('SITE_ORIGIN','https://eat.example.test'); vi.stubEnv('STAFF_ORIGIN','https://staff.example.test');
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  for(const path of ['/','/privacy','/robots.txt','/sitemap.xml','/admin','/order','/api/locations','/_next/static/a.js']) for(const cookie of ['', 'co_ops_session=test']) {
    const req=new NextRequest(`https://staff.example.test${path}`,{headers:{host:'staff.example.test',cookie}});
    const before=matcher.test(path)?await original(req):NextResponse.next();
    const after=await proxy(req);
    expect(after.status,path).toBe(before.status);
    const publicHeaders=(response:NextResponse)=>[...response.headers].filter(([key])=>!key.startsWith('x-middleware-request-') && key!=='x-middleware-override-headers');
    expect(publicHeaders(after),path).toEqual(publicHeaders(before));
    expect(await after.text(),path).toBe(await before.text());
  }
});

it.each(['/order','/api/locations','/api/portal/test','/api/webhooks/test','/api/cron/test'])('strips forged hints on public path %s', async path => {
 const response=await proxy(new NextRequest(`https://staff.example.test${path}`,{headers:{host:'staff.example.test','x-co-user-id':'forged','x-landing-indexable':'1'}}));
 expect(response.headers.get('x-middleware-next')).toBe('1');
 expect(response.headers.get('x-middleware-request-x-co-user-id')).toBeNull();
 expect(response.headers.get('x-middleware-request-x-landing-indexable')).toBeNull();
 expect(response.headers.get('x-middleware-override-headers')).not.toMatch(/x-co-|x-landing/);
});
it('fails closed if landing origin derivation fails', async () => {
 const classify=vi.spyOn(hosts,'classifyLandingHost').mockReturnValue('landing');
 const origin=vi.spyOn(hosts,'configuredOrigin').mockReturnValue(null);
 try {expect((await proxy(new NextRequest('https://eat.example.test/',{headers:{host:'eat.example.test'}}))).status).toBe(404);}
 finally {classify.mockRestore();origin.mockRestore();}
});

it('invalid canonical configuration returns 404 on the listed public host and preserves staff',async()=>{
 vi.stubEnv('LANDING_HOSTS','eat.example.test');vi.stubEnv('SITE_ORIGIN','not-an-origin');vi.stubEnv('STAFF_ORIGIN','https://staff.example.test');
 expect((await proxy(new NextRequest('https://eat.example.test/',{headers:{host:'eat.example.test'}}))).status).toBe(404);
 expect((await proxy(new NextRequest('https://staff.example.test/',{headers:{host:'staff.example.test'}}))).status).toBe(200);
});
