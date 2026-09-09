import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import ts from "typescript";
import type http from "node:http";
import {
  SIM_PROJECT_REF, SIM_APP_ORIGIN, SIM_PORTAL_ALLOWLIST, parseAllowedTarget,
  assertSimTarget, isAllowedRequestUrl, validateSimEnvFile, buildChildEnv,
  REQUIRED_SIM_KEYS, PROVIDER_KEYS_CLOSED_INVENTORY, ALLOWED_PREFERENCE_KEYS,
} from "../lib/sim-isolation-shared";
import { guardedFetch, guardedRequest, SimIsolationError } from "../scripts/sim/launch-readiness/network";

const db = `https://${SIM_PROJECT_REF}.supabase.co`;
const fixture = (): Record<string, string> => ({
  NEXT_PUBLIC_SUPABASE_URL: db, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sk_sim_placeholder",
  SUPABASE_SERVICE_ROLE_KEY: "sk_sim_placeholder", AUTH_PIN_PEPPER: "sim_pin_placeholder",
  AUTH_PASSWORD_PEPPER: "sim_password_placeholder", AUTH_JWT_SECRET: "ab".repeat(32),
  NEXT_PUBLIC_STOREFRONT_LOCATION_ID: "11111111-1111-4111-8111-111111111111",
});
const parsed = parseAllowedTarget(fixture());
if (!parsed.ok) throw new Error("invalid synthetic fixture");
const target = parsed.target;
afterEach(() => vi.unstubAllEnvs());

