/**
 * Catering delivery (D1) — per-shop settings (migration 0356, `delivery_settings`). Service role. Server-only.
 *
 *  - THE SWITCH FIRST (`DELIVERY_TRACKING`): off = the loader answers `{ state: "off" }` with no query; the save
 *    throws 503 `delivery_off`.
 *  - THE GATE BEFORE ANY I/O: owner / CGS / MoO, by trusted role (`deliverySettingsWriteAllowed`).
 *  - ONE writer: `set_delivery_settings`. It re-checks the role on the locked users row, compares the row the person
 *    saw (`settings_moved`), and writes its own destructive `delivery.settings_update` audit row in the same
 *    transaction — so this module never calls audit(). Never write `delivery_settings` any other way.
 *  - 0356 missing = `not_installed` on the read, 503 `delivery_unavailable` on the save. Never a 500.
 * The courier labels are TENANT DATA entered by a person; no courier name is a literal in code.
 */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { deliveryActorOf, deliverySettingsWriteAllowed } from "./access-shared";
import { deliveryTrackingOn } from "./config";
import { DeliveryError, deliveryErrorFrom, deliveryOff, DELIVERY_NOT_INSTALLED } from "./errors";
import { DEFAULT_GRATUITY_DRIVER_BPS, type DeliveryShopSettings } from "./types-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
export const DELIVERY_SETTINGS_COLUMNS = "location_id,enabled,manual_providers,gratuity_driver_bps,updated_at";
export interface DeliverySettingsRow { location_id: string; enabled: boolean; manual_providers: unknown; gratuity_driver_bps: number; updated_at: string }

export function fromDeliverySettingsRow(row: DeliverySettingsRow): DeliveryShopSettings {
  const providers = Array.isArray(row.manual_providers) ? row.manual_providers.filter((p): p is string => typeof p === "string") : [];
  return { locationId: row.location_id, enabled: row.enabled === true, manualProviders: providers, gratuityDriverBps: row.gratuity_driver_bps, updatedAt: row.updated_at };
}
/** No row = off, no couriers, the default share. */
export function defaultDeliverySettings(locationId: string): DeliveryShopSettings {
  return { locationId, enabled: false, manualProviders: [], gratuityDriverBps: DEFAULT_GRATUITY_DRIVER_BPS, updatedAt: null };
}

/** `openJobs` = the open delivery jobs of leads NOW at the shop (the writer's own count): what turning it off would hide. */
export interface DeliveryShopCard extends DeliveryShopSettings { name: string; openJobs: number }

/** Open jobs per shop, counted by the LEAD's current shop (as `set_delivery_settings` counts `open_jobs`). Paged; ids chunked. */
async function readOpenJobCounts(sb: Sb): Promise<Map<string, number>> {
  const fail = (res: { error: { code?: string; message: string } | null }) => { if (res.error) throw deliveryErrorFrom(res.error); };
  const open = await selectAllRows<{ id: string; pipeline_id: string }>(async (from, to) => {
    const res = await sb.from("delivery_job_current").select("id,pipeline_id").is("closed_at", null).order("id").range(from, to);
    fail(res);
    return res;
  });
  const counts = new Map<string, number>();
  const leads = [...new Set(open.map((j) => j.pipeline_id))].sort();
  const shopOf = new Map<string, string | null>();
  for (let i = 0; i < leads.length; i += 100) {
    const ids = leads.slice(i, i + 100);
    const rows = await selectAllRows<{ id: string; location_id: string | null }>(async (from, to) => {
      const res = await sb.from("catering_pipeline").select("id,location_id").in("id", ids).order("id").range(from, to);
      fail(res);
      return res;
    });
    for (const r of rows) shopOf.set(r.id, r.location_id);
  }
  for (const j of open) {
    const shop = shopOf.get(j.pipeline_id);
    if (shop) counts.set(shop, (counts.get(shop) ?? 0) + 1);
  }
  return counts;
}
export type DeliverySettingsView = { state: "off" } | { state: "not_installed" } | { state: "ready"; shops: DeliveryShopCard[] };

