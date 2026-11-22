/**
 * THE READINESS GATE for structure settings that need a migration (PR SCH-2, plan r5 20.7, ruling D7). Server-only by use
 * (it takes the service client; nothing here reads env or a secret).
 *
 * The code may merge before Juan authorizes the migration, so a structure key whose SQL twin is not installed must never
 * be written: the old validator's table CHECK would refuse it, and worse, a deployment older than the code would refuse
 * it on its editor. Migration 0354 creates `public.schedule_structure_features()` (a sentinel, service_role only) that
 * names the structure features the database's validator accepts. This module reads it:
 *  - "function not found" (PostgREST PGRST202, Postgres 42883) = the migration is not applied = no features;
 *  - any other error, a timeout or a malformed answer = no features, plus one log line (its code, never content);
 *  - a YES is cached for 10 minutes, a NO for 60 seconds (an apply is picked up within a minute).
 * The cache is per service client (the server's client is one cached object; each test store is its own).
 *
 * Consumers: the settings view (the mode select is shown only when ready), the structure save path (a structure
 * carrying `catering.earlyOpenMode` is refused `feature_not_ready` BEFORE any write when not ready). The engine needs no
 * check: before the apply no stored structure can carry the key, and absent = manual (`earlyOpenModeOf`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const SCHEDULE_FEATURES = ["early_open_mode"] as const;
export type ScheduleFeature = (typeof SCHEDULE_FEATURES)[number];
export const FEATURE_YES_TTL_MS = 10 * 60_000;
export const FEATURE_NO_TTL_MS = 60_000;
/** The read's own deadline: a hung read is "not ready", never a hung settings page or save. */
export const FEATURE_READ_DEADLINE_MS = 5_000;

const cache = new WeakMap<object, { features: readonly ScheduleFeature[]; until: number }>();
const missing = (e: { code?: string; message?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");

export async function scheduleFeatures(service: SupabaseClient, opts: { now?: number } = {}): Promise<readonly ScheduleFeature[]> {
  const now = opts.now ?? Date.now();
  const hit = cache.get(service);
  if (hit && hit.until > now) return hit.features;
  let features: ScheduleFeature[] = [];
  try {
    const { data, error } = await service.rpc("schedule_structure_features").abortSignal(AbortSignal.timeout(FEATURE_READ_DEADLINE_MS));
    if (error) {
      if (!missing(error)) console.warn(`[schedule-features] sentinel read failed (${error.code ?? "no code"}); treating as not ready`);
    } else if (Array.isArray(data)) {
      features = SCHEDULE_FEATURES.filter((f) => (data as unknown[]).includes(f));
    } else {
      console.warn("[schedule-features] sentinel answered a non-array; treating as not ready");
    }
  } catch (e) {
    console.warn(`[schedule-features] sentinel read threw (${(e as { name?: string }).name ?? "error"}); treating as not ready`);
  }
  cache.set(service, { features, until: now + (features.length > 0 ? FEATURE_YES_TTL_MS : FEATURE_NO_TTL_MS) });
  return features;
}

/** 0354 is applied: `catering.earlyOpenMode` may be shown and saved. */
export async function earlyOpenReady(service: SupabaseClient, opts: { now?: number } = {}): Promise<boolean> {
  return (await scheduleFeatures(service, opts)).includes("early_open_mode");
}