describe("sim isolation policy", () => {
  it("positive target parse and normalized default port", () => {
    expect(target).toEqual({ appOrigin: SIM_APP_ORIGIN, dbOrigin: db, storageOrigin: db, policyVersion: "f1-v1" });
    expect(parseAllowedTarget({ NEXT_PUBLIC_SUPABASE_URL: `${db}:443/`, NEXT_PUBLIC_APP_URL: `${SIM_APP_ORIGIN}/` }).ok).toBe(true);
    expect(validateSimEnvFile(fixture())).toEqual({ ok: true });
    expect(() => assertSimTarget(db)).not.toThrow();
  });
  it.each([
    "https://other.supabase.co", `https://other.invalid/${SIM_PROJECT_REF}`,
    `https://${SIM_PROJECT_REF}@other.invalid`, `${db}.evil.invalid`, `https://prefix-${SIM_PROJECT_REF}.supabase.co`,
    `${db.replace(".co", ".co.")}`, db.replace("https:", "http:"), `${db}:444`, `${db}/rest/v1/`,
    `${db}?token=sim_placeholder`, `${db}#sim_placeholder`, `${db}?`, `${db}#`, `${db}/a/..`,
    `https://@${SIM_PROJECT_REF}.supabase.co`, ` ${db}`, `${db}\\`,
  ])("wrong DB: %s", (url) => {
    expect(parseAllowedTarget({ NEXT_PUBLIC_SUPABASE_URL: url }).ok).toBe(false);
    expect(() => assertSimTarget(url)).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  });
  it.each([
    "http://127.0.0.1:3100", "https://localhost:3100", "http://localhost:3000", "http://localhost.:3100",
    "http://localhost.evil.invalid:3100", "http://user@localhost:3100", `${SIM_APP_ORIGIN}/base`,
    `${SIM_APP_ORIGIN}?`, `${SIM_APP_ORIGIN}#`,
  ])("unexpected host: configured app %s", (url) => {
    expect(parseAllowedTarget({ ...fixture(), NEXT_PUBLIC_APP_URL: url }).ok).toBe(false);
  });
  it.each([
    "/api/users?location_id=sim", "api/users", "./api/users", `${SIM_APP_ORIGIN}/_next/static/test.js`,
    `${db}/rest/v1/users?select=id`, `${db}/storage/v1/object/sign/sim/test.png?token=sim`,
  ])("allows app and derived API paths: %s", (url) => expect(isAllowedRequestUrl(url, target, "runtime")).toBe(true));
  it.each([
    "http://127.0.0.1:3100/api", "https://other.supabase.co/storage/v1/object/test", "https://evil.invalid/redirect",
    `${db}/rest/v10/users`, `${db}/rest/v1/../../admin`, `${db}/auth/v1/token`, `${db}/realtime/v1/`,
    "//localhost:3100/api", "file:///tmp/test", "ws://localhost:3100", "data:text/plain,test", "about:blank",
    `https://user@${SIM_PROJECT_REF}.supabase.co/rest/v1/users`,
  ])("unexpected host or path: %s", (url) => expect(isAllowedRequestUrl(url, target, "runtime")).toBe(false));
  it.each(["fonts.googleapis.com", "fonts.gstatic.com"])("unexpected host: %s build-only exception", (host) => {
    expect(isAllowedRequestUrl(`https://${host}/font`, target, "build")).toBe(true);
    expect(isAllowedRequestUrl(`https://${host}/font`, target, "runtime")).toBe(false);
    expect(isAllowedRequestUrl(`https://${host}.evil.invalid/font`, target, "build")).toBe(false);
    expect(isAllowedRequestUrl(`http://${host}/font`, target, "build")).toBe(false);
  });
  it("cannot widen the policy with a forged storage target", () => {
    expect(isAllowedRequestUrl("https://evil.invalid/storage/v1/file", { ...target, storageOrigin: "https://evil.invalid" }, "runtime")).toBe(false);
  });
  it.each(REQUIRED_SIM_KEYS)("missing config: %s cannot inherit", (key) => {
    const file = fixture(); delete file[key];
    expect(validateSimEnvFile(file)).toMatchObject({ ok: false, reasons: expect.arrayContaining([`${key}: required`]) });
    expect(() => buildChildEnv(fixture(), file)).toThrow(key);
  });
  it("missing config: JWT either/or cannot inherit", () => {
    const file = fixture(); delete file.AUTH_JWT_SECRET;
    expect(() => buildChildEnv(fixture(), file)).toThrow("AUTH_JWT_SECRET or SIM_LEGACY_JWT_SECRET");
    file.SIM_LEGACY_JWT_SECRET = "sim_legacy_placeholder";
    const hex = Buffer.from(file.SIM_LEGACY_JWT_SECRET).toString("hex");
    expect(buildChildEnv({}, file).AUTH_JWT_SECRET).toBe(hex);
    file.AUTH_JWT_SECRET = hex.toUpperCase();
    expect(validateSimEnvFile(file)).toEqual({ ok: true });
    file.AUTH_JWT_SECRET = "ab";
    expect(validateSimEnvFile(file)).toMatchObject({ ok: false });
  });
  it.each(["x", "abc", "0x1234", " "])("invalid JWT hex: %s", (hex) => {
    expect(validateSimEnvFile({ ...fixture(), AUTH_JWT_SECRET: hex })).toMatchObject({ ok: false });
  });
  it.each(PROVIDER_KEYS_CLOSED_INVENTORY)("enabled external leg: %s names key only", (key) => {
    expect(validateSimEnvFile({ ...fixture(), [key]: "sk_sim_NEVER_LOG_VALUE" })).toEqual({ ok: false, reasons: [`${key}: must be empty`] });
    expect(validateSimEnvFile({ ...fixture(), [key]: "" })).toEqual({ ok: true });
  });
  it.each(["", "*", "customer-a@sim.invalid", `${SIM_PORTAL_ALLOWLIST},other@sim.invalid`])("enabled external leg: portal allowlist %s", (value) => {
    expect(validateSimEnvFile({ ...fixture(), PORTAL_MAGIC_LINK_ALLOWLIST: value })).toEqual({ ok: false, reasons: ["PORTAL_MAGIC_LINK_ALLOWLIST: fixture recipients required"] });
  });
  it("closed portal list and disabled flags", () => {
    expect(validateSimEnvFile({ ...fixture(), PORTAL_MAGIC_LINK_ALLOWLIST: SIM_PORTAL_ALLOWLIST, TOAST_ENABLED: "false", TWILIO_ENABLED: "false" })).toEqual({ ok: true });
    for (const key of ["TOAST_ENABLED", "TWILIO_ENABLED"]) expect(validateSimEnvFile({ ...fixture(), [key]: "true" }).ok).toBe(false);
  });
  it.each(ALLOWED_PREFERENCE_KEYS)("preference keys allowed: %s", (key) => {
    expect(validateSimEnvFile({ ...fixture(), [key]: "sim_preference" })).toEqual({ ok: true });
  });
  it.each(["NEW_PROVIDER_API_KEY", "NODE_OPTIONS", "SIM_PHASE", "SUPABASE_DB_URL"])("unknown key rejected: %s", (key) => {
    expect(validateSimEnvFile({ ...fixture(), [key]: "sk_sim_NEVER_LOG_VALUE" })).toEqual({ ok: false, reasons: [`${key}: unknown key`] });
  });
  it("buildChildEnv blanks inherited credentials and overlays explicit file", () => {
    const parent = { ...fixture(), AUTH_EXTRA: "inherited", SUPABASE_EXTRA: "inherited", NEXT_PUBLIC_SUPABASE_OTHER: "inherited", auth_lower: "inherited", SIM_LEGACY_JWT_SECRET: "inherited", PORTAL_MAGIC_LINK_ALLOWLIST: "*", Path: "synthetic_path", HTTP_PROXY: "synthetic_proxy", NODE_OPTIONS: "synthetic_options", ...Object.fromEntries(PROVIDER_KEYS_CLOSED_INVENTORY.map((key) => [key, "inherited"])) };
    const child = buildChildEnv(parent, fixture());
    for (const key of PROVIDER_KEYS_CLOSED_INVENTORY) expect(child[key]).toBe("");
    for (const key of ["AUTH_EXTRA", "SUPABASE_EXTRA", "NEXT_PUBLIC_SUPABASE_OTHER", "auth_lower", "SIM_LEGACY_JWT_SECRET"]) expect(child[key]).toBe("");
    for (const [key, value] of Object.entries(fixture())) expect(child[key]).toBe(value);
    expect(child).toMatchObject({ NODE_ENV: "production", SIM_MODE: "1", TOAST_FIXTURES: "1", EZCATER_FIXTURES: "1", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_APP_URL: SIM_APP_ORIGIN, PORTAL_MAGIC_LINK_ALLOWLIST: SIM_PORTAL_ALLOWLIST, Path: "synthetic_path", HTTP_PROXY: "synthetic_proxy", NODE_OPTIONS: "synthetic_options" });
    expect(parent.AUTH_EXTRA).toBe("inherited");
  });
});

