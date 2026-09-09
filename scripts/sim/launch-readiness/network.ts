/** Node --import preload. HTTP does not follow redirects itself; each new request
 * is checked. fetch is forced manual and checks every hop before dispatch. */
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { urlToHttpOptions } from "node:url";
import { isAllowedRequestUrl, parseAllowedTarget, type SimTarget } from "../../../lib/sim-isolation-shared";

type Phase = "build" | "runtime";
export class SimIsolationError extends Error {
  constructor(method: string, category: string, rule: string) {
    // Methods can be caller-controlled too: never echo an arbitrary token.
    const safeMethod = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/i.test(method) ? method.toUpperCase() : "OTHER";
    super(`SimIsolationError: ${safeMethod} ${category} ${rule}`);
    this.name = "SimIsolationError";
  }
}

function check(url: string, method: string, target: SimTarget, phase: Phase): void {
  let category = "invalid-host";
  try {
    const origin = new URL(url, target.appOrigin).origin;
    category = origin === target.appOrigin ? "app-host" : origin === target.dbOrigin ? "db-host" : "external-host";
  } catch { /* Never echo the malformed input. */ }
  if (method.toUpperCase() === "CONNECT" || !isAllowedRequestUrl(url, target, phase)) throw new SimIsolationError(method, category, "destination-denied");
}

export function guardedFetch(transport: typeof fetch, target: SimTarget, phase: Phase): typeof fetch {
  return async (input, init) => {
    const raw = input instanceof Request ? input.url : String(input);
    check(raw, init?.method ?? (input instanceof Request ? input.method : "GET"), target, phase);
    let request = new Request(input instanceof Request ? input : new URL(raw, target.appOrigin), init);
    const redirectMode = request.redirect;
    for (let hop = 0; ; hop++) {
      check(request.url, request.method, target, phase);
      // Keep an unread clone for 307/308 replay; the transport consumes its copy.
      const response = await transport(new Request(request.clone(), { redirect: "manual" }));
      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response;
      let next: URL;
      try {
        // Reject protocol-relative redirects before URL can normalize them.
        if (location.startsWith("//") || /[\s\\]/.test(location)) throw new Error();
        check(location, request.method, target, phase);
        next = new URL(location, request.url);
        check(next.href, request.method, target, phase);
      } catch (error) {
        await response.body?.cancel();
        if (error instanceof SimIsolationError) throw error;
        throw new SimIsolationError(request.method, "invalid-host", "redirect-denied");
      }
      if (redirectMode === "manual") return response;
      await response.body?.cancel();
      if (redirectMode === "error" || hop >= 19) throw new SimIsolationError(request.method, "allowed-host", "redirect-limit-or-mode");
      const headers = new Headers(request.headers);
      if (next.origin !== new URL(request.url).origin) {
        for (const key of ["authorization", "cookie", "proxy-authorization", "apikey"]) headers.delete(key);
      }
      const toGet = ((response.status === 301 || response.status === 302) && request.method === "POST") || (response.status === 303 && request.method !== "GET" && request.method !== "HEAD");
      if (toGet) for (const key of ["content-type", "content-length", "content-encoding", "content-language", "content-location"]) headers.delete(key);
      // Node fetch requires duplex for streamed request bodies.
      const options: RequestInit & { duplex?: "half" } = {
        method: toGet ? "GET" : request.method, headers, signal: request.signal,
        body: toGet ? undefined : request.body, duplex: "half", redirect: "manual",
      };
      request = new Request(next, options);
    }
  };
}

type RequestArgs = [string | URL | http.RequestOptions, (http.RequestOptions | ((res: http.IncomingMessage) => void))?, ((res: http.IncomingMessage) => void)?];

export function guardedRequest(transport: typeof http.request, protocol: "http:" | "https:", target: SimTarget, phase: Phase): typeof http.request {
  return ((...args: RequestArgs) => {
    const [input, second, third] = args;
    const callback = typeof second === "function" ? second : third;
    if (typeof input === "string" || input instanceof URL) check(String(input), typeof second === "object" ? second.method ?? "GET" : "GET", target, phase);
    let options: http.RequestOptions;
    try {
      options = typeof input === "string" || input instanceof URL
        ? { ...urlToHttpOptions(new URL(input)), ...(typeof second === "object" ? second : {}) }
        : { ...input };
    } catch { throw new SimIsolationError("OTHER", "invalid-host", "destination-denied"); }
    const method = options.method ?? "GET";
    // Socket/custom connection options can override the validated destination.
    if (options.socketPath || options.createConnection || options.auth) throw new SimIsolationError(method, "invalid-host", "transport-override-denied");
    const scheme = options.protocol ?? protocol;
    const host = options.hostname ?? options.host ?? "localhost";
    const port = options.port ? `:${options.port}` : "";
    const path = options.path ?? "/";
    if (!path.startsWith("/") || path.startsWith("//") || /[/@?#\\\s]/.test(host)) throw new SimIsolationError(method, "invalid-host", "destination-denied");
    check(`${scheme}//${host}${port}${path}`, method, target, phase);
    return transport(options, callback);
  }) as typeof http.request;
}

export function installNetworkGuard(env: Record<string, string | undefined>): void {
  const parsed = parseAllowedTarget(env);
  if (!parsed.ok) throw new Error(parsed.reasons.join("; "));
  if (env.SIM_PHASE !== "build" && env.SIM_PHASE !== "runtime") throw new Error("SIM_PHASE: build or runtime required");
  globalThis.fetch = guardedFetch(globalThis.fetch, parsed.target, env.SIM_PHASE);
  http.request = guardedRequest(http.request, "http:", parsed.target, env.SIM_PHASE);
  https.request = guardedRequest(https.request, "https:", parsed.target, env.SIM_PHASE);
  http.get = ((...args: RequestArgs) => { const req = (http.request as (...args: RequestArgs) => http.ClientRequest)(...args); req.end(); return req; }) as typeof http.get;
  https.get = ((...args: RequestArgs) => { const req = (https.request as (...args: RequestArgs) => http.ClientRequest)(...args); req.end(); return req; }) as typeof https.get;
  syncBuiltinESMExports();
}

// No import-time side effect: `instrumentation.ts` calls installNetworkGuard() once per server
// instance in sim mode (Next's `register()` hook, Node runtime only).
