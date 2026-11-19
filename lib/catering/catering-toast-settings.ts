/**
 * Item 21 PR 5 — the server side of the catering ↔ Toast settings card (migration 0350) and of "match the old orders".
 *
 * Every entry point refuses anyone but the Owner / CGS / MoO by TRUSTED ROLE before any I/O.
 *  - loadCateringToastSettings: every active shop with its row (no row = the defaults, off) and the two facts the
 *    writer's refusals rest on (0350's probe). 0344 or 0350 missing = `not_installed`, never a 500.
 *  - saveCateringToastSettings: ONE call of `set_catering_toast_settings`, the only writer of the table. It re-checks
 *    the role on the locked users row, the row the person saw, every dependency, and writes its own destructive
 *    `catering.toast_settings_update` audit row in the same transaction (so this module never calls audit(): there is
 *    no way to change a switch without that row). Never write `catering_toast_settings` any other way.
 *  - loadOldOrders / linkOldOrders: the orders not matched yet and the checks the system is sure about
 *    (`oldOrderMatches`). Linking them is a batch of ordinary human links through `decideCateringToastLink` (the one
 *    writer of links: its own decision row and audit row each, the same refusals). The server RECOMPUTES the list on
 *    every batch; a client never sends pairs.
 */
import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { etCalendarDate } from "@/lib/operational-day";
import { CateringPipelineError } from "./pipeline";
import { CateringToastNotInstalled, NOT_INSTALLED, raise, readPlanToCompletion } from "./catering-toast";
import { decideCateringToastLink, linkStepReady } from "./catering-toast-links";
import { HOUSE_STATUS_COLUMNS, plannerWindows, type CateringToastPlanRow, type HouseStatusRow } from "./catering-toast-shared";
import {
  canManageCateringToastSettings, DEFAULT_CATERING_TOAST_SETTINGS, fromSettingsRow, SETTINGS_ERRORS, SETTINGS_ROW_COLUMNS, toSettingsRow,
  type CateringToastSettingsView, type CateringToastShopCard, type SettingsError, type SettingsRow, type SettingsSave,
} from "./catering-toast-settings-shared";
import {
  EMPTY_OLD_ORDERS, OLD_ORDERS_BATCH, oldOrderMatches, oldOrdersView,
  type OldOrderMatches, type OldOrdersLinkResult, type OldOrdersView, type PairHead,
} from "./catering-toast-old-orders-shared";

type Sb = ReturnType<typeof getServiceRoleClient>;
export class CateringToastSettingsError extends Error {
  constructor(public status: number, public code: SettingsError | "generic") { super(code); }
}
function assertRole(actor: AuthContext) {
  if (!canManageCateringToastSettings(actor.role)) throw new CateringToastSettingsError(403, "forbidden");
}