describe("transport decisions with stub transports (no network)", () => {
  it("unexpected host: fetch refuses before transport", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(guardedFetch(transport, target, "runtime")("https://sk_sim_placeholder.invalid/private?secret=sim")).rejects.toThrow("GET external-host destination-denied");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([301, 302, 303, 307, 308])("revalidates redirect %s before second dispatch", async (status) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status, headers: { location: "https://sk_sim_placeholder.invalid/private" } }));
    await expect(guardedFetch(transport, target, "runtime")(`${SIM_APP_ORIGIN}/redirect`)).rejects.toBeInstanceOf(SimIsolationError);
    expect(transport).toHaveBeenCalledTimes(1);
    expect((transport.mock.calls[0]![0] as Request).redirect).toBe("manual");
  });
  it.each(["manual", "error"] as const)("honors redirect mode %s", async (redirect) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location: "/next" } }));
    const promise = guardedFetch(transport, target, "runtime")(`${SIM_APP_ORIGIN}/redirect`, { redirect });
    if (redirect === "manual") expect((await promise).status).toBe(302);
    else await expect(promise).rejects.toThrow("redirect-limit-or-mode");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([`https://@${SIM_PROJECT_REF}.supabase.co/rest/v1/users`, "//localhost:3100/next", "https://fonts.gstatic.com/font"])("rejects redirect spelling before normalization: %s", async (location) => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(guardedFetch(transport, target, "runtime")(`${SIM_APP_ORIGIN}/redirect`)).rejects.toBeInstanceOf(SimIsolationError);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("follows allowed relative redirect, rewrites POST and drops cross-origin credentials", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: `${db}/rest/v1/users` } })).mockResolvedValueOnce(new Response("ok"));
    const response = await guardedFetch(transport, target, "runtime")(`${SIM_APP_ORIGIN}/redirect`, { method: "POST", body: "sim_payload", headers: { authorization: "sim_auth", cookie: "sim_cookie", apikey: "sim_api" } });
    expect(await response.text()).toBe("ok");
    const next = transport.mock.calls[1]![0] as Request;
    expect(next.method).toBe("GET");
    expect(next.body).toBeNull();
    for (const key of ["authorization", "cookie", "apikey", "content-type"]) expect(next.headers.has(key)).toBe(false);
  });
  it("307 preserves method and body", async () => {
    const bodies: string[] = [];
    const transport = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const req = input as Request; bodies.push(await req.text());
      return bodies.length === 1 ? new Response(null, { status: 307, headers: { location: "/next" } }) : new Response("ok");
    });
    await guardedFetch(transport, target, "runtime")(`${SIM_APP_ORIGIN}/redirect`, { method: "POST", body: "sim_payload" });
    expect(bodies).toEqual(["sim_payload", "sim_payload"]);
  });
  it("redirect loops are bounded", async () => {
    const transport = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 302, headers: { location: "/loop" } }));
    await expect(guardedFetch(transport, target, "runtime")(`${SIM_APP_ORIGIN}/loop`)).rejects.toThrow("redirect-limit-or-mode");
    expect(transport).toHaveBeenCalledTimes(20);
  });
  it.each(["http:", "https:"] as const)("unexpected host: %s request refuses before transport", (protocol) => {
    const transport = vi.fn();
    const request = guardedRequest(transport as typeof http.request, protocol, target, "runtime");
    expect(() => request(`${protocol}//sk_sim_placeholder.invalid/private`)).toThrow(SimIsolationError);
    expect(() => request({ hostname: "sk_sim_placeholder.invalid", path: "/" })).toThrow(SimIsolationError);
    expect(transport).not.toHaveBeenCalled();
  });
  it("HTTP overloads validate the effective options", () => {
    const transport = vi.fn();
    const request = guardedRequest(transport as typeof http.request, "http:", target, "runtime");
    request(new URL(`${SIM_APP_ORIGIN}/api`), () => {});
    request({ hostname: "localhost", port: 3100, path: "/api?test=sim" });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(() => request(`${SIM_APP_ORIGIN}/api`, { hostname: "evil.invalid" })).toThrow(SimIsolationError);
    expect(() => request(`${SIM_APP_ORIGIN}/api`, { path: "https://evil.invalid" })).toThrow(SimIsolationError);
    expect(() => request(`${SIM_APP_ORIGIN}/api`, { method: "CONNECT" })).toThrow(SimIsolationError);
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

it("sim guard runs before cached service client return and authed construction; non-sim is inert", async () => {
  const { getServiceRoleClient, createAuthedClient } = await import("../lib/supabase-server");
  vi.stubEnv("SIM_MODE", ""); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sk_sim_placeholder"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sk_sim_placeholder");
  const cached = getServiceRoleClient();
  expect(createAuthedClient("sim_jwt")).toBeDefined();
  vi.stubEnv("SIM_MODE", "1");
  expect(() => getServiceRoleClient()).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  expect(() => createAuthedClient("sim_jwt")).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  vi.stubEnv("SIM_MODE", "");
  expect(getServiceRoleClient()).toBe(cached);
});

it("config guard is inert outside sim and selects isolated distDir only for validated sim", async () => {
  vi.stubEnv("SIM_MODE", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.resetModules();
  const normal = (await import("../next.config")).default;
  expect(normal.distDir).toBeUndefined();
  const headers = await normal.headers!();
  vi.stubEnv("SIM_MODE", "1");
  vi.resetModules();
  await expect(import("../next.config")).rejects.toThrow("NEXT_PUBLIC_SUPABASE_URL");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", db);
  vi.resetModules();
  const sim = (await import("../next.config")).default;
  expect(sim.distDir).toBe(".next-sim-launch");
  expect(await sim.headers!()).toEqual(headers);
});

it("transitive launch-readiness imports never reach product-identity/harness.ts", () => {
  const root = resolve(__dirname, "..");
  const banned = resolve(root, "scripts/sim/product-identity/harness.ts");
  const visited = new Set<string>();
  function visit(file: string): void {
    expect(file).not.toBe(banned);
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function walk(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === "require" || node.expression.getText(source) === "tsImport")) {
        const arg = node.arguments[0];
        expect(arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)), `nonliteral import in ${file}`).toBeTruthy();
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) imports.push(arg.text);
      }
      ts.forEachChild(node, walk);
    }
    walk(source);
    for (const specifier of imports) {
      if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
      const base = specifier.startsWith("@/") ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
      const resolved = [base, ...[".ts", ".tsx", ".mjs", ".js"].map((ext) => base + ext), resolve(base, "index.ts")].find((candidate) => extname(candidate) && existsSync(candidate));
      expect(resolved, `unresolved local import ${specifier}`).toBeDefined();
      if (resolved) visit(resolved);
    }
  }
  function scan(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const file = resolve(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:ts|tsx|mjs|js)$/.test(file)) visit(file);
    }
  }
  scan(resolve(root, "scripts/sim/launch-readiness"));
  expect(visited.size).toBeGreaterThan(3);
});
