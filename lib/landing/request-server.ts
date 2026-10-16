import "server-only";
import { classifyLandingHost, configuredOrigin, parseAuthority, type LandingHostEnv } from "./host-shared";
import { loadLandingConfig } from "./config";

export type LandingServerEnv = LandingHostEnv & Record<string, string | undefined>;
export function emptyResponse(status: number): Response {
  return new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
}
/** Route-local checks remain mandatory even when proxy has already classified Host. */
export function guardLandingRequest(request: Request, env: LandingServerEnv): Response | null {
  if (classifyLandingHost(request.headers, env) !== "landing") return emptyResponse(404);
  if (request.method !== "POST") return emptyResponse(405);
  const origin = configuredOrigin(request.headers.get("origin") ?? undefined);
  const host = parseAuthority(request.headers.get("host"));
  const config = loadLandingConfig(env);
  if (!origin || !host || origin.origin !== config.siteOrigin || origin.hostname !== host.hostname || Number(origin.port || 443) !== host.port || request.headers.get("sec-fetch-site") === "cross-site") return emptyResponse(403);
  const preferences = (request.headers.get("cookie") ?? "").split(";").map(item => item.trim()).filter(item => item.startsWith("landing_consent="));
  if (preferences.length !== 1 || preferences[0] !== "landing_consent=accepted" || request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return emptyResponse(403);
  return null;
}
/** Stream bound, not just Content-Length: callers cannot force an unbounded JSON allocation. */
export async function boundedJson(request: Request, limit = 4096): Promise<{ value: unknown } | { error: Response }> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) return { error: emptyResponse(415) };
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) return { error: emptyResponse(413) };
  if (!request.body) return { error: emptyResponse(400) };
  const reader = request.body.getReader();
  let count = 0;
  let json = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  // Server ingress limits are still required. This also bounds slow-body route work.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new Error("body_timeout")); }, 2000); });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), timeout]);
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > limit) { void reader.cancel().catch(() => {}); return { error: emptyResponse(413) }; }
      json += decoder.decode(chunk.value, { stream: true });
    }
    json += decoder.decode();
    return { value: JSON.parse(json) };
  } catch { return { error: emptyResponse(400) }; }
  finally { clearTimeout(timer); reader.releaseLock(); }
}
