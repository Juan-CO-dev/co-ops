/**
 * Toast config-API reads (read-track 2). SERVER-ONLY. Dining options are
 * referenced from orders as bare `{guid, entityType}` ToastReferences (PR #174
 * review finding #1) — the human-readable names live here and are resolved at
 * ingest time. Defensive walk; a malformed payload yields an empty map (names
 * degrade to null, never poisons the pull — names are display/matching sugar,
 * not correctness).
 */
import "server-only";

import { toastGet } from "./client";

interface RawDiningOption { guid?: unknown; name?: unknown }

export async function fetchDiningOptionNames(restaurantGuid: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const json = await toastGet<unknown>("/config/v2/diningOptions", restaurantGuid);
    if (Array.isArray(json)) {
      for (const d of json as RawDiningOption[]) {
        if (typeof d?.guid === "string" && typeof d?.name === "string" && d.name.length > 0) {
          out.set(d.guid, d.name);
        }
      }
    }
  } catch {
    // Advisory enrichment only — a failed config pull must not fail ingest.
  }
  return out;
}
