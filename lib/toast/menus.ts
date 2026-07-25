/**
 * Toast menu pull (read-track 1). SERVER-ONLY fetch wrapper over the pure
 * flattenToastMenus normalizer — see lib/toast/menus-shared.ts for the walk +
 * poisoning contract.
 */
import "server-only";

import { toastGet, ToastApiError } from "./client";
import { flattenToastMenus, flattenToastModifierOptions } from "./menus-shared";
import type { ToastItem } from "./matcher";

export async function fetchToastMenuItems(restaurantGuid: string): Promise<ToastItem[]> {
  const json = await toastGet<unknown>("/menus/v2/menus", restaurantGuid);
  try {
    return flattenToastMenus(json);
  } catch (err) {
    throw new ToastApiError(502, "bad_payload", err instanceof Error ? err.message : "bad menus payload");
  }
}

export async function fetchToastModifierOptions(restaurantGuid: string): Promise<ToastItem[]> {
  const json = await toastGet<unknown>("/menus/v2/menus", restaurantGuid);
  try {
    return flattenToastModifierOptions(json);
  } catch (err) {
    throw new ToastApiError(502, "bad_payload", err instanceof Error ? err.message : "bad modifier payload");
  }
}
