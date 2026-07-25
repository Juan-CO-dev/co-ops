/**
 * Toast menu pull (read-track 1+) — CACHED since 2026-07-24 (Juan: "build the
 * menu cache"; Toast's menus/v2 is aggressively rate-limited and first-light
 * day burned a whole window).
 *
 * Toast's recommended pattern, implemented here:
 *   1. In-process memo (120s TTL) — collapses the items+modifiers double pull
 *      inside one match run to a single fetch.
 *   2. `/menus/v2/metadata` probe (cheap) vs the DB cache's lastUpdated
 *      (`toast_menu_cache`, migration 0153) — exact match → serve cached
 *      payload, NO menus pull.
 *   3. Changed/ambiguous → full `/menus/v2/menus` pull → upsert cache.
 *   4. Probe/pull rate-limited or failing WITH a cache present → serve the
 *      cached payload (stale-ok: menu drift is advisory; a day-old menu beats
 *      a dead feature). No cache → the typed error propagates as before.
 * Fixture mode bypasses the cache entirely (deterministic tests/demos).
 */
import "server-only";

import { getServiceRoleClient } from "@/lib/supabase-server";
import { toastGet, toastConfigured, ToastApiError } from "./client";
import { flattenToastMenus, flattenToastModifierOptions } from "./menus-shared";
import { isCacheFresh, extractLastUpdated } from "./menus-cache-shared";
import type { ToastItem } from "./matcher";

const MEMO_TTL_MS = 120_000;
const memo = new Map<string, { at: number; payload: unknown }>();

function fixtureMode(): boolean {
  return !toastConfigured() || process.env.TOAST_FIXTURES === "1";
}

async function loadCacheRow(guid: string): Promise<{ payload: unknown; last_updated: string | null } | null> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_menu_cache")
    .select("payload, last_updated").eq("restaurant_guid", guid)
    .maybeSingle<{ payload: unknown; last_updated: string | null }>();
  if (error) throw new Error(`toast menu cache read: ${error.message}`);
  return data ?? null;
}

async function saveCacheRow(guid: string, payload: unknown, lastUpdated: string | null): Promise<void> {
  const sb = getServiceRoleClient();
  const { error } = await sb.from("toast_menu_cache")
    .upsert({ restaurant_guid: guid, payload, last_updated: lastUpdated, fetched_at: new Date().toISOString() }, { onConflict: "restaurant_guid" });
  if (error) throw new Error(`toast menu cache write: ${error.message}`);
}

/** The cached menus payload for a restaurant — single fetch per run, DB-backed across runs. */
export async function getToastMenusJson(restaurantGuid: string): Promise<unknown> {
  if (fixtureMode()) {
    return toastGet<unknown>("/menus/v2/menus", restaurantGuid);
  }
  const hit = memo.get(restaurantGuid);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.payload;

  const cached = await loadCacheRow(restaurantGuid);

  let metaLastUpdated: string | null = null;
  let probeFailed = false;
  try {
    const meta = await toastGet<unknown>("/menus/v2/metadata", restaurantGuid);
    metaLastUpdated = extractLastUpdated(meta);
  } catch {
    probeFailed = true; // metadata probe is an optimization — never fatal by itself
  }

  if (cached && !probeFailed && isCacheFresh(cached.last_updated, metaLastUpdated)) {
    memo.set(restaurantGuid, { at: Date.now(), payload: cached.payload });
    return cached.payload;
  }

  try {
    const payload = await toastGet<unknown>("/menus/v2/menus", restaurantGuid);
    await saveCacheRow(restaurantGuid, payload, extractLastUpdated(payload));
    memo.set(restaurantGuid, { at: Date.now(), payload });
    return payload;
  } catch (err) {
    if (cached) {
      // Stale-ok: rate-limited/down but we HAVE a menu — serve it.
      memo.set(restaurantGuid, { at: Date.now(), payload: cached.payload });
      return cached.payload;
    }
    throw err;
  }
}

export async function fetchToastMenuItems(restaurantGuid: string): Promise<ToastItem[]> {
  const json = await getToastMenusJson(restaurantGuid);
  try {
    return flattenToastMenus(json);
  } catch (err) {
    throw new ToastApiError(502, "bad_payload", err instanceof Error ? err.message : "bad menus payload");
  }
}

export async function fetchToastModifierOptions(restaurantGuid: string): Promise<ToastItem[]> {
  const json = await getToastMenusJson(restaurantGuid);
  try {
    return flattenToastModifierOptions(json);
  } catch (err) {
    throw new ToastApiError(502, "bad_payload", err instanceof Error ? err.message : "bad modifier payload");
  }
}