export async function loadCateringToastSettings(actor: AuthContext, deps: { client?: Sb } = {}): Promise<CateringToastSettingsView> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const probe = await sb.rpc("catering_toast_settings_ready");
  if (probe.error) {
    if (probe.error.code && NOT_INSTALLED.has(probe.error.code)) return { state: "not_installed" };
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
  const ready = probe.data as { link_step?: unknown; automatic?: unknown } | null;
  try {
    const [shops, rows] = await Promise.all([
      selectAllRows<{ id: string; name: string }>((from, to) => sb.from("locations").select("id,name").eq("active", true).order("name").order("id").range(from, to)),
      selectAllRows<SettingsRow & { location_id: string; updated_at: string }>(async (from, to) => {
        const res = await sb.from("catering_toast_settings").select(SETTINGS_ROW_COLUMNS).order("location_id").range(from, to);
        if (res.error) raise(res.error);
        return res;
      }),
    ]);
    const byShop = new Map(rows.map((r) => [r.location_id, r]));
    const cards: CateringToastShopCard[] = shops.map((s) => {
      const row = byShop.get(s.id);
      return { locationId: s.id, name: s.name, values: row ? fromSettingsRow(row) : { ...DEFAULT_CATERING_TOAST_SETTINGS }, updatedAt: row?.updated_at ?? null };
    });
    return { state: "ready", readiness: { linkStep: ready?.link_step === true, automatic: ready?.automatic === true }, shops: cards };
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return { state: "not_installed" };
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
}

export async function saveCateringToastSettings(actor: AuthContext, input: SettingsSave, deps: { client?: Sb } = {}): Promise<CateringToastShopCard["values"] & { updatedAt: string }> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const { data, error } = await sb.rpc("set_catering_toast_settings", {
    p_actor_id: actor.user.id, p_location_id: input.locationId, p_settings: toSettingsRow(input.values), p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) {
    if (error.code && NOT_INSTALLED.has(error.code)) throw new CateringToastSettingsError(503, "settings_unavailable");
    // The function's own refusals pass through by name; anything else is a failure, never a silent success.
    const code = (SETTINGS_ERRORS as readonly string[]).find((c) => c === error.message) as SettingsError | undefined;
    if (!code) throw new CateringToastSettingsError(500, "generic");
    throw new CateringToastSettingsError(code === "forbidden" ? 403 : code === "location_not_found" ? 404 : code === "invalid_settings" ? 400 : 409, code);
  }
  const row = data as (SettingsRow & { updated_at?: string }) | null;
  if (!row || typeof row.updated_at !== "string") throw new CateringToastSettingsError(500, "generic");
  return { ...fromSettingsRow(row), updatedAt: row.updated_at };
}

/** The shop's unmatched house orders (through today) and their strong, linkable checks. Read to completion or throw. */
async function matchesFor(sb: Sb, locationId: string, now: Date): Promise<OldOrderMatches> {
  const today = etCalendarDate(now.toISOString());
  const status = await selectAllRows<HouseStatusRow>(async (from, to) => {
    const res = await sb.from("catering_reconciliation_status").select(HOUSE_STATUS_COLUMNS)
      .eq("location_id", locationId).eq("status", "not_rung_in_toast").lte("event_date", today).order("event_date").order("lead_id").range(from, to);
    if (res.error) raise(res.error);
    return res;
  });
  const plan: CateringToastPlanRow[] = [];
  for (const window of plannerWindows(status.map((s) => s.event_date))) {
    plan.push(...await readPlanToCompletion(sb, { p_location_id: locationId, p_from: window.from, p_to: window.to, p_note_codes: [] }));
  }
  const strongLeads = [...new Set(plan.filter((p) => p.evidence === "toast_origin" || p.evidence === "ring_code").map((p) => p.lead_id))];
  const heads: PairHead[] = [];
  for (let i = 0; i < strongLeads.length; i += 50) {
    const ids = strongLeads.slice(i, i + 50);
    heads.push(...await selectAllRows<PairHead>(async (from, to) => {
      const res = await sb.from("catering_toast_decision_heads").select("id,lead_id,kind,location_id,order_guid,check_guid")
        .in("lead_id", ids).eq("location_id", locationId).order("id").range(from, to);
      if (res.error) raise(res.error);
      return res;
    }));
  }
  return oldOrderMatches({ status, plan, heads });
}

async function shopIsOn(sb: Sb, locationId: string): Promise<boolean> {
  const { data, error } = await sb.from("catering_toast_settings").select("enabled").eq("location_id", locationId).maybeSingle<{ enabled: boolean }>();
  if (error) raise(error);
  return data?.enabled === true;
}

export async function loadOldOrders(actor: AuthContext, locationId: string, deps: { client?: Sb; now?: Date } = {}): Promise<OldOrdersView> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  try {
    if (!await shopIsOn(sb, locationId)) return EMPTY_OLD_ORDERS("off");
    if (await linkStepReady(sb) !== "ready") return EMPTY_OLD_ORDERS("not_installed");
    return oldOrdersView(await matchesFor(sb, locationId, deps.now ?? new Date()));
  } catch (error) {
    if (error instanceof CateringToastNotInstalled) return EMPTY_OLD_ORDERS("not_installed");
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
}

/**
 * One batch: recompute the matches, skip the `skip` first (the ones the writer refused in earlier batches), then link
 * up to OLD_ORDERS_BATCH of them, each through the one writer as THIS person. A refusal (someone decided meanwhile,
 * ezCater took the check, the shop went off) is counted by its name and the batch goes on. `remaining` = what is left
 * after this batch.
 */
export async function linkOldOrders(actor: AuthContext, locationId: string, skip: number,
  deps: { client?: Sb; now?: Date; deadlineAt?: number; decide?: typeof decideCateringToastLink } = {}): Promise<OldOrdersLinkResult> {
  assertRole(actor);
  const sb = deps.client ?? getServiceRoleClient();
  const decide = deps.decide ?? decideCateringToastLink;
  let matches: OldOrderMatches;
  try {
    if (!await shopIsOn(sb, locationId)) throw new CateringToastSettingsError(409, "switch_needs_enabled");
    if (await linkStepReady(sb) !== "ready") throw new CateringToastSettingsError(409, "link_step_not_installed");
    matches = await matchesFor(sb, locationId, deps.now ?? new Date());
  } catch (error) {
    if (error instanceof CateringToastSettingsError) throw error;
    throw new CateringToastSettingsError(503, "settings_unavailable");
  }
  const out: OldOrdersLinkResult = { linked: 0, refused: {}, remaining: 0 };
  let attempted = 0;
  for (const m of matches.matches.slice(skip, skip + OLD_ORDERS_BATCH)) {
    if (deps.deadlineAt && Date.now() >= deps.deadlineAt) break;
    attempted += 1;
    try {
      await decide(actor, m.leadId, { kind: "link", locationId, orderGuid: m.orderGuid, checkGuid: m.checkGuid, reasonCode: null, expectedHeadId: m.expectedHeadId });
      out.linked += 1;
    } catch (error) {
      const code = error instanceof CateringPipelineError ? error.code : "generic";
      out.refused[code] = (out.refused[code] ?? 0) + 1;
    }
  }
  out.remaining = Math.max(0, matches.matches.length - skip - attempted);
  return out;
}
