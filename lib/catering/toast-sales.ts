/**
 * Toast sales ingest + depletion projection (read-track 2). SERVER-ONLY,
 * service-role; level floors AND the location bind re-checked here (see
 * assertLocationAccess — neither floor is all-locations), Tier-A step-up at
 * the routes.
 *
 * Ledger law: toast_sales_events is APPEND-ONLY and snapshot-versioned per
 * (location, check, selection) — a re-pull appends version+1 only when the
 * selection state changed (quantity/void/price/name); voids arrive as new
 * versions. Depletion is a DERIVED projection (latest non-void versions →
 * exclusions → crosswalk → graph engines) — no stored on-hand is ever mutated.
 *
 * Double-count rule (Juan 2026-07-23, catering is MIXED): admin-curated
 * toast_ingest_exclusions decide which Toast lines are "regular sales";
 * excluded parents exclude their modifier children; a suspected-catering
 * advisory keeps misconfiguration visible. Outside-platform catering that
 * never touches Toast or CO-OPS is a NAMED gap until spec #2b's punch-in.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { fetchToastOrders } from "@/lib/toast/orders";
import { fetchToastMenuItems } from "@/lib/toast/menus";
import { fetchDiningOptionNames } from "@/lib/toast/config";
import { selectionChanged, type ToastSaleLine } from "@/lib/toast/orders-shared";
import {
  matchesExclusion, SUSPECT_NAME_RE, SUSPECT_CHECK_QTY,
  type IngestExclusion, type ExclusionTarget,
} from "./toast-sales-shared";
import { loadRecipeGraph } from "@/lib/prep-consumption";
import { recordResolutionFlipsForLocation } from "@/lib/products";
import { salesSignalsReady } from "@/lib/dynamic-pars-probes";
import {
  perUnitSkuOzForItemFromGraph, perUnitDirectSkuOzForMenuItem, firstLevelItemConsumption,
} from "@/lib/prep-consumption-graph";
import { modifierParUnits, removalAmount, skuPortionOz } from "@/lib/toast/modifiers-shared";
import {
  selectAssortmentPool, evenMixPerOption, MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS,
  type AssortmentKind,
} from "@/lib/toast/platter-shared";

export const TOAST_SALES_WRITE_MIN = 7; // GM+ — pull + exclusions (mirrors toast-map)
export const TOAST_SALES_READ_MIN = 6;  // AGM+ — consumption readout (prep-demand page floor)

export class AdminToastSalesError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminToastSalesError";
  }
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) throw new AdminToastSalesError(403, "forbidden", "Insufficient role level");
}

/**
 * Location-access IDOR bind (wiring audit 2026-08-29).
 *
 * This module had ZERO location scoping. Its floors are level 7 (write) and 6 (read),
 * and NEITHER is all-locations — `lockLocationContext` grants that at 9 — so the level
 * check alone never said WHICH shop an actor was acting on. Prod carries two active GMs
 * today, each assigned to exactly ONE location, so this is not masked by a solo
 * all-locations admin the way its sibling was when the same class was found there.
 *
 * lib/admin/toast-map.ts closed this exact class as a council P1 on 2026-07-31 and its
 * fix stopped at its own module boundary; toast-sales never got the same treatment even
 * though it writes the SALES LEDGER that feeds depletion, counts' drift and Dynamic Pars.
 * Same helper shape, same 403, deliberately — one spelling of "you do not manage that
 * location" across the Toast surfaces.
 *
 * The ACTOR-LESS cores (`doPull`, `deriveSalesConsumption`, `loadActiveExclusions`) take
 * no bind and must not: the cron and the mid-shift system triggers iterate every location
 * by design, and there is no actor there to bind.
 */
function assertLocationAccess(actor: AuthContext, locationId: string): void {
  if (!lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) {
    throw new AdminToastSalesError(403, "forbidden", "You do not manage that location");
  }
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
function requireYmd(d: string): void {
  if (!YMD_RE.test(d) || Number.isNaN(Date.parse(d))) throw new AdminToastSalesError(400, "invalid_date", "businessDate must be YYYY-MM-DD");
}

interface LedgerRow {
  check_guid: string; selection_guid: string; parent_selection_guid: string | null;
  toast_item_guid: string; item_name: string; quantity: number | string;
  price_cents: number | null; voided: boolean; dining_option: string | null;
  menu_group: string | null; snapshot_version: number;
}

/**
 * Latest snapshot version per (check, selection) for one location-day.
 *
 * PAGED, AND THE CAP WAS ALREADY BITING IN PRODUCTION (wiring audit 2026-08-29 — this
 * is a live incident write-up, not a hardening). This read had no `.order()`/`.range()`,
 * so it silently returned the first 1000 rows (the PR #63 class). CO crosses 1000
 * selections on a busy day at one shop: P Street logged 1158 rows on 2026-08-08, 1062 on
 * 2026-08-09 and 1001 on 2026-07-25.
 *
 * WHAT THE TRUNCATION DID, END TO END. `doPull` treats "not in this map" as "never
 * seen", so the ~158 dropped selections were re-derived at `snapshot_version: 1` — which
 * already exists — and the insert hit the UNIQUE (location, check, selection, version)
 * constraint. 23505 is mapped to a 409 `concurrent_pull`, so the WHOLE location aborted:
 * `pullSalesForAllLocations` recorded ok:false, the cron skipped that location's
 * `materializeDailyDepletion` AND its par run, and the day's depletion for that shop
 * stayed frozen at whatever an earlier, equally-truncated run had written. The audit log
 * shows it happening four times — the 2026-08-28 and 2026-08-29 backfills each failed on
 * exactly those two P-Street days and on no others, every time under a `cron.success`
 * row carrying `per_location_failures: 1` (see the ops-health fix in this same PR: that
 * counter is why nobody saw it).
 *
 * The second lane is quieter and worse: `deriveSalesConsumption` reads the same map, so
 * on any day over the cap it resolves consumption from an ARBITRARY 1000-row subset and
 * writes understated `direct_oz` into toast_daily_depletion — the exact term counts'
 * drift sums — with no error anywhere.
 *
 * `.order("id")` is the house's stable total order for paging (the PK; same treatment
 * `loadAdoption` gives audit_log). The page callback THROWS on a read error rather than
 * taking `selectAllRows`' silent `data ?? []`: an empty map here does not degrade, it
 * re-inserts the whole day at version 1.
 */
async function loadLatestVersions(locationId: string, businessDate: string): Promise<Map<string, LedgerRow>> {
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<LedgerRow>(async (from, to) => {
    const { data, error } = await sb.from("toast_sales_events")
      .select("check_guid, selection_guid, parent_selection_guid, toast_item_guid, item_name, quantity, price_cents, voided, dining_option, menu_group, snapshot_version")
      .eq("location_id", locationId).eq("business_date", businessDate)
      .order("id", { ascending: true })
      .range(from, to)
      .returns<LedgerRow[]>();
    if (error) throw new Error(`toast-sales ledger read: ${error.message}`);
    return { data };
  });
  const latest = new Map<string, LedgerRow>();
  for (const r of rows) {
    const key = `${r.check_guid}:${r.selection_guid}`;
    const cur = latest.get(key);
    if (!cur || r.snapshot_version > cur.snapshot_version) latest.set(key, r);
  }
  return latest;
}

async function resolveLocationGuid(locationId: string): Promise<string> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id, toast_restaurant_guid")
    .eq("id", locationId).eq("active", true)
    .maybeSingle<{ id: string; toast_restaurant_guid: string | null }>();
  if (error) throw new Error(`toast-sales location: ${error.message}`);
  if (!data) throw new AdminToastSalesError(404, "location_not_found", "Location not found");
  return data.toast_restaurant_guid ?? ""; // fixture mode tolerates empty
}

