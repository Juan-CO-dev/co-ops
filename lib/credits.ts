/**
 * Vendor-credit data layer (Item/Inventory Spine — delivery-intake P1, migration
 * 0168). SERVER-ONLY, service-role client; authorization is APP-LAYER (KH+ read
 * gate + location-bind IDOR; the RESOLVE lifecycle requires AGM+). Credits are
 * DERIVED at intake (lib/receiving.ts deriveAndUpsertCredits, spec D1 — the intake
 * unit_price is the amount authority); this module READS the open ledger and drives
 * the resolve lifecycle only.
 *
 * ── GATE SPLIT: judgment outcomes are AGM+, evidence-backed closure is KH+ ─────────
 * The credit lifecycle has TWO resolution paths with DIFFERENT authorization levels
 * (a column-level-style split, documented per AGENTS.md app-layer enforcement law):
 *   • resolveCredit (AGM+, CREDIT_RESOLVE_MIN=6) — the JUDGMENT outcomes
 *     (resolved_credit / resolved_refund / written_off). Deciding to eat a loss,
 *     take money back, or write it off is a manager's financial call → AGM+.
 *   • resolveCreditsRedelivered (KH+, CREDIT_READ_MIN=4) — the EVIDENCE-BACKED
 *     closure (V2-D4). When the vendor re-sends the short items on a later truck,
 *     the manager at the door marks "makes up a short?"; the delivery record IS the
 *     proof (resolved_by_delivery_id), so no judgment is exercised — the credit is
 *     simply reconciled against a concrete redelivery. That's an intake action, so
 *     the same KH+ gate that lets a key holder RECEIVE also lets them CLOSE a short
 *     by redelivery. No money is credited/refunded/written off on this path.
 *   • Race attribution: on a concurrent redelivery race the credit attributes to the
 *     first delivery to close it; the second delivery reports it as skipped (not an error).
 *
 * APPEND-ONLY: a credit row is never DELETEd and never UPDATEd except its status /
 * notes / resolved_at / resolved_by_delivery_id lifecycle fields. Every UPDATE checks
 * error AND rowcount (AGENTS.md silent-UPDATE law); `.update()` swallows constraint
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

// ── Per-vendor outstanding-credits aggregate (AGM+): the vendor admin line ────────
export interface VendorOutstandingCredits {
  openCount: number;
  totalCents: number | null; // null-law: null when NO open row carried an amount (never a false $0.00)
  oldestDays: number | null;
  deliveriesCount: number; // DISTINCT non-null delivery_id count ("across N deliveries")
}

/**
 * One-vendor rollup of unresolved credits (status open|in_progress) for the vendor
 * admin detail page ("$X outstanding across N deliveries" — visible before the next
 * order, spec D3). Scoped to the actor's locations (location_id IN actor.locations) —
 * the admin surface has no single-location context, so we aggregate across every
 * location the actor can see. BC-009: returns null for a deactivated vendor (a dead
 * vendor carries no live outstanding balance). Returns null when openCount is 0 so
 * the caller renders nothing. AGM+ read gate (mirrors the /admin/vendors page's ≥6).
 */
