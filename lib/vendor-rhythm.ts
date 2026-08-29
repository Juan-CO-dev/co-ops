/**
 * Vendor delivery rhythm — SERVER data layer (Dynamic Pars Phase 1, Tasks 1.3 + 1.5).
 *
 * SERVER-ONLY. Service-role client throughout — authorization is enforced APP-LAYER by
 * the calling routes AND re-checked here per-action (defense in depth; the lib is the
 * authority). Mirrors lib/admin/vendors.ts exactly, because this surface RIDES the vendor
 * detail page and must not invent a second posture for the same page.
 *
 * Append-only: a changed lead deactivates the live pair and inserts a new one, so the
 * history of "what the rhythm used to be" stays readable. Nothing here ever DELETEs.
 *
 * ── FLOORS: the cutoffs precedent, not a new one ─────────────────────────────────
 * vendor.cutoff_change is documented "add = AGM+, deactivate = GM+"
 * (lib/destructive-actions.ts). A rhythm pair is the same KIND of vendor-schedule fact,
 * authored on the same page by the same people, so it takes the same two floors rather
 * than minting a third opinion about who configures a vendor.
 *
 * ── PRE-APPLY DEGRADATION (Task 1.5; the 0180 probe precedent) ───────────────────
 * Every read here is probe-gated. Before migration 0182 is applied (GATE M1) the tables
 * do not exist, so `rhythmSchemaReady` returns false, the loaders return EMPTY MAPS, and
 * the rhythm card renders its own "schema pending" state. Nothing 500s, and — because
 * Phase 1 adds no call site to lib/ordering.ts — the walker is byte-identical either way.
 * The probe caches only the TRUE answer and re-probes while false (exactly
 * countProductAllocationReady, lib/counts.ts), so the surface lights itself the moment
 * the migration lands: no redeploy, no flag, and no stale `false` stranded in a warm
 * serverless process.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { deliveryDowFor } from "@/lib/vendor-rhythm-shared";
import type { RhythmRow, RhythmSkip } from "@/lib/vendor-rhythm-shared";

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

// ── Authority floors (the cutoffs precedent: add = AGM+, deactivate = GM+) ──────
export const RHYTHM_WRITE_MIN = 7; // GM+ — deactivate a pair or a skip
export const RHYTHM_APPEND_MIN = 6; // AGM+ — author a pair or a skip

/** Typed error the routes map to jsonError(status, code). Mirrors AdminVendorError. */
export class VendorRhythmError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "VendorRhythmError";
  }
}

function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new VendorRhythmError(403, "forbidden", "Insufficient role level for this action");
  }
}

/**
 * A rhythm row is location-scoped operational config, so an admin must actually HOLD the
 * shop they are authoring trucks for. Two independent checks, both required:
 *   · the location exists and is active (mirrors assertLocationActive in lib/admin/skus.ts);
 *   · the actor's session binds that location (lib/locations.ts lockLocationContext).
 */
async function assertLocationActive(locationId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("locations")
    .select("id")
    .eq("id", locationId)
    .eq("active", true)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`assertLocationActive failed: ${error.message}`);
  if (!data) throw new VendorRhythmError(400, "invalid_location", "Location not found or inactive");
}

async function assertLocationAuthored(actor: AuthContext, locationId: string): Promise<void> {
  if (typeof locationId !== "string" || !locationId) {
    throw new VendorRhythmError(400, "invalid_location", "Location not valid");
  }
  if (!lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) {
    throw new VendorRhythmError(403, "forbidden", "Actor does not hold this location");
  }
  await assertLocationActive(locationId);
}

async function requireVendorRow(vendorId: string): Promise<void> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("vendors")
    .select("id")
    .eq("id", vendorId)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`requireVendorRow failed: ${error.message}`);
  if (!data) throw new VendorRhythmError(404, "vendor_not_found", "Vendor not found");
}

function assertDow(dow: number): void {
  if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
    throw new VendorRhythmError(400, "invalid_day", "Order day must be 0..6");
  }
}

function assertLeadDays(leadDays: number): void {
  // The DDL caps this at 14: anything longer is a standing order, not a rhythm.
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 14) {
    throw new VendorRhythmError(400, "invalid_lead_days", "Lead days must be an integer 0..14");
  }
}

/** "YYYY-MM-DD" only — the columns are `date`, and a datetime would silently truncate. */
function assertDateEt(value: string, code: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new VendorRhythmError(400, code, "Date must be YYYY-MM-DD");
  }
}