export interface PullResult { selections: number; appended: number; unchanged: number; voids: number }

/** Core pull (shared by admin route + cron + system triggers). actor null =
 * system context; `systemContext` names WHICH system path in the audit row
 * ("cron" default · "closing_confirm" · "midshift_on_visit"). */
async function doPull(
  locationId: string,
  businessDate: string,
  actor: AuthContext | null,
  systemContext: string = "cron",
): Promise<PullResult> {
  requireYmd(businessDate);
  const guid = await resolveLocationGuid(locationId);
  const [lines, menuItems, diningNames, latest] = await Promise.all([
    fetchToastOrders(guid, businessDate),
    fetchToastMenuItems(guid),
    fetchDiningOptionNames(guid), // orders carry bare diningOption refs — names live in the config API
    loadLatestVersions(locationId, businessDate),
  ]);
  const groupByGuid = new Map(menuItems.map((m) => [m.itemGuid, m.groupName]));

  const inserts: Array<Record<string, unknown>> = [];
  let unchanged = 0, voids = 0;
  for (const line of lines) {
    if (line.voided) voids += 1;
    const key = `${line.checkGuid}:${line.selectionGuid}`;
    const prev = latest.get(key);
    if (prev && !selectionChanged(
      { quantity: Number(prev.quantity), voided: prev.voided, priceCents: prev.price_cents, itemName: prev.item_name },
      line,
    )) { unchanged += 1; continue; }
    inserts.push({
      location_id: locationId,
      business_date: businessDate,
      check_guid: line.checkGuid,
      selection_guid: line.selectionGuid,
      parent_selection_guid: line.parentSelectionGuid,
      toast_item_guid: line.itemGuid,
      item_name: line.displayName,
      quantity: line.quantity,
      price_cents: line.priceCents,
      voided: line.voided,
      dining_option: line.diningOptionGuid != null
        ? (diningNames.get(line.diningOptionGuid) ?? line.diningOptionGuid)
        : null,
      menu_group: groupByGuid.get(line.itemGuid) ?? null,
      snapshot_version: (prev?.snapshot_version ?? 0) + 1,
      created_by: actor?.user.id ?? null,
    });
  }
  if (inserts.length > 0) {
    const sb = getServiceRoleClient();
    const { error } = await sb.from("toast_sales_events").insert(inserts);
    if (error) {
      // Unique-violation = a concurrent pull already appended these versions
      // (cron + manual racing). Data is intact; degrade to a typed retryable.
      if (error.code === "23505") throw new AdminToastSalesError(409, "concurrent_pull", "Another pull just ran — refresh and retry");
      throw new Error(`toast-sales append: ${error.message}`);
    }
  }
  void audit({
    actorId: actor?.user.id ?? null,
    actorRole: actor?.user.role ?? null,
    action: "toast_sales.pull",
    resourceTable: "toast_sales_events",
    resourceId: locationId,
    metadata: {
      business_date: businessDate, selections: lines.length, appended: inserts.length,
      unchanged, voids, ...(actor ? {} : { actor_context: systemContext }),
    },
    ipAddress: null, userAgent: null,
  });
  return { selections: lines.length, appended: inserts.length, unchanged, voids };
}

export async function pullSales(actor: AuthContext, locationId: string, businessDate: string): Promise<PullResult> {
  requireLevel(actor, TOAST_SALES_WRITE_MIN);
  assertLocationAccess(actor, locationId); // before any I/O — a refused pull touches nothing
  return doPull(locationId, businessDate, actor);
}