/** Every active shop with its settings (no row = the defaults, off). */
export async function loadDeliverySettings(actor: AuthContext, deps: { client?: Sb } = {}): Promise<DeliverySettingsView> {
  if (!deliveryTrackingOn()) return { state: "off" };
  if (!deliverySettingsWriteAllowed(deliveryActorOf(actor))) throw new DeliveryError(403, "forbidden");
  const sb = deps.client ?? getServiceRoleClient();
  const probe = await sb.rpc("delivery_ready");
  if (probe.error) {
    if (probe.error.code && DELIVERY_NOT_INSTALLED.has(probe.error.code)) return { state: "not_installed" };
    throw new DeliveryError(500, "generic");
  }
  let notInstalled = false;
  try {
    const [shops, rows] = await Promise.all([
      selectAllRows<{ id: string; name: string }>((from, to) => sb.from("locations").select("id,name").eq("active", true).order("name").order("id").range(from, to)),
      selectAllRows<DeliverySettingsRow>(async (from, to) => {
        const res = await sb.from("delivery_settings").select(DELIVERY_SETTINGS_COLUMNS).order("location_id").range(from, to);
        if (res.error?.code && DELIVERY_NOT_INSTALLED.has(res.error.code)) notInstalled = true;
        return res;
      }),
    ]);
    const byShop = new Map(rows.map((r) => [r.location_id, r]));
    const openJobs = await readOpenJobCounts(sb);
    return { state: "ready", shops: shops.map((s) => {
      const row = byShop.get(s.id);
      return { ...(row ? fromDeliverySettingsRow(row) : defaultDeliverySettings(s.id)), name: s.name, openJobs: openJobs.get(s.id) ?? 0 };
    }) };
  } catch (error) {
    if (notInstalled || (error instanceof DeliveryError && error.code === "delivery_unavailable")) return { state: "not_installed" };
    throw new DeliveryError(500, "generic");
  }
}

/** One shop's settings for the server (ungated: the caller has already bound its own gate). Null = no row. */
export async function readShopDeliverySettings(sb: Sb, locationId: string): Promise<DeliveryShopSettings | null> {
  const { data, error } = await sb.from("delivery_settings").select(DELIVERY_SETTINGS_COLUMNS).eq("location_id", locationId).maybeSingle<DeliverySettingsRow>();
  if (error) throw deliveryErrorFrom(error);
  return data ? fromDeliverySettingsRow(data) : null;
}

export interface DeliverySettingsSave {
  locationId: string;
  values: { enabled: boolean; manualProviders: string[]; gratuityDriverBps: number };
  /** The `updatedAt` the person saw; null = they saw no row. */
  expectedUpdatedAt: string | null;
}

/**
 * `openJobs` = the open delivery jobs of leads now at this shop. OFF MEANS OFF: while a shop is off NO writer accepts
 * anything for it (not even a cancellation), so those jobs wait until it is turned on again — the card warns with this.
 */
export async function saveDeliverySettings(actor: AuthContext, input: DeliverySettingsSave, deps: { client?: Sb } = {}): Promise<DeliveryShopSettings & { openJobs: number }> {
  if (!deliveryTrackingOn()) throw deliveryOff();
  if (!deliverySettingsWriteAllowed(deliveryActorOf(actor))) throw new DeliveryError(403, "forbidden");
  const sb = deps.client ?? getServiceRoleClient();
  const { data, error } = await sb.rpc("set_delivery_settings", {
    p_actor_id: actor.user.id, p_location_id: input.locationId,
    p_settings: { enabled: input.values.enabled, manual_providers: input.values.manualProviders, gratuity_driver_bps: input.values.gratuityDriverBps },
    p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) throw deliveryErrorFrom(error);
  const row = data as (DeliverySettingsRow & { open_jobs?: unknown }) | null;
  if (!row || typeof row.updated_at !== "string" || typeof row.location_id !== "string" || typeof row.open_jobs !== "number") throw new DeliveryError(500, "generic");
  return { ...fromDeliverySettingsRow(row), openJobs: row.open_jobs };
}
