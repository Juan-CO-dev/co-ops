/**
 * Vendor-credit data layer (Item/Inventory Spine — delivery-intake P1, migration
 * 0168). SERVER-ONLY, service-role client; authorization is APP-LAYER (KH+ read
 * gate + location-bind IDOR; the RESOLVE lifecycle requires AGM+). Credits are
 * DERIVED at intake (lib/receiving.ts deriveAndUpsertCredits, spec D1 — the intake
 * unit_price is the amount authority); this module READS the open ledger and drives
 * the resolve lifecycle only.
 *
 * APPEND-ONLY: a credit row is never DELETEd and never UPDATEd except its status /
 * notes / resolved_at lifecycle fields (resolveCredit). Every UPDATE checks error
 * AND rowcount (AGENTS.md silent-UPDATE law); `.update()` swallows constraint
 * violations, so we never infer success from `data`.
 *
 * BC-009: rollups EXCLUDE dead entities — loadOpenCreditsSummary joins vendors and
 * filters vendors.active = true, so a deactivated vendor never appears in the summary.
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";

export const CREDIT_READ_MIN = 4; // key_holder+
export const CREDIT_RESOLVE_MIN = 6; // AGM+

export class CreditError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "CreditError";
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new CreditError(403, "forbidden", "Insufficient role level for credits");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

// ── Open-credit summary (KH+): per-vendor aggregates for the credits hub ──────────
export interface OpenCreditVendorSummary {
  vendorId: string;
  vendorName: string;
  openCount: number;
  totalCents: number | null; // null-safe sum of amount_cents (advisory; null amounts skipped)
  oldestDays: number | null;
}

/**
 * Per-vendor rollup of unresolved credits (status open|in_progress) at this location.
 * BC-009: joins vendors and FILTERS vendors.active = true — a dead vendor is excluded
 * from the rollup. totalCents is a null-safe sum (rows with a null amount_cents
 * contribute nothing but still count toward openCount). oldestDays is whole days
 * since the oldest open credit's created_at. KH+ read gate + location-bind.
 */