// ── The 0182 probe (Task 1.5) ────────────────────────────────────────────────────
//
// One `select("id").limit(1)` against vendor_delivery_rhythm. Cache ONLY the true
// answer; re-probe while false. Log the pending state exactly once per process so a
// warm lambda does not spam the log with a fact that is not going to change this minute.

let rhythmSchemaReadyCached = false;
let rhythmSchemaPendingLogged = false;

export async function rhythmSchemaReady(sb: ServiceClient): Promise<boolean> {
  if (rhythmSchemaReadyCached) return true;
  const { error } = await sb.from("vendor_delivery_rhythm").select("id").limit(1);
  if (error) {
    if (!rhythmSchemaPendingLogged) {
      rhythmSchemaPendingLogged = true;
      console.warn(
        `[vendor-rhythm] delivery rhythm is DORMANT — migration 0182 (GATE M1) is not applied yet: ${error.message}`,
      );
    }
    return false;
  }
  rhythmSchemaReadyCached = true;
  return true;
}

/** The write-path form of the probe: a mutation must refuse loudly, never no-op. */
async function assertRhythmSchemaReady(sb: ServiceClient): Promise<void> {
  if (!(await rhythmSchemaReady(sb))) {
    throw new VendorRhythmError(
      503,
      "rhythm_schema_pending",
      "Migration 0182 (GATE M1) has not been applied yet",
    );
  }
}

// ── Reads (actor-less; the caller is already authorized for this location) ───────

interface DbRhythmRow {
  id: string;
  vendor_id: string;
  location_id: string;
  order_dow: number;
  lead_days: number;
}

/** A rhythm pair as the ADMIN surface reads it — carries the row id so it can be retired. */
export interface RhythmPairView extends RhythmRow {
  id: string;
  /** Derived by the DB's GENERATED column; recomputed here so the view never guesses. */
  deliveryDow: number;
}

/**
 * Every active rhythm pair for these vendors AT ONE LOCATION, in ONE batched query.
 * Returns an EMPTY map (never throws) when migration 0182 is not applied yet.
 */
export async function loadRhythmByVendor(
  sb: ServiceClient,
  vendorIds: string[],
  locationId: string,
): Promise<Map<string, RhythmRow[]>> {
  const out = new Map<string, RhythmRow[]>();
  if (vendorIds.length === 0) return out;
  if (!(await rhythmSchemaReady(sb))) return out;

  const { data, error } = await sb
    .from("vendor_delivery_rhythm")
    .select("id, vendor_id, location_id, order_dow, lead_days")
    .in("vendor_id", vendorIds)
    .eq("location_id", locationId)
    .eq("active", true)
    .order("order_dow", { ascending: true })
    .returns<DbRhythmRow[]>();
  if (error) throw new Error(`loadRhythmByVendor failed: ${error.message}`);

  for (const r of data ?? []) {
    const list = out.get(r.vendor_id) ?? [];
    list.push({
      vendorId: r.vendor_id,
      locationId: r.location_id,
      orderDow: r.order_dow,
      leadDays: r.lead_days,
    });
    out.set(r.vendor_id, list);
  }
  return out;
}

/**
 * The admin surface's read: every active pair for ONE vendor across ALL locations, so the
 * editor can render each shop's trucks side by side. Carries the row id (the delete
 * affordance needs it). Empty array when 0182 is pending.
 */