/** Cron entry: pull for every active location with a Toast GUID. Never throws per-location. */
export async function pullSalesForAllLocations(businessDate: string): Promise<Array<{ locationId: string; ok: boolean; error?: string; result?: PullResult }>> {
  requireYmd(businessDate);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("locations").select("id, toast_restaurant_guid").eq("active", true)
    .not("toast_restaurant_guid", "is", null)
    .returns<Array<{ id: string; toast_restaurant_guid: string }>>();
  if (error) throw new Error(`toast-sales cron locations: ${error.message}`);
  const out: Array<{ locationId: string; ok: boolean; error?: string; result?: PullResult }> = [];
  for (const loc of data ?? []) {
    try {
      out.push({ locationId: loc.id, ok: true, result: await doPull(loc.id, businessDate, null) });
    } catch (e) {
      out.push({ locationId: loc.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ─── System pull triggers (mid-shift pulse, council 2026-07-31) ──────────────

/**
 * Best-effort system-triggered pull for ONE location — the same-day lanes of
 * the mid-shift pulse. NEVER throws (runs inside next/server after(), post-
 * response; a Toast hiccup must not surface anywhere user-facing). Skips
 * locations without a Toast GUID. The actorless path is a DELIBERATE call
 * (council 2026-07-31, Fable seat): the trigger's effect is read-only ingest
 * on behalf of a viewer below TOAST_SALES_WRITE_MIN, debounced upstream, and
 * audited with a distinct actor_context.
 *
 * System triggers are EVENTS-ONLY — they NEVER materialize the depletion
 * ledger (adversarial review 2026-07-31 C1): the nightly T-1 cron is the SOLE
 * ledger materializer, so a ledger row can only ever describe a CLOSED
 * business day. An open-day row — even from a "day is over" closing confirm —
 * is one wrong-tap away from a partial row that drift would read as trusted
 * (the open date is excluded from gap-taint by design), silently overstating
 * on-hand. Display reads events; drift reads final-day ledger rows. Law.
 *
 * A FAILED attempt writes a `toast_sales.pull_failed` audit row (review C2):
 * the on-visit debounce keys off the latest pull attempt — success OR failure
 * — so a Toast outage cannot storm the API on every page load.
 */
export async function pullSalesSystemTrigger(
  locationId: string,
  businessDate: string,
  opts: { context: "closing_confirm" | "midshift_on_visit" },
): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    const { data } = await sb
      .from("locations")
      .select("toast_restaurant_guid")
      .eq("id", locationId)
      .maybeSingle<{ toast_restaurant_guid: string | null }>();
    if (!data?.toast_restaurant_guid) return; // no Toast at this location — no-op
    await doPull(locationId, businessDate, null, opts.context);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[toast-sales ${opts.context}] pull failed for ${locationId} ${businessDate}:`, msg);
    // Failure marker (fail-open like all audits): debounces retry attempts
    // during an outage and gives the admin hub a forensic trail.
    void audit({
      actorId: null,
      actorRole: null,
      action: "toast_sales.pull_failed",
      resourceTable: "toast_sales_events",
      resourceId: locationId,
      metadata: {
        business_date: businessDate,
        actor_context: opts.context,
        error: msg.length > 500 ? `${msg.slice(0, 500)}…` : msg,
      },
      ipAddress: null,
      userAgent: null,
    });
  }
}

/** Debounce window for the mid-shift on-visit refresh. */
const ON_VISIT_DEBOUNCE_MS = 45 * 60 * 1000;

/**
 * Mid-shift on-visit freshness trigger: pull today's events IF the last pull
 * ATTEMPT for this location is older than the debounce window (or was for a
 * different business date). The marker is the latest `toast_sales.pull` OR
 * `toast_sales.pull_failed` audit row — independent of whether rows were
 * inserted (a zero-sales morning doesn't re-pull per load) AND of outcome
 * (a Toast outage doesn't storm the API per load — review C2). Best-effort;
 * never throws.
 */
export async function maybeRefreshTodaySales(locationId: string, businessDate: string): Promise<void> {
  try {
    const sb = getServiceRoleClient();
    // `occurred_at`, NOT `created_at` — audit_log has no created_at column, and this
    // read has been 400-ing since it shipped (SIM-PI-4, found by the product-identity
    // sim day 2026-08-21 while chasing the same misspelling in lib/products.ts). The
    // error is not checked, so `data` came back null and `attemptedRecently` was
    // ALWAYS false: the 45-minute debounce never debounced anything and every single
    // /mid-shift render fired a fresh Toast pull. Pre-existing and outside the
    // product-identity arc; fixed here because it is the same one-token defect, it is
    // hitting a third-party API on every page load, and it was proven live.
    const { data, error } = await sb
      .from("audit_log")
      .select("occurred_at, metadata")
      .in("action", ["toast_sales.pull", "toast_sales.pull_failed"])
      .eq("resource_id", locationId)
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ occurred_at: string; metadata: { business_date?: string } | null }>();
    if (error) {
      // A failed debounce READ must not be read as "no recent attempt" — that is what
      // turned this into a pull-per-render. Skip the trigger and let the next visit
      // (or the cron) decide with real evidence.
      console.error(`[toast-sales midshift_on_visit] debounce read failed for ${locationId}:`, error.message);
      return;
    }
    const attemptedRecently =
      data != null &&
      data.metadata?.business_date === businessDate &&
      Date.now() - new Date(data.occurred_at).getTime() < ON_VISIT_DEBOUNCE_MS;
    if (attemptedRecently) return;
    await pullSalesSystemTrigger(locationId, businessDate, { context: "midshift_on_visit" });
  } catch (e) {
    console.error(
      `[toast-sales midshift_on_visit] debounce check failed for ${locationId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

// ─── Daily depletion materializer (drift spec 2026-07-31) ────────────────────

/**
 * Materialize one (location, business_date) day of the sales-consumption
 * derivation into toast_daily_depletion — the cache counts' drift reads
 * (SUM(direct_oz) over the anchor window; flattened_oz stored for transparency,
 * never summed into drift — the double-count law). Idempotent: deletes the
 * day's rows, re-derives, re-inserts — safe on re-pulls and void revisions.
 * Actor-less (cron/backfill path); audited with actor_context "cron".
 */
export async function materializeDailyDepletion(
  locationId: string,
  businessDate: string,
): Promise<{ rows: number }> {
  requireYmd(businessDate);
  const consumption = await deriveSalesConsumption(locationId, businessDate);
  const rows = consumption.skuConsumed
    .filter((r) => r.directOz > 0 || r.flattenedOz > 0)
    .map((r) => ({
      location_id: locationId,
      business_date: businessDate,
      sku_id: r.skuId,
      direct_oz: r.directOz,
      flattened_oz: r.flattenedOz,
    }));

  const sb = getServiceRoleClient();
  const { error: delErr } = await sb.from("toast_daily_depletion")
    .delete().eq("location_id", locationId).eq("business_date", businessDate);
  if (delErr) throw new Error(`toast-depletion delete-day: ${delErr.message}`);
  if (rows.length > 0) {
    const { error: insErr } = await sb.from("toast_daily_depletion").insert(rows);
    if (insErr) throw new Error(`toast-depletion insert: ${insErr.message}`);
  }

  // ── The day-grain catering marker (Dynamic Pars, plan D4) ────────────────────
  // WHY HERE AND NOT IN THE FILTER. `consumption.suspectedCatering` is computed BELOW,
  // AFTER skuDirect has been summed over every counted line. Excluding suspect checks from
  // that aggregation would change what direct_oz MEANS — the one lane the double-count law
  // protects. So the detector's verdict is recorded BESIDE the day and the velocity layer
  // reads it; direct_oz and flattened_oz are byte-identical to before this block existed.
  // Same delete-then-insert scope as the ledger above, so a re-pull is idempotent for free.
  //
  // Probe-gated (0182 / GATE M1): pre-apply this is a SILENT NO-OP, not a per-night error
  // log. Velocity then reads no signal row, clamps to `signals_too_new`, and emits an
  // honest null — the degradation the layer was designed around.
  if (await salesSignalsReady(sb)) {
    const suspectQty = consumption.suspectedCatering.reduce((n, c) => n + c.totalQty, 0);
    const countedQty = consumption.soldLines.reduce((n, l) => n + l.quantity, 0);
    const { error: sigDelErr } = await sb.from("toast_daily_sales_signals")
      .delete().eq("location_id", locationId).eq("business_date", businessDate);
    if (sigDelErr) {
      // NON-FATAL by design: the signal is a velocity input, not a ledger. Losing it degrades
      // velocity to "signals_too_new" for that day, which is an honest null, and must never
      // fail the materialization the drift engine depends on.
      console.error(`[toast-depletion] sales-signal delete failed: ${sigDelErr.message}`);
    } else {
      const { error: sigInsErr } = await sb.from("toast_daily_sales_signals").insert({
        location_id: locationId,
        business_date: businessDate,
        suspect_check_count: consumption.suspectedCatering.length,
        suspect_qty: suspectQty,
        counted_qty: countedQty,
      });
      if (sigInsErr) console.error(`[toast-depletion] sales-signal insert failed: ${sigInsErr.message}`);
    }
  }

  void audit({
    actorId: null, actorRole: null,
    action: "toast_depletion.materialize", resourceTable: "toast_daily_depletion", resourceId: locationId,
    metadata: { business_date: businessDate, rows: rows.length, actor_context: "cron" },
    ipAddress: null, userAgent: null,
  });
  // Resolution-flip trail (spec: "why did ham cost move Tuesday" always has an
  // answer). Placed on THE ONE writer that already runs once a day per location —
  // never on loadRecipeGraph, which is a hot read path on nine callers. One row per
  // real flip, zero rows on a normal day, zero queries with no product pins.
  // fail-open + `void`: forensic, and it may never fail the materialization.
  void recordResolutionFlipsForLocation(locationId);
  return { rows: rows.length };
}

// ─── Exclusions (append-only active-flag config) ─────────────────────────────

export interface ExclusionView extends IngestExclusion { createdAt: string }

export async function listExclusions(actor: AuthContext): Promise<ExclusionView[]> {
  requireLevel(actor, TOAST_SALES_READ_MIN);
  return loadActiveExclusions();
}

/** Actor-less exclusions core (the cron/backfill materializer path — mirrors
 *  the doPull(…, actor|null) convention). */
async function loadActiveExclusions(): Promise<ExclusionView[]> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_ingest_exclusions")
    .select("id, location_id, kind, value, note, created_at").eq("active", true)
    .order("created_at", { ascending: true })
    .returns<Array<{ id: string; location_id: string | null; kind: IngestExclusion["kind"]; value: string; note: string | null; created_at: string }>>();
  if (error) throw new Error(`toast-sales exclusions: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id, locationId: r.location_id, kind: r.kind, value: r.value, note: r.note, createdAt: r.created_at }));
}

const KINDS = new Set(["dining_option", "menu_group", "toast_item_guid", "item_name_contains"]);

export async function addExclusion(
  actor: AuthContext,
  input: { locationId: string | null; kind: string; value: string; note?: string | null },
): Promise<{ id: string }> {
  requireLevel(actor, TOAST_SALES_WRITE_MIN);
  if (!KINDS.has(input.kind)) throw new AdminToastSalesError(400, "invalid_kind", "Unknown exclusion kind");
  const value = input.value.trim();
  if (value.length === 0 || value.length > 200) throw new AdminToastSalesError(400, "invalid_value", "Value required (≤200 chars)");
  // A TARGETED exclusion binds its target. `locationId: null` is the GLOBAL row (null =
  // every location, per matchesExclusion) and is deliberately left at the level floor:
  // whether a shop-scoped GM may author business-wide ingest config is an authority
  // question for Juan, not a bind, and today's UI only ever sends null — silently moving
  // that to level 9 would take a working 6 AM button away from both GMs. Flagged, not
  // changed. What IS closed here is the cross-shop write the audit named.
  if (input.locationId != null) assertLocationAccess(actor, input.locationId);
  const sb = getServiceRoleClient();
  const { data, error } = await sb.from("toast_ingest_exclusions")
    .insert({ location_id: input.locationId, kind: input.kind, value, note: input.note ?? null, created_by: actor.user.id })
    .select("id").maybeSingle<{ id: string }>();
  if (error) throw new Error(`toast-sales exclusion insert: ${error.message}`);
  if (!data) throw new Error("toast-sales exclusion insert returned no row");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_sales.exclusion_add", resourceTable: "toast_ingest_exclusions", resourceId: data.id,
    metadata: { location_id: input.locationId, kind: input.kind, value },
    ipAddress: null, userAgent: null,
  });
  return { id: data.id };
}

export async function deactivateExclusion(actor: AuthContext, id: string): Promise<void> {
  requireLevel(actor, TOAST_SALES_WRITE_MIN);
  const sb = getServiceRoleClient();
  // Load-then-bind (the `mapId` shape of lib/admin/toast-map.ts's bind): an opaque id says
  // nothing about WHOSE ingest this exclusion reshapes, so the row's own location is what
  // gets authorized. A global row (location_id null) keeps the level floor — same
  // deliberate carve-out, and same flag, as addExclusion above.
  const { data: row, error: loadErr } = await sb.from("toast_ingest_exclusions")
    .select("id, location_id").eq("id", id).eq("active", true)
    .maybeSingle<{ id: string; location_id: string | null }>();
  if (loadErr) throw new Error(`toast-sales exclusion load: ${loadErr.message}`);
  if (!row) throw new AdminToastSalesError(404, "not_found", "Exclusion not found");
  if (row.location_id != null) assertLocationAccess(actor, row.location_id);
  const { error, count } = await sb.from("toast_ingest_exclusions")
    .update({ active: false }, { count: "exact" }).eq("id", id).eq("active", true);
  if (error) throw new Error(`toast-sales exclusion deactivate: ${error.message}`);
  // Rowcount check stays (UPDATE denials are silent): the load above proves the row was
  // active a moment ago, so a 0 here is a concurrent deactivation, not a bad id.
  if (count === 0) throw new AdminToastSalesError(404, "not_found", "Exclusion not found");
  void audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "toast_sales.exclusion_remove", resourceTable: "toast_ingest_exclusions", resourceId: id,
    metadata: {}, ipAddress: null, userAgent: null,
  });
}

// ─── Consumption projection (derived; advisory) ──────────────────────────────

export interface SalesConsumption {
  soldLines: Array<{ name: string; quantity: number; kind: "menu_item" | "item" | "package" }>;
  prepConsumed: Array<{ itemId: string; name: string; units: number; removedUnits: number }>;
  /** oz = directOz + flattenedOz. directOz = at-sale consumption (the ONLY lane
   *  that may feed counts' drift — the double-count law, drift spec 2026-07-31);
   *  flattenedOz = production-covered raw SKUs via the item flatten (display/
   *  forecast only). */
  skuConsumed: Array<{ skuId: string; name: string; oz: number; directOz: number; flattenedOz: number; removedOz: number }>;
  unmappedToastItems: Array<{ name: string; quantity: number; toastItemGuid: string; isModifier: boolean }>;
  excludedCount: number;
  suspectedCatering: Array<{ checkGuid: string; diningOption: string | null; totalQty: number; reason: "name" | "quantity" }>;
  /** Modifier lane (spec 2026-07-24): applications counted / subtracted / skipped. */
  modifierStats: { depleted: number; removed: number; ignored: number; portionNeeded: Array<{ name: string; quantity: number }> };
  /** Platter lane (spec 2026-07-25): package composition gaps that block full depletion. */
  packageIssues: Array<{ name: string; issue: "empty_pool" | "freeform_line" }>;
}

export async function salesConsumption(actor: AuthContext, locationId: string, businessDate: string): Promise<SalesConsumption> {
  requireLevel(actor, TOAST_SALES_READ_MIN);
  assertLocationAccess(actor, locationId);
  return deriveSalesConsumption(locationId, businessDate);
}

/** Actor-less derivation core — the admin surface gates via salesConsumption;
 *  the daily-depletion materializer (cron/backfill) calls this directly. */
export async function deriveSalesConsumption(locationId: string, businessDate: string): Promise<SalesConsumption> {
  requireYmd(businessDate);
  const sb = getServiceRoleClient();
  const [latest, exclusions] = await Promise.all([
    loadLatestVersions(locationId, businessDate),
    loadActiveExclusions(),
  ]);

  const live = [...latest.values()].filter((r) => !r.voided);

  // Exclusion pass + parent propagation (modifiers of an excluded parent are excluded).
  const excluded = new Set<string>();
  for (const r of live) {
    const target: ExclusionTarget = {
      locationId, diningOption: r.dining_option, menuGroup: r.menu_group,
      toastItemGuid: r.toast_item_guid, itemName: r.item_name,
    };
    if (matchesExclusion(target, exclusions)) excluded.add(r.selection_guid);
  }
  for (let i = 0; i < 3; i += 1) { // modifier depth is ≤2 in practice; fixpoint loop is cheap
    for (const r of live) {
      if (r.parent_selection_guid && excluded.has(r.parent_selection_guid)) excluded.add(r.selection_guid);
    }
  }
  const counted = live.filter((r) => !excluded.has(r.selection_guid));

  // Crosswalk resolution (confirmed, active). Three lanes since the platter
  // spec 2026-07-25: base entities (menu_item/item/PACKAGE), assortment
  // markers (modifier guid → pool behavior), and portioned modifiers
  // (item- or menu_item-target).
  const { data: mapRows, error: mErr } = await sb.from("toast_menu_map")
    .select("menu_item_id, item_id, package_id, sku_id, toast_item_guid, is_modifier, disposition, portion_qty, portion_unit")
    .eq("location_id", locationId).eq("active", true).eq("match_status", "confirmed")
    .returns<Array<{ menu_item_id: string | null; item_id: string | null; package_id: string | null; sku_id: string | null; toast_item_guid: string; is_modifier: boolean; disposition: "deplete" | "remove" | "ignore" | "assortment_full" | "assortment_classics"; portion_qty: number | string | null; portion_unit: string | null }>>();
  if (mErr) throw new Error(`toast-sales crosswalk: ${mErr.message}`);
  const entityByGuid = new Map(
    (mapRows ?? []).filter((m) => !m.is_modifier && (m.menu_item_id ?? m.item_id ?? m.package_id) != null)
      .map((m) => [m.toast_item_guid, m.menu_item_id != null
        ? { kind: "menu_item" as const, id: m.menu_item_id }
        : m.item_id != null
          ? { kind: "item" as const, id: m.item_id }
          : { kind: "package" as const, id: m.package_id! }]),
  );
  const assortmentByGuid = new Map<string, AssortmentKind>(
    (mapRows ?? []).filter((m) => m.is_modifier && (m.disposition === "assortment_full" || m.disposition === "assortment_classics"))
      .map((m) => [m.toast_item_guid, m.disposition === "assortment_classics" ? "classics" as const : "full" as const]),
  );
  const modifierByGuid = new Map(
    (mapRows ?? [])
      .filter((m) => m.is_modifier && (m.item_id != null || m.menu_item_id != null || m.sku_id != null))
      .map((m) => [m.toast_item_guid, {
        targetKind: m.item_id != null ? ("item" as const) : m.menu_item_id != null ? ("menu_item" as const) : ("sku" as const),
        targetId: (m.item_id ?? m.menu_item_id ?? m.sku_id)!,
        disposition: m.disposition,
        portionQty: m.portion_qty != null ? Number(m.portion_qty) : null,
        portionUnit: m.portion_unit,
      }]),
  );

  const baseLines = counted.filter((r) => r.parent_selection_guid == null);
  const modifierLines = counted.filter((r) => r.parent_selection_guid != null);

  const qtyByEntity = new Map<string, { kind: "menu_item" | "item" | "package"; id: string; quantity: number }>();
  const unmapped = new Map<string, { name: string; quantity: number; isModifier: boolean }>();
  // Package sales keep PER-SELECTION grain: the assortment pick is a child of
  // the specific platter line, so two platters on one check resolve distinctly.
  const packageSales: Array<{ packageId: string; qty: number; selectionGuid: string }> = [];
  for (const r of baseLines) {
    const qty = Number(r.quantity);
    if (assortmentByGuid.has(r.toast_item_guid)) continue; // structural marker mis-rung as a base line — mapped, no demand of its own
    const ent = entityByGuid.get(r.toast_item_guid);
    if (!ent) {
      const u = unmapped.get(r.toast_item_guid) ?? { name: r.item_name, quantity: 0, isModifier: false };
      u.quantity += qty;
      unmapped.set(r.toast_item_guid, u);
      continue;
    }
    if (ent.kind === "package") packageSales.push({ packageId: ent.id, qty, selectionGuid: r.selection_guid });
    const key = `${ent.kind}:${ent.id}`;
    const cur = qtyByEntity.get(key);
    if (cur) cur.quantity += qty; else qtyByEntity.set(key, { ...ent, quantity: qty });
  }

  // ── Graph load once. BOTH lanes accumulate SIGNED before their clamp:
  //    menuItemUnits (whole subs) takes bases + platter spreads + menu_item
  //    modifiers, then clamps and flattens (direct SKUs + first-level items);
  //    itemUnits takes item bases + platter item options + item modifiers,
  //    then clamps and flattens to SKUs. Flatten stays split direct/first-level
  //    (PR #180 invariant: recombination === full flatten, no 2× SKUs). ─────
  // locationId scopes product resolution (0179): this shop's primary designation,
  // its activation overlay and its receipt history — never another shop's.
  const graph = await loadRecipeGraph({ locationId });
  const menuItemUnits = new Map<string, number>();   // signed whole-sub units per menu_item
  const itemUnits = new Map<string, number>();       // signed par-units per item
  const removedByItem = new Map<string, number>();   // visible removal truth
  // THE DOUBLE-COUNT LAW (drift spec 2026-07-31): the two SKU lanes stay SPLIT.
  // skuDirect = SKUs consumed AT SALE (menu_item direct inputs + SKU-modifiers)
  //   — the only lane that may feed counts' drift (raw stock leaves the shelf
  //   here OR at production, never both).
  // skuFlattened = raw SKUs reached by flattening ITEM par-units through the
  //   recipe graph — those SKUs deplete at PRODUCTION (production_inputs);
  //   this lane is display/forecast truth only and must NEVER feed drift.
  const skuDirect = new Map<string, number>();
  const skuFlattened = new Map<string, number>();
  // SKU-target modifiers (Part 2): a raw SKU with no prep item (Sub Roll for a
  // salad "No bread"; Arugula/Pepperoncini/Dijon). Applications are collected
  // here (portion + sign) and converted to oz AFTER the SKU avg_oz_per_each
  // batch-load in the names phase — no per-row queries in the loop.
  const skuModApplications: Array<{ skuId: string; portion: { qty: number; unit: string | null }; sign: 1 | -1; qty: number; itemName: string }> = [];
  const packageIssues = new Map<string, { name: string; issue: "empty_pool" | "freeform_line" }>();
  for (const e of qtyByEntity.values()) {
    if (e.kind === "menu_item") menuItemUnits.set(e.id, (menuItemUnits.get(e.id) ?? 0) + e.quantity);
    else if (e.kind === "item") itemUnits.set(e.id, (itemUnits.get(e.id) ?? 0) + e.quantity);
    // packages resolve below at per-sale grain
  }

  // ── Platter lane (spec 2026-07-25): a package sale resolves its composition —
  //    fixed spine-linked lines deplete directly; a choice slot's whole subs
  //    (slot quantity, halves doctrine) spread EVEN-MIX across the pool the
  //    assortment pick selects (classics subset vs full enabled options). ────
  if (packageSales.length > 0) {
    const pkgIds = [...new Set(packageSales.map((p) => p.packageId))];
    const [{ data: pkgRows, error: pnErr }, { data: lineRows, error: plErr }] = await Promise.all([
      sb.from("catering_packages").select("id, label_en").in("id", pkgIds)
        .returns<Array<{ id: string; label_en: string }>>(),
      sb.from("catering_package_items")
        .select("id, package_id, slot_type, item_id, menu_item_id, quantity")
        .in("package_id", pkgIds).eq("active", true)
        .returns<Array<{ id: string; package_id: string; slot_type: string; item_id: string | null; menu_item_id: string | null; quantity: number | string }>>(),
    ]);
    if (pnErr) throw new Error(`toast-sales package names: ${pnErr.message}`);
    if (plErr) throw new Error(`toast-sales package lines: ${plErr.message}`);
    const pkgName = new Map((pkgRows ?? []).map((p) => [p.id, p.label_en]));
    const linesByPackage = new Map<string, NonNullable<typeof lineRows>>();
    for (const l of lineRows ?? []) {
      const arr = linesByPackage.get(l.package_id) ?? [];
      arr.push(l);
      linesByPackage.set(l.package_id, arr);
    }
    const choiceLineIds = (lineRows ?? []).filter((l) => l.slot_type === "choice").map((l) => l.id);
    const { data: optRows, error: poErr } = choiceLineIds.length
      ? await sb.from("catering_package_slot_options")
          .select("package_item_id, item_id, menu_item_id, classic")
          .in("package_item_id", choiceLineIds).eq("active", true)
          .returns<Array<{ package_item_id: string; item_id: string | null; menu_item_id: string | null; classic: boolean }>>()
      : { data: [], error: null };
    if (poErr) throw new Error(`toast-sales package options: ${poErr.message}`);
    const optsByLine = new Map<string, Array<{ item_id: string | null; menu_item_id: string | null; classic: boolean }>>();
    for (const o of optRows ?? []) {
      const arr = optsByLine.get(o.package_item_id) ?? [];
      arr.push(o);
      optsByLine.set(o.package_item_id, arr);
    }
    // The assortment pick rides as a MODIFIER child of the platter selection.
    const assortBySelection = new Map<string, AssortmentKind>();
    for (const r of modifierLines) {
      const kind = assortmentByGuid.get(r.toast_item_guid);
      if (kind != null && r.parent_selection_guid != null) {
        // classics wins a (weird) double-pick — the narrower pool is the safer read
        const prev = assortBySelection.get(r.parent_selection_guid);
        assortBySelection.set(r.parent_selection_guid, prev === "classics" ? prev : kind);
      }
    }
    for (const sale of packageSales) {
      const name = pkgName.get(sale.packageId) ?? "(package)";
      const lines = linesByPackage.get(sale.packageId) ?? [];
      if (lines.length === 0) { packageIssues.set(`${name}:empty_pool`, { name, issue: "empty_pool" }); continue; }
      for (const line of lines) {
        const lineQty = Number(line.quantity);
        if (line.slot_type === "choice") {
          const kind = assortBySelection.get(sale.selectionGuid) ?? "full"; // no pick punched → Our-Favorites behavior
          const pool = selectAssortmentPool(optsByLine.get(line.id) ?? [], kind);
          if (pool.length === 0) { packageIssues.set(`${name}:empty_pool`, { name, issue: "empty_pool" }); continue; }
          const per = evenMixPerOption(lineQty * sale.qty, pool.length);
          for (const o of pool) {
            if (o.menu_item_id != null) menuItemUnits.set(o.menu_item_id, (menuItemUnits.get(o.menu_item_id) ?? 0) + per);
            else if (o.item_id != null) itemUnits.set(o.item_id, (itemUnits.get(o.item_id) ?? 0) + per);
          }
        } else if (line.menu_item_id != null) {
          menuItemUnits.set(line.menu_item_id, (menuItemUnits.get(line.menu_item_id) ?? 0) + lineQty * sale.qty);
        } else if (line.item_id != null) {
          itemUnits.set(line.item_id, (itemUnits.get(line.item_id) ?? 0) + lineQty * sale.qty);
        } else {
          packageIssues.set(`${name}:freeform_line`, { name, issue: "freeform_line" });
        }
      }
    }
  }

  // ── Modifier lane (spec 2026-07-24; menu_item targets since 2026-07-25):
  //    deplete adds portion units; remove subtracts PARENT-AWARE amount (the
  //    parent sub recipe's own contribution) with portion fallback — Juan:
  //    removals COUNT. Assortment markers were consumed by the platter lane. ─
  const modifierStats = { depleted: 0, removed: 0, ignored: 0, portionNeeded: new Map<string, number>() };
  const parentGuidBySelection = new Map(counted.map((r) => [r.selection_guid, r.toast_item_guid]));
  for (const r of modifierLines) {
    const qty = Number(r.quantity);
    if (assortmentByGuid.has(r.toast_item_guid)) continue; // pool marker, not demand
    const mod = modifierByGuid.get(r.toast_item_guid);
    if (!mod) {
      const u = unmapped.get(r.toast_item_guid) ?? { name: r.item_name, quantity: 0, isModifier: true };
      u.quantity += qty;
      unmapped.set(r.toast_item_guid, u);
      continue;
    }
    if (mod.disposition === "ignore") { modifierStats.ignored += qty; continue; }
    if (mod.targetKind === "menu_item") {
      // Named-sub pick under a platter: portion is whole subs per application
      // (halves doctrine default 0.5) — no unit conversion needed.
      const wholeSubs = (mod.portionQty ?? MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS) * qty;
      if (mod.disposition === "deplete") {
        menuItemUnits.set(mod.targetId, (menuItemUnits.get(mod.targetId) ?? 0) + wholeSubs);
        modifierStats.depleted += qty;
      } else {
        menuItemUnits.set(mod.targetId, (menuItemUnits.get(mod.targetId) ?? 0) - wholeSubs);
        modifierStats.removed += qty;
      }
      continue;
    }
    if (mod.targetKind === "sku") {
      // Raw-SKU target (Part 2): a Sub Roll removed for salad conversion, or a
      // raw condiment added. Portion→oz needs the SKU's avg_oz_per_each, batch-
      // loaded in the names phase — collect the application now, convert after.
      if (mod.portionQty == null) { modifierStats.portionNeeded.set(r.item_name, (modifierStats.portionNeeded.get(r.item_name) ?? 0) + qty); continue; }
      skuModApplications.push({
        skuId: mod.targetId,
        portion: { qty: mod.portionQty, unit: mod.portionUnit },
        sign: mod.disposition === "deplete" ? 1 : -1,
        qty,
        itemName: r.item_name,
      });
      continue;
    }
    const portion = mod.portionQty != null ? { qty: mod.portionQty, unit: mod.portionUnit } : null;
    const portionUnits = portion != null ? modifierParUnits(graph, mod.targetId, portion) : null;
    if (mod.disposition === "deplete") {
      if (portionUnits == null) { modifierStats.portionNeeded.set(r.item_name, (modifierStats.portionNeeded.get(r.item_name) ?? 0) + qty); continue; }
      itemUnits.set(mod.targetId, (itemUnits.get(mod.targetId) ?? 0) + portionUnits * qty);
      modifierStats.depleted += qty;
    } else {
      // remove: parent-aware first, portion fallback.
      const parentToastGuid = r.parent_selection_guid != null ? parentGuidBySelection.get(r.parent_selection_guid) : undefined;
      const parentEnt = parentToastGuid != null ? entityByGuid.get(parentToastGuid) : undefined;
      const parentAmount = parentEnt?.kind === "menu_item" ? removalAmount(graph, parentEnt.id, mod.targetId) : null;
      const amount = parentAmount ?? portionUnits;
      if (amount == null) { modifierStats.portionNeeded.set(r.item_name, (modifierStats.portionNeeded.get(r.item_name) ?? 0) + qty); continue; }
      itemUnits.set(mod.targetId, (itemUnits.get(mod.targetId) ?? 0) - amount * qty);
      removedByItem.set(mod.targetId, (removedByItem.get(mod.targetId) ?? 0) + amount * qty);
      modifierStats.removed += qty;
    }
  }

  // ── Clamp menu_item whole-sub totals at ≥0, THEN flatten each unit exactly
  //    like a sold sub: DIRECT SKUs only + first-level item par-units (the
  //    item-ref SKUs flow through itemUnits — PR #180 review finding #1). ────
  for (const [menuItemId, units] of menuItemUnits) {
    const clamped = Math.max(units, 0);
    if (clamped > 0) {
      for (const [skuId, oz] of perUnitDirectSkuOzForMenuItem(graph, menuItemId)) skuDirect.set(skuId, (skuDirect.get(skuId) ?? 0) + oz * clamped);
      for (const [itemId, units2] of firstLevelItemConsumption(graph, menuItemId)) itemUnits.set(itemId, (itemUnits.get(itemId) ?? 0) + units2 * clamped);
    }
  }

  // ── Clamp per-item totals at ≥0, THEN flatten item par-units to SKUs. ─────
  const prep = new Map<string, number>();
  for (const [itemId, units] of itemUnits) {
    const clamped = Math.max(units, 0);
    prep.set(itemId, clamped);
    if (clamped > 0) {
      // FLATTENED lane — production-covered raw SKUs; never feeds drift.
      for (const [skuId, oz] of perUnitSkuOzForItemFromGraph(graph, itemId)) skuFlattened.set(skuId, (skuFlattened.get(skuId) ?? 0) + oz * clamped);
    }
  }

  // Names for entities, prep items, packages, and SKUs.
  const menuItemIds = [...qtyByEntity.values()].filter((e) => e.kind === "menu_item").map((e) => e.id);
  const itemIds = [...new Set([...prep.keys(), ...[...qtyByEntity.values()].filter((e) => e.kind === "item").map((e) => e.id)])];
  const soldPackageIds = [...qtyByEntity.values()].filter((e) => e.kind === "package").map((e) => e.id);
  // SKU names+weights cover the flattened SKUs AND the SKU-modifier targets
  // (whose ids may not appear in the flatten yet — a pure "No bread" removal on
  // a check with no other SKU demand). avg_oz_per_each rides here (each→oz).
  const skuIds = [...new Set([...skuDirect.keys(), ...skuFlattened.keys(), ...skuModApplications.map((a) => a.skuId)])];
  const [menuNames, itemNames, skuNames, packageNames] = await Promise.all([
    menuItemIds.length ? sb.from("menu_items").select("id, name").in("id", menuItemIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [], error: null }),
    itemIds.length ? sb.from("items").select("id, name").in("id", itemIds).returns<Array<{ id: string; name: string }>>() : Promise.resolve({ data: [], error: null }),
    skuIds.length ? sb.from("vendor_items").select("id, name, avg_oz_per_each").in("id", skuIds).returns<Array<{ id: string; name: string; avg_oz_per_each: number | string | null }>>() : Promise.resolve({ data: [], error: null }),
    soldPackageIds.length ? sb.from("catering_packages").select("id, label_en").in("id", soldPackageIds).returns<Array<{ id: string; label_en: string }>>() : Promise.resolve({ data: [], error: null }),
  ]);
  if (menuNames.error) throw new Error(`toast-sales names menu_items: ${menuNames.error.message}`);
  if (itemNames.error) throw new Error(`toast-sales names items: ${itemNames.error.message}`);
  if (skuNames.error) throw new Error(`toast-sales names skus: ${skuNames.error.message}`);
  if (packageNames.error) throw new Error(`toast-sales names packages: ${packageNames.error.message}`);
  const mName = new Map((menuNames.data ?? []).map((r) => [r.id, r.name]));
  const iName = new Map((itemNames.data ?? []).map((r) => [r.id, r.name]));
  const sName = new Map((skuNames.data ?? []).map((r) => [r.id, r.name]));
  const pName = new Map((packageNames.data ?? []).map((r) => [r.id, r.label_en]));
  const skuAvgOzPerEach = new Map((skuNames.data ?? []).map((r) => [r.id, r.avg_oz_per_each != null ? Number(r.avg_oz_per_each) : null]));

  // ── SKU-modifier lane (Part 2): convert each collected application to oz via
  //    skuPortionOz (oz→oz, each→qty×avg_oz_per_each), apply the sign into the
  //    SKU oz map, track removed oz for display, then clamp each SKU total ≥0
  //    (a day can't consume negative bread). Unresolvable portion (no per-each
  //    weight) → the portionNeeded advisory, never a silent skip. ────────────
  const removedBySku = new Map<string, number>();
  for (const a of skuModApplications) {
    const oz = skuPortionOz(a.portion, skuAvgOzPerEach.get(a.skuId) ?? null);
    if (oz == null) {
      modifierStats.portionNeeded.set(a.itemName, (modifierStats.portionNeeded.get(a.itemName) ?? 0) + a.qty);
      continue;
    }
    const delta = a.sign * oz * a.qty;
    // SKU-modifiers are AT-SALE consumption → the DIRECT lane. Removals net here
    // too (a "No bread" nets the bread the sub would have used — a direct input).
    skuDirect.set(a.skuId, (skuDirect.get(a.skuId) ?? 0) + delta);
    if (a.sign < 0) removedBySku.set(a.skuId, (removedBySku.get(a.skuId) ?? 0) + oz * a.qty);
    if (a.sign > 0) modifierStats.depleted += a.qty; else modifierStats.removed += a.qty;
  }
  // Clamp the DIRECT lane ≥0 per SKU (removals never go negative). The flattened
  // lane needs no clamp — it is built from clamped item units × non-negative oz.
  for (const [skuId, oz] of skuDirect) skuDirect.set(skuId, Math.max(oz, 0));

  // Suspected-catering advisory over NON-excluded checks.
  const byCheck = new Map<string, { qty: number; dining: string | null; nameHit: boolean }>();
  for (const r of counted) {
    const c = byCheck.get(r.check_guid) ?? { qty: 0, dining: r.dining_option, nameHit: false };
    c.qty += Number(r.quantity);
    if (SUSPECT_NAME_RE.test(r.item_name)) c.nameHit = true;
    byCheck.set(r.check_guid, c);
  }
  const suspectedCatering: SalesConsumption["suspectedCatering"] = [];
  for (const [checkGuid, c] of byCheck) {
    if (c.nameHit) suspectedCatering.push({ checkGuid, diningOption: c.dining, totalQty: c.qty, reason: "name" });
    else if (c.qty >= SUSPECT_CHECK_QTY) suspectedCatering.push({ checkGuid, diningOption: c.dining, totalQty: c.qty, reason: "quantity" });
  }

  return {
    soldLines: [...qtyByEntity.values()]
      .map((e) => ({
        name: (e.kind === "menu_item" ? mName.get(e.id) : e.kind === "item" ? iName.get(e.id) : pName.get(e.id)) ?? "(unknown)",
        quantity: e.quantity,
        kind: e.kind,
      }))
      .sort((a, b) => b.quantity - a.quantity),
    prepConsumed: [...prep.entries()]
      .filter(([itemId, units]) => units > 0 || (removedByItem.get(itemId) ?? 0) > 0)
      .map(([itemId, units]) => ({ itemId, name: iName.get(itemId) ?? "(item)", units, removedUnits: removedByItem.get(itemId) ?? 0 }))
      .sort((a, b) => b.units - a.units),
    skuConsumed: [...new Set([...skuDirect.keys(), ...skuFlattened.keys(), ...removedBySku.keys()])]
      .map((skuId) => {
        const directOz = skuDirect.get(skuId) ?? 0;
        const flattenedOz = skuFlattened.get(skuId) ?? 0;
        return { skuId, name: sName.get(skuId) ?? "(sku)", oz: directOz + flattenedOz, directOz, flattenedOz, removedOz: removedBySku.get(skuId) ?? 0 };
      })
      .filter((r) => r.oz > 0 || r.removedOz > 0)
      .sort((a, b) => b.oz - a.oz),
    unmappedToastItems: [...unmapped.entries()]
      .map(([toastItemGuid, u]) => ({ name: u.name, quantity: u.quantity, toastItemGuid, isModifier: u.isModifier }))
      .sort((a, b) => b.quantity - a.quantity),
    excludedCount: excluded.size,
    suspectedCatering,
    modifierStats: {
      depleted: modifierStats.depleted,
      removed: modifierStats.removed,
      ignored: modifierStats.ignored,
      portionNeeded: [...modifierStats.portionNeeded.entries()].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity),
    },
    packageIssues: [...packageIssues.values()],
  };
}