export async function loadOpenCreditsSummary(actor: AuthContext, locationId: string): Promise<OpenCreditVendorSummary[]> {
  requireLevel(actor, CREDIT_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CreditError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb.from("vendor_credits")
    .select("vendor_id, amount_cents, created_at")
    .eq("location_id", locationId).in("status", ["open", "in_progress"])
    .returns<Array<{ vendor_id: string; amount_cents: number | string | null; created_at: string }>>();
  if (error) throw new Error(`loadOpenCreditsSummary: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];

  const vendorIds = [...new Set(list.map((r) => r.vendor_id))];
  // BC-009: dead vendors excluded from the rollup.
  const { data: vs, error: vErr } = await sb.from("vendors")
    .select("id, name").in("id", vendorIds).eq("active", true)
    .returns<Array<{ id: string; name: string }>>();
  if (vErr) throw new Error(`loadOpenCreditsSummary vendors: ${vErr.message}`);
  const vName = new Map((vs ?? []).map((v) => [v.id, v.name]));

  const now = Date.now();
  const agg = new Map<string, { openCount: number; totalCents: number; sawAmount: boolean; oldestMs: number }>();
  for (const r of list) {
    if (!vName.has(r.vendor_id)) continue; // inactive vendor → out of rollup
    const cur = agg.get(r.vendor_id) ?? { openCount: 0, totalCents: 0, sawAmount: false, oldestMs: now };
    cur.openCount += 1;
    const cents = num(r.amount_cents);
    if (cents != null) { cur.totalCents += cents; cur.sawAmount = true; } // null-safe: null amounts skipped
    const ms = Date.parse(r.created_at);
    if (Number.isFinite(ms) && ms < cur.oldestMs) cur.oldestMs = ms;
    agg.set(r.vendor_id, cur);
  }
  return [...agg.entries()]
    .map(([vendorId, a]) => ({
      vendorId,
      vendorName: vName.get(vendorId) ?? "(vendor)",
      openCount: a.openCount,
      // null (not 0) when NO row carried an amount — a false $0.00 would read as "nothing owed".
      totalCents: a.sawAmount ? a.totalCents : null,
      oldestDays: Math.floor((now - a.oldestMs) / 86_400_000),
    }))
    .sort((a, b) => b.openCount - a.openCount);
}

// ── Credits for one delivery (KH+): the delivery detail credit list ───────────────
export interface CreditRow {
  id: string;
  vendorId: string;
  deliveryId: string | null;
  deliveryItemId: string | null;
  skuId: string | null;
  reason: string;
  qty: number | null;
  amountCents: number | null;
  status: string;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** All credits filed against a delivery (KH+ read + location-bind via the delivery). */
export async function loadCreditsForDelivery(actor: AuthContext, deliveryId: string): Promise<CreditRow[]> {
  requireLevel(actor, CREDIT_READ_MIN);
  const sb = getServiceRoleClient();
  const { data: d, error: dErr } = await sb.from("vendor_deliveries")
    .select("id, location_id").eq("id", deliveryId)
    .maybeSingle<{ id: string; location_id: string }>();
  if (dErr) throw new Error(`loadCreditsForDelivery delivery: ${dErr.message}`);
  if (!d) throw new CreditError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), d.location_id)) throw new CreditError(404, "not_found", "Delivery not found");
  const { data: rows, error } = await sb.from("vendor_credits")
    .select("id, vendor_id, delivery_id, delivery_item_id, sku_id, reason, qty, amount_cents, status, notes, created_at, resolved_at")
    .eq("delivery_id", deliveryId).order("created_at", { ascending: true })
    .returns<Array<{ id: string; vendor_id: string; delivery_id: string | null; delivery_item_id: string | null; sku_id: string | null; reason: string; qty: number | string | null; amount_cents: number | string | null; status: string; notes: string | null; created_at: string; resolved_at: string | null }>>();
  if (error) throw new Error(`loadCreditsForDelivery: ${error.message}`);
  return (rows ?? []).map((r) => ({
    id: r.id, vendorId: r.vendor_id, deliveryId: r.delivery_id, deliveryItemId: r.delivery_item_id,
    skuId: r.sku_id, reason: r.reason, qty: num(r.qty), amountCents: num(r.amount_cents),
    status: r.status, notes: r.notes, createdAt: r.created_at, resolvedAt: r.resolved_at,
  }));
}

// ── Resolve a credit (AGM+): the terminal lifecycle transition ────────────────────
export type CreditOutcome = "resolved_credit" | "resolved_refund" | "written_off";

/**
 * Move an open/in-progress credit to a terminal outcome. AGM+ gate; location-bound
 * via the credit's OWN location_id (IDOR). Append-only: we mutate ONLY status +
 * resolved_at + notes — never DELETE. Checks rowcount (silent-UPDATE law): a denied
 * or missing row → 404 (never a false success from `.update()`). Audited.
 */
export async function resolveCredit(
  actor: AuthContext, creditId: string, outcome: CreditOutcome, notes?: string | null,
): Promise<void> {
  requireLevel(actor, CREDIT_RESOLVE_MIN);
  const sb = getServiceRoleClient();
  const { data: c, error } = await sb.from("vendor_credits")
    .select("id, location_id, status").eq("id", creditId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (error) throw new Error(`resolveCredit load: ${error.message}`);
  if (!c) throw new CreditError(404, "not_found", "Credit not found");
  if (!lockLocationContext(actorLoc(actor), c.location_id)) throw new CreditError(404, "not_found", "Credit not found");
  if (c.status !== "open" && c.status !== "in_progress") {
    throw new CreditError(409, "already_resolved", "This credit already has a terminal outcome");
  }

  const trimmedNotes = notes?.trim() || null;
  const update: { status: CreditOutcome; resolved_at: string; notes?: string } = {
    status: outcome, resolved_at: new Date().toISOString(),
  };
  if (trimmedNotes != null) update.notes = trimmedNotes; // never clobber existing notes with null
  const { error: uErr, count } = await sb.from("vendor_credits")
    .update(update, { count: "exact" })
    .eq("id", creditId);
  if (uErr) throw new Error(`resolveCredit update: ${uErr.message}`);
  if (count === 0) throw new CreditError(404, "not_found", "Credit not found");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "credit.resolved", resourceTable: "vendor_credits", resourceId: creditId,
    metadata: { outcome, location_id: c.location_id, prior_status: c.status },
    ipAddress: null, userAgent: null,
  });
}