export async function loadVendorOutstandingCredits(
  actor: AuthContext, vendorId: string,
): Promise<VendorOutstandingCredits | null> {
  requireLevel(actor, CREDIT_RESOLVE_MIN); // AGM+ (6) — matches the admin vendor page gate
  const sb = getServiceRoleClient();

  // BC-009: a deactivated vendor never shows an outstanding balance.
  const { data: vend, error: vErr } = await sb.from("vendors")
    .select("id").eq("id", vendorId).eq("active", true)
    .maybeSingle<{ id: string }>();
  if (vErr) throw new Error(`loadVendorOutstandingCredits vendor: ${vErr.message}`);
  if (!vend) return null;

  const locations = actor.locations;
  if (locations.length === 0) return null; // an actor with no locations sees nothing
  const { data: rows, error } = await sb.from("vendor_credits")
    .select("amount_cents, delivery_id, created_at")
    .eq("vendor_id", vendorId).in("location_id", locations).in("status", ["open", "in_progress"])
    .returns<Array<{ amount_cents: number | string | null; delivery_id: string | null; created_at: string }>>();
  if (error) throw new Error(`loadVendorOutstandingCredits: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return null;

  const now = Date.now();
  let totalCents = 0;
  let sawAmount = false;
  let oldestMs = now;
  const deliveryIds = new Set<string>();
  for (const r of list) {
    const cents = num(r.amount_cents);
    if (cents != null) { totalCents += cents; sawAmount = true; } // null-safe sum
    const ms = Date.parse(r.created_at);
    if (Number.isFinite(ms) && ms < oldestMs) oldestMs = ms;
    if (r.delivery_id != null) deliveryIds.add(r.delivery_id);
  }
  return {
    openCount: list.length,
    // null (not 0) when NO row carried an amount — a false $0.00 would read as "nothing owed".
    totalCents: sawAmount ? totalCents : null,
    oldestDays: Math.floor((now - oldestMs) / 86_400_000),
    deliveriesCount: deliveryIds.size,
  };
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
    .select("id, location_id, status, notes").eq("id", creditId)
    .maybeSingle<{ id: string; location_id: string; status: string; notes: string | null }>();
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
  // Append resolution notes to any existing notes — never clobber (and never
  // overwrite existing notes with null when no new note is supplied).
  if (trimmedNotes != null) update.notes = c.notes ? c.notes + "\n" + trimmedNotes : trimmedNotes;
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

// ── Open-credit ROWS for a vendor+location (KH+): the redelivery-closure prefill ──

/**
 * The goods-shaped reasons a physical redelivery can close (V2-D4). SINGLE SOURCE OF
 * TRUTH for both the prefill loader AND resolveCreditsRedelivered's server-side check —
 * the UI filter alone is not enforcement (a crafted request could smuggle a money-shaped
 * credit id past it; the resolver must reject those at KH+, keeping 'over' and
 * 'price_discrepancy' exclusively on the AGM+ judgment path).
 */
export const REDELIVERY_CLOSEABLE_REASONS = ["short", "damaged", "substitution"] as const;

export interface OpenCreditRow {
  id: string;
  skuName: string | null; // vendor_items.name via sku_id; null when the credit named no SKU
  reason: string; // 'short' | 'over' | 'damaged' | 'substitution' | 'price_discrepancy'
  qty: number | null;
  ageDays: number; // whole days since created_at (the door manager's "how old is this short")
  createdAt: string;
  originDeliveryId: string | null; // the delivery the credit was filed against
  originPoCode: string | null; // that delivery's linked PO display code, when one exists
}

/**
 * Open credit rows (status open|in_progress) for ONE vendor at ONE location, shaped
 * for the intake form's "Makes up a short?" section (V2-D4). KH+ read gate — this is
 * the EVIDENCE-BACKED-closure surface, so it rides the same key-holder gate as
 * receiving (NOT the AGM+ gate on loadVendorOutstandingCredits, which returns a
 * money-bearing admin AGGREGATE for a different, judgment-facing surface). location-
 * bound via lockLocationContext (IDOR → 404 mask). Everything is BATCH-loaded: one
 * credits query, one SKU-name query, one origin-delivery query, one PO-code query —
 * never a per-credit lookup (loadRecipeGraph law). Returns [] when nothing is open.
 */
export async function loadOpenCreditRowsForVendor(
  actor: AuthContext, locationId: string, vendorId: string,
): Promise<OpenCreditRow[]> {
  requireLevel(actor, CREDIT_READ_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) throw new CreditError(404, "not_found", "Location not found");
  const sb = getServiceRoleClient();

  // status = 'open' ONLY (not in_progress): the redelivery-closure UPDATE targets
  // `.eq("status","open")`, so this prefill must offer exactly what CAN close. An
  // in_progress credit is mid-resolution on the AGM+ judgment path — leave it to that
  // flow (offering it here would produce a check that silently no-ops to `skipped`).
  //
  // GOODS-SHAPED reasons only (REDELIVERY_CLOSEABLE_REASONS — the resolver enforces the
  // same set server-side): redelivery closes short, damaged, and substitution credits
  // because a later truck can make up a short, replace damaged goods, or correct a
  // substitution. 'over' and 'price_discrepancy' are money-shaped and resolve exclusively
  // through the AGM+ judgment path (resolveCredit) — never by a physical redelivery.
  const { data: rows, error } = await sb.from("vendor_credits")
    .select("id, sku_id, reason, qty, created_at, delivery_id")
    .eq("vendor_id", vendorId).eq("location_id", locationId).eq("status", "open")
    .in("reason", [...REDELIVERY_CLOSEABLE_REASONS])
    .limit(100) // bounded render/prefill guard — mirrors the route's MAX_MAKE_UP_CREDITS rationale
    .order("created_at", { ascending: true })
    .returns<Array<{ id: string; sku_id: string | null; reason: string; qty: number | string | null; created_at: string; delivery_id: string | null }>>();
  if (error) throw new Error(`loadOpenCreditRowsForVendor: ${error.message}`);
  const list = rows ?? [];
  if (list.length === 0) return [];

  // Batch #2: SKU names for every distinct sku_id (single .in()).
  const skuIds = [...new Set(list.map((r) => r.sku_id).filter((v): v is string => v != null))];
  const skuName = new Map<string, string>();
  if (skuIds.length > 0) {
    const { data: skus, error: sErr } = await sb.from("vendor_items")
      .select("id, name").in("id", skuIds)
      .returns<Array<{ id: string; name: string }>>();
    if (sErr) throw new Error(`loadOpenCreditRowsForVendor skus: ${sErr.message}`);
    for (const s of skus ?? []) skuName.set(s.id, s.name);
  }

  // Batch #3 + #4: origin delivery → its linked PO → its display code. Two grouped
  // queries (deliveries then POs), never per-credit. A credit's delivery may carry no
  // PO (a walk-in short with no order); that trail simply ends at the delivery id.
  const deliveryIds = [...new Set(list.map((r) => r.delivery_id).filter((v): v is string => v != null))];
  const poIdByDelivery = new Map<string, string>();
  if (deliveryIds.length > 0) {
    const { data: dels, error: dErr } = await sb.from("vendor_deliveries")
      .select("id, purchase_order_id").in("id", deliveryIds)
      .returns<Array<{ id: string; purchase_order_id: string | null }>>();
    if (dErr) throw new Error(`loadOpenCreditRowsForVendor deliveries: ${dErr.message}`);
    for (const d of dels ?? []) if (d.purchase_order_id != null) poIdByDelivery.set(d.id, d.purchase_order_id);
  }
  const poCodeById = new Map<string, string>();
  const poIds = [...new Set([...poIdByDelivery.values()])];
  if (poIds.length > 0) {
    const { data: pos, error: pErr } = await sb.from("purchase_orders")
      .select("id, display_code").in("id", poIds)
      .returns<Array<{ id: string; display_code: string }>>();
    if (pErr) throw new Error(`loadOpenCreditRowsForVendor purchase_orders: ${pErr.message}`);
    for (const p of pos ?? []) poCodeById.set(p.id, p.display_code);
  }

  const now = Date.now();
  return list.map((r) => {
    const poId = r.delivery_id != null ? poIdByDelivery.get(r.delivery_id) : undefined;
    const ms = Date.parse(r.created_at);
    return {
      id: r.id,
      skuName: r.sku_id != null ? (skuName.get(r.sku_id) ?? null) : null,
      reason: r.reason,
      qty: num(r.qty),
      ageDays: Number.isFinite(ms) ? Math.floor((now - ms) / 86_400_000) : 0,
      createdAt: r.created_at,
      originDeliveryId: r.delivery_id,
      originPoCode: poId != null ? (poCodeById.get(poId) ?? null) : null,
    };
  });
}

// ── Redelivery closure (KH+): the evidence-backed terminal transition (V2-D4) ─────

/**
 * Close open credits by REDELIVERY (V2-D4). When the vendor re-sends short items on a
 * later truck, the intake form offers those items' open credits; the manager checks
 * the ones THIS delivery fulfills. Each checked credit flips open → 'resolved_redelivered'
 * with resolved_by_delivery_id = the new delivery (the proof), resolved_at = now.
 *
 * GATE: KH+ (CREDIT_READ_MIN). This is EVIDENCE-BACKED closure — the delivery record
 * IS the proof, no judgment is exercised — so it rides the key-holder intake gate, NOT
 * the AGM+ judgment gate of resolveCredit (module header documents the split).
 *
 * VALIDATION:
 *   • the delivery must exist AND be location-bound to the actor (404-mask on an IDOR
 *     violation, house law — never leak that a delivery exists elsewhere).
 *   • each credit must belong to the SAME vendor + location as the delivery. A mismatch
 *     is SKIPPED and reported (never thrown) — a stale/racing checkbox must not fail the
 *     whole batch (walk-data-sacred: the intake already succeeded before this runs).
 *
 * PER-CREDIT WRITE: a guarded UPDATE `.eq("id").eq("status","open")` — only OPEN credits
 * close (an in_progress or already-terminal credit is left alone). Checks error AND
 * rowcount (silent-UPDATE law); rowcount 0 (raced / already resolved / not open) →
 * collected into `skipped`, never thrown. ONE audit row per batch.
 */
export async function resolveCreditsRedelivered(
  actor: AuthContext, deliveryId: string, creditIds: string[],
): Promise<{ resolved: string[]; skipped: string[] }> {
  requireLevel(actor, CREDIT_READ_MIN);
  const ids = [...new Set(creditIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return { resolved: [], skipped: [] };
  const sb = getServiceRoleClient();

  // The delivery is the proof — it must exist and be location-bound to the actor.
  const { data: d, error: dErr } = await sb.from("vendor_deliveries")
    .select("id, vendor_id, location_id").eq("id", deliveryId)
    .maybeSingle<{ id: string; vendor_id: string; location_id: string }>();
  if (dErr) throw new Error(`resolveCreditsRedelivered delivery: ${dErr.message}`);
  if (!d) throw new CreditError(404, "not_found", "Delivery not found");
  if (!lockLocationContext(actorLoc(actor), d.location_id)) throw new CreditError(404, "not_found", "Delivery not found");

  // Load the candidate credits ONCE (batch) so we can validate vendor+location+reason
  // membership without a per-credit round trip.
  const { data: creditRows, error: cErr } = await sb.from("vendor_credits")
    .select("id, vendor_id, location_id, status, reason").in("id", ids)
    .returns<Array<{ id: string; vendor_id: string; location_id: string; status: string; reason: string }>>();
  if (cErr) throw new Error(`resolveCreditsRedelivered credits: ${cErr.message}`);
  const byId = new Map((creditRows ?? []).map((c) => [c.id, c]));

  const resolved: string[] = [];
  const skipped: string[] = [];
  const nowIso = new Date().toISOString();
  const closeableReasons: readonly string[] = REDELIVERY_CLOSEABLE_REASONS;

  for (const id of ids) {
    const c = byId.get(id);
    // Unknown id, wrong vendor+location, or a money-shaped reason → skip (a mismatched/
    // stale checkbox must never fail the whole intake). The reason check is ENFORCEMENT,
    // not UX: the prefill only offers goods-shaped credits, but a crafted request could
    // smuggle an 'over'/'price_discrepancy' id — those close ONLY via AGM+ resolveCredit.
    if (!c || c.vendor_id !== d.vendor_id || c.location_id !== d.location_id || !closeableReasons.includes(c.reason)) {
      skipped.push(id);
      continue;
    }
    // Guarded UPDATE: only an OPEN credit closes by redelivery. The status predicate
    // makes a raced/already-resolved credit a rowcount-0 no-op → skipped.
    const { error: uErr, count } = await sb.from("vendor_credits")
      .update(
        { status: "resolved_redelivered", resolved_at: nowIso, resolved_by_delivery_id: deliveryId },
        { count: "exact" },
      )
      .eq("id", id).eq("status", "open");
    if (uErr) throw new Error(`resolveCreditsRedelivered update: ${uErr.message}`);
    if (count === 0) { skipped.push(id); continue; } // raced / not open → skip, never throw
    resolved.push(id);
  }

  // ONE audit row for the whole batch (existing action vocabulary: credit.resolved).
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "credit.resolved", resourceTable: "vendor_credits", resourceId: deliveryId,
    metadata: {
      outcome: "redelivered",
      resolving_delivery_id: deliveryId,
      location_id: d.location_id,
      vendor_id: d.vendor_id,
      resolved_ids: resolved,
      skipped_ids: skipped,
    },
    ipAddress: null, userAgent: null,
  });

  return { resolved, skipped };
}