export async function loadVendorRhythmPairs(vendorId: string): Promise<RhythmPairView[]> {
  const sb = getServiceRoleClient();
  if (!(await rhythmSchemaReady(sb))) return [];

  const { data, error } = await sb
    .from("vendor_delivery_rhythm")
    .select("id, vendor_id, location_id, order_dow, lead_days")
    .eq("vendor_id", vendorId)
    .eq("active", true)
    .order("location_id", { ascending: true })
    .order("order_dow", { ascending: true })
    .returns<DbRhythmRow[]>();
  if (error) throw new Error(`loadVendorRhythmPairs failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    locationId: r.location_id,
    orderDow: r.order_dow,
    leadDays: r.lead_days,
    deliveryDow: deliveryDowFor(r.order_dow, r.lead_days),
  }));
}

interface DbSkipRow {
  id: string;
  vendor_id: string;
  location_id: string;
  skip_from: string;
  skip_through: string;
  note: string | null;
}

/** A skip window as the ADMIN surface reads it. */
export interface RhythmSkipView extends RhythmSkip {
  id: string;
  locationId: string;
  note: string | null;
}

/**
 * Active, not-yet-expired outage windows for these vendors at one location, in ONE query.
 * Empty map when 0182 is pending.
 */
export async function loadRhythmSkips(
  sb: ServiceClient,
  vendorIds: string[],
  locationId: string,
  fromDate: string,
): Promise<Map<string, RhythmSkip[]>> {
  const out = new Map<string, RhythmSkip[]>();
  if (vendorIds.length === 0) return out;
  if (!(await rhythmSchemaReady(sb))) return out;

  const { data, error } = await sb
    .from("vendor_rhythm_skips")
    .select("id, vendor_id, location_id, skip_from, skip_through, note")
    .in("vendor_id", vendorIds)
    .eq("location_id", locationId)
    .eq("active", true)
    .gte("skip_through", fromDate)
    .returns<DbSkipRow[]>();
  if (error) throw new Error(`loadRhythmSkips failed: ${error.message}`);

  for (const r of data ?? []) {
    const list = out.get(r.vendor_id) ?? [];
    list.push({ vendorId: r.vendor_id, skipFrom: r.skip_from, skipThrough: r.skip_through });
    out.set(r.vendor_id, list);
  }
  return out;
}

/**
 * The admin surface's read: every active skip for ONE vendor, all locations.
 *
 * ── PAGED, AND ITS SIBLING ABOVE IS NOT (deliberate asymmetry) ────────────────────
 * `loadVendorRhythmPairs` is STRUCTURALLY bounded — `vendor_delivery_rhythm_live_uq`
 * permits at most one live pair per (vendor, location, order day), so its result can
 * never exceed 7 × the shop count. Skips carry no such index: they are one append-only
 * row per outage, retracted by `active = false` and never expired, so an old vendor at
 * a busy shop accumulates them without limit. Unpaged, PostgREST would silently return
 * the first 1000 and the admin card would show a truncated history with no error at all
 * (the PR #63 lesson — the failure mode is silence, not a 500).
 *
 * ── WHY NO DATE BOUND, THOUGH THE SIBLING LOADER HAS ONE ──────────────────────────
 * `loadRhythmSkips` (the walker's read) bounds on `skip_through >= fromDate` because it
 * answers "is this vendor down for the horizon I am planning". This one is the ADMIN
 * HISTORY: an expired window is exactly what an admin is looking at when they ask what
 * happened last month. A bound here would change the contract — silently hiding rows the
 * card exists to show — so the fix is paging alone, and the contract is byte-identical.
 *
 * The stable TOTAL order paging needs is `skip_from, id`: `skip_from` alone is not
 * unique (two shops' outages routinely start the same day), and a non-total order lets
 * a row appear on two pages or none. Output order is unchanged — still skip_from
 * ascending, with ties now deterministic rather than arbitrary.
 */
export async function loadVendorRhythmSkips(vendorId: string): Promise<RhythmSkipView[]> {
  const sb = getServiceRoleClient();
  if (!(await rhythmSchemaReady(sb))) return [];

  const data = await selectAllRows<DbSkipRow>(async (from, to) => {
    const { data, error } = await sb
      .from("vendor_rhythm_skips")
      .select("id, vendor_id, location_id, skip_from, skip_through, note")
      .eq("vendor_id", vendorId)
      .eq("active", true)
      .order("skip_from", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
      .returns<DbSkipRow[]>();
    if (error) throw new Error(`loadVendorRhythmSkips failed: ${error.message}`);
    return { data };
  });

  // `selectAllRows` always resolves to an array, so the old `?? []` is gone with the
  // nullable `data` it guarded.
  return data.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    locationId: r.location_id,
    skipFrom: r.skip_from,
    skipThrough: r.skip_through,
    note: r.note,
  }));
}

// ── Writes (append-only) ─────────────────────────────────────────────────────────

/**
 * Author (or re-author) the pair for one (vendor, location, order day). AGM+.
 *
 * Append-only supersede: deactivate the live pair for that key, then insert the new one.
 * The partial unique index `vendor_delivery_rhythm_live_uq` is what makes that safe — it
 * physically forbids two live pairs for one key, so a double-tap race loses with 23505
 * rather than silently authoring a second truck (the same index-as-arbiter move the
 * display-code race uses in lib/ordering.ts).
 *
 * ⚠ WHY THE SUPERSEDE UPDATE DOES **NOT** 404 ON A ZERO ROWCOUNT. The silent-UPDATE-denial
 * law exists for updates that EXPECT to hit a row. This one does not: authoring a vendor's
 * FIRST pair for a shop is the normal case, and there is nothing to supersede. A 404 here
 * would make the feature unreachable — Juan could never enter PFG's first Monday. The
 * rowcount is still checked, and it is recorded in the audit row as `superseded`, so the
 * append-only history stays legible. The law is enforced where it belongs: on
 * deactivateVendorRhythmPair / deactivateRhythmSkip below, whose zero rowcount genuinely
 * means "not found or already inactive" (the deactivateVendorCutoff precedent).
 */
export async function setVendorRhythmPair(
  actor: AuthContext,
  args: { vendorId: string; locationId: string; orderDow: number; leadDays: number },
): Promise<{ id: string }> {
  requireLevel(actor, RHYTHM_APPEND_MIN);
  const sb = getServiceRoleClient();
  await assertRhythmSchemaReady(sb);
  await requireVendorRow(args.vendorId);
  await assertLocationAuthored(actor, args.locationId);
  assertDow(args.orderDow);
  assertLeadDays(args.leadDays);

  const { error: dErr, count: superseded } = await sb
    .from("vendor_delivery_rhythm")
    .update({ active: false }, { count: "exact" })
    .eq("vendor_id", args.vendorId)
    .eq("location_id", args.locationId)
    .eq("order_dow", args.orderDow)
    .eq("active", true);
  if (dErr) throw new Error(`setVendorRhythmPair supersede failed: ${dErr.message}`);

  const { data: inserted, error: iErr } = await sb
    .from("vendor_delivery_rhythm")
    .insert({
      vendor_id: args.vendorId,
      location_id: args.locationId,
      order_dow: args.orderDow,
      lead_days: args.leadDays,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) {
    // The live-pair unique index arbitrated a concurrent authoring of the same key.
    if (iErr.code === "23505") {
      throw new VendorRhythmError(409, "rhythm_pair_conflict", "This pair was just changed by someone else");
    }
    throw new Error(`setVendorRhythmPair insert failed: ${iErr.message}`);
  }
  if (!inserted) throw new Error("setVendorRhythmPair insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendor_delivery_rhythm",
    resourceId: inserted.id,
    metadata: {
      scope: "delivery_rhythm",
      op: "set",
      vendor_id: args.vendorId,
      location_id: args.locationId,
      order_dow: args.orderDow,
      lead_days: args.leadDays,
      superseded: superseded ?? 0,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

/** Retire a pair (GM+, append-only). Zero rowcount = not found or already inactive. */
export async function deactivateVendorRhythmPair(
  actor: AuthContext,
  args: { id: string },
): Promise<void> {
  requireLevel(actor, RHYTHM_WRITE_MIN);
  const sb = getServiceRoleClient();
  await assertRhythmSchemaReady(sb);

  const { data: row, error: rErr } = await sb
    .from("vendor_delivery_rhythm")
    .select("id, vendor_id, location_id, order_dow, lead_days")
    .eq("id", args.id)
    .maybeSingle<DbRhythmRow>();
  if (rErr) throw new Error(`deactivateVendorRhythmPair lookup failed: ${rErr.message}`);
  if (!row) throw new VendorRhythmError(404, "not_found", "Rhythm pair not found");
  await assertLocationAuthored(actor, row.location_id);

  const { error, count } = await sb
    .from("vendor_delivery_rhythm")
    .update({ active: false }, { count: "exact" })
    .eq("id", args.id)
    .eq("active", true);
  if (error) throw new Error(`deactivateVendorRhythmPair failed: ${error.message}`);
  if (count === 0) throw new VendorRhythmError(404, "not_found", "Rhythm pair not found or already inactive");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendor_delivery_rhythm",
    resourceId: args.id,
    metadata: {
      scope: "delivery_rhythm",
      op: "deactivate",
      vendor_id: row.vendor_id,
      location_id: row.location_id,
      order_dow: row.order_dow,
      lead_days: row.lead_days,
    },
    ipAddress: null,
    userAgent: null,
  });
}

/** Open a vendor-down window (AGM+). Inclusive on both ends. */
export async function addRhythmSkip(
  actor: AuthContext,
  args: { vendorId: string; locationId: string; skipFrom: string; skipThrough: string; note: string | null },
): Promise<{ id: string }> {
  requireLevel(actor, RHYTHM_APPEND_MIN);
  const sb = getServiceRoleClient();
  await assertRhythmSchemaReady(sb);
  await requireVendorRow(args.vendorId);
  await assertLocationAuthored(actor, args.locationId);
  assertDateEt(args.skipFrom, "invalid_skip_from");
  assertDateEt(args.skipThrough, "invalid_skip_through");
  if (args.skipThrough < args.skipFrom) {
    throw new VendorRhythmError(400, "invalid_skip_range", "The end of the window is before its start");
  }
  const note = typeof args.note === "string" && args.note.trim() ? args.note.trim() : null;

  const { data: inserted, error: iErr } = await sb
    .from("vendor_rhythm_skips")
    .insert({
      vendor_id: args.vendorId,
      location_id: args.locationId,
      skip_from: args.skipFrom,
      skip_through: args.skipThrough,
      note,
      active: true,
      created_by: actor.user.id,
    })
    .select("id")
    .maybeSingle<{ id: string }>();
  if (iErr) throw new Error(`addRhythmSkip insert failed: ${iErr.message}`);
  if (!inserted) throw new Error("addRhythmSkip insert returned no row");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendor_rhythm_skips",
    resourceId: inserted.id,
    metadata: {
      scope: "rhythm_skip",
      op: "add",
      vendor_id: args.vendorId,
      location_id: args.locationId,
      skip_from: args.skipFrom,
      skip_through: args.skipThrough,
    },
    ipAddress: null,
    userAgent: null,
  });

  return { id: inserted.id };
}

/** Retract a skip window (GM+, append-only). Zero rowcount = not found or already inactive. */
export async function deactivateRhythmSkip(
  actor: AuthContext,
  args: { id: string },
): Promise<void> {
  requireLevel(actor, RHYTHM_WRITE_MIN);
  const sb = getServiceRoleClient();
  await assertRhythmSchemaReady(sb);

  const { data: row, error: rErr } = await sb
    .from("vendor_rhythm_skips")
    .select("id, vendor_id, location_id, skip_from, skip_through, note")
    .eq("id", args.id)
    .maybeSingle<DbSkipRow>();
  if (rErr) throw new Error(`deactivateRhythmSkip lookup failed: ${rErr.message}`);
  if (!row) throw new VendorRhythmError(404, "not_found", "Skip window not found");
  await assertLocationAuthored(actor, row.location_id);

  const { error, count } = await sb
    .from("vendor_rhythm_skips")
    .update({ active: false }, { count: "exact" })
    .eq("id", args.id)
    .eq("active", true);
  if (error) throw new Error(`deactivateRhythmSkip failed: ${error.message}`);
  if (count === 0) throw new VendorRhythmError(404, "not_found", "Skip window not found or already inactive");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "vendor.full_profile_edit",
    resourceTable: "vendor_rhythm_skips",
    resourceId: args.id,
    metadata: {
      scope: "rhythm_skip",
      op: "deactivate",
      vendor_id: row.vendor_id,
      location_id: row.location_id,
    },
    ipAddress: null,
    userAgent: null,
  });
}

/**
 * All-dows cutoff read for the rhythm walk (plan D5). Deliberately NOT a second cutoff
 * store: `loadVendorCutoffs` / `governingCutoffTime` keep owning the DISPLAY question, and
 * this one answers "what deadline governs a SPECIFIC candidate order day", over the SAME
 * rows. One store, two selections. Cutoffs may be shared across shops (location_id NULL);
 * rhythms may not — that asymmetry is deliberate and is recorded in migration 0182.
 */
export async function loadAllCutoffsByVendor(
  sb: ServiceClient,
  vendorIds: string[],
): Promise<Map<string, Array<{ locationId: string | null; orderDay: number; cutoffTime: string }>>> {
  const out = new Map<string, Array<{ locationId: string | null; orderDay: number; cutoffTime: string }>>();
  if (vendorIds.length === 0) return out;

  const { data, error } = await sb
    .from("vendor_cutoffs")
    .select("vendor_id, location_id, order_day, cutoff_time")
    .in("vendor_id", vendorIds)
    .eq("active", true)
    .returns<Array<{ vendor_id: string; location_id: string | null; order_day: number; cutoff_time: string }>>();
  if (error) throw new Error(`loadAllCutoffsByVendor failed: ${error.message}`);

  for (const r of data ?? []) {
    const list = out.get(r.vendor_id) ?? [];
    // "HH:MM:SS" from PostgREST → the bare "HH:MM" the pure layer parses.
    list.push({ locationId: r.location_id, orderDay: r.order_day, cutoffTime: r.cutoff_time.slice(0, 5) });
    out.set(r.vendor_id, list);
  }
  return out;
}
