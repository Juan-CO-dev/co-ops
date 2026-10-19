import 'server-only';
import { cache } from 'react';
import { getServiceRoleClient } from '@/lib/supabase-server';
import { UNATTRIBUTED, validAdCandidate } from './ad-codes-shared';
import { landingRateLimit } from './rate-limit';
import { boundedJson, emptyResponse, guardLandingRequest, type LandingServerEnv } from './request-server';

type Lookup = (candidate: string, signal: AbortSignal) => Promise<boolean>;
async function registryLookup(candidate: string, signal: AbortSignal): Promise<boolean> {
  const { data, error } = await getServiceRoleClient().from('landing_ad_codes')
    .select('code').eq('code', candidate).eq('active', true).limit(1).abortSignal(signal).maybeSingle();
  return !error && data?.code === candidate;
}
/** One factory per request; no process cache can resurrect a retired code. */
export function createAdCodeResolver(lookup: Lookup = registryLookup, timeoutMs = 750) {
  const pending = new Map<string, Promise<string>>();
  return (candidate: unknown): Promise<string> => {
    if (!validAdCandidate(candidate) || candidate === UNATTRIBUTED) return Promise.resolve(UNATTRIBUTED);
    const previous = pending.get(candidate);
    if (previous) return previous;
    const resolution = (async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<boolean>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, timeoutMs); });
        return await Promise.race([Promise.resolve().then(() => lookup(candidate, controller.signal)), timeout]) ? candidate : UNATTRIBUTED;
      } catch { return UNATTRIBUTED; }
      finally { clearTimeout(timer); }
    })();
    pending.set(candidate, resolution);
    return resolution;
  };
}
// React cache is request-scoped during server rendering, never a global registry cache.
export const SSR_AD_CODE_TIMEOUT_MS = 300;
export const resolveAdCode = cache(async (candidate: unknown) => createAdCodeResolver(registryLookup, SSR_AD_CODE_TIMEOUT_MS)(candidate));

export async function handleAdCode(request: Request, dependencies: { env?: LandingServerEnv; resolve?: (candidate: unknown) => Promise<string> } = {}): Promise<Response> {
  const env = dependencies.env ?? process.env;
  const refused = guardLandingRequest(request, env);
  if (refused) return refused;
  const body = await boundedJson(request, 512);
  if ('error' in body) return body.error;
  const value = body.value;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('candidate' in value) || !validAdCandidate(value.candidate)) return emptyResponse(400);
  let ad = UNATTRIBUTED;
  const protection = landingRateLimit(env);
  if (protection === 'refused') return emptyResponse(429);
  if (protection === 'unavailable') return emptyResponse(503);
  try { ad = await (dependencies.resolve ?? createAdCodeResolver())(value.candidate); } catch { /* Fixed fallback, no diagnostics. */ }
  return Response.json({ ad: ad === value.candidate ? ad : UNATTRIBUTED }, { headers: { 'Cache-Control': 'private, no-store' } });
}
