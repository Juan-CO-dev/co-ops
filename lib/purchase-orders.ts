/**
 * Purchase-order lifecycle data layer (Vendor Ordering V1, migration 0174).
 * SERVER-ONLY, service-role client; authorization is APP-LAYER (KH+ gate +
 * location-bind IDOR; reconcile requires AGM+). Mirrors the lib/credits.ts /
 * lib/ordering.ts posture (typed error, requireLevel, actorLoc, num).
 *
 * ── THE ORDER AS A LIFECYCLE ENTITY (spec §3, D2) ──────────────────────────────
 * The walker births one `draft` PO per vendor from the par-pass order lines
 * (createDraftsFromLines). KH+ reviews the draft (line qtys editable while draft),
 * Confirm FREEZES a snapshot (prices resolved latest-at-confirm, ET timestamp,
 * governing cutoff stamped), transmit renders + Mark-placed writes a durable
 * po_transmissions row, the door-ceremony intake receives against the PO
 * (advanceToReceived, called by lib/receiving.ts), and a thin AGM+ reconcile
 * closes it once its linked deliveries carry no open credits.
 *
 * ── STATE MACHINE (guarded, race-safe) ─────────────────────────────────────────
 *   draft → confirmed → placed → received → reconciled
 * Every transition is a single UPDATE guarded by `.eq("status", <prev>)` + a
 * rowcount check (AGENTS.md silent-UPDATE law). A concurrent double-confirm /
 * placed-without-confirm / etc. loses the race and 409s (never a false success —
 * `.update()` swallows constraint violations, so we never infer from `data`).
 * `invoiced` is present in the schema CHECK (V2) but never entered in V1.
 *
 * ── APPEND-ONLY (house law) ────────────────────────────────────────────────────
 * No row is ever DELETEd. Draft line edits are done IN PLACE: updateDraftLines
 * UPDATEs existing (po_id, sku_id) rows and INSERTs genuinely-new SKUs — a
 * removed line is qty 0 (the review UI treats 0 as removed; transmission
 * rendering skips 0-qty). Replace-by-delete is FORBIDDEN.
 *
 * ── ADVISORY-NULL PRICING (A3) ─────────────────────────────────────────────────
 * price_cents_at_order comes from the latest vendor_price_history row for the
 * SKU's vendor_item; when none exists it stays null. A null price is advisory —
 * NEVER fabricated. vendor_price_history.unit_price is DOLLARS (numeric); the PO
 * line stores integer cents → Math.round(unit_price * 100).
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/session";
import { formatTime } from "@/lib/i18n/format";
import { etCalendarDate, operationalDayUtcRange } from "@/lib/operational-day";
import { etDayFromDate } from "@/lib/et-day-shared";
import { loadCreditsForDelivery } from "@/lib/credits";
import { emailOrderingAvailable, isPlausibleEmail } from "@/lib/po-email-shared";

/** KH+ read/write floor for the PO lifecycle (draft/confirm/place/receive + reads). */
export const PO_MIN = 4; // key_holder+
/** AGM+ floor for the terminal reconcile transition (mirrors credits RESOLVE). */
export const PO_RECONCILE_MIN = 6; // AGM+

type ServiceClient = ReturnType<typeof getServiceRoleClient>;

export class PurchaseOrderError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "PurchaseOrderError";
  }
}

function num(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function requireLevel(actor: AuthContext, min: number): void {
  if (getRoleLevel(actor.user.role) < min) {
    throw new PurchaseOrderError(403, "forbidden", "Insufficient role level for purchase orders");
  }
}
function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

// ── ET-anchored "today" (single authority; mirrors lib/ordering.ts etWalkDay) ────
/**
 * The ET calendar date + its day-of-week for cutoff evaluation and PO codes.
 * Vercel runs UTC; evening orders (exactly when shops order) must not roll into
 * tomorrow's date/dow. etCalendarDate gives the ET date; the dow derives from it
 * via the shared lib/et-day-shared.etDayFromDate — the ONE home for that
 * derivation (ordering.ts's etWalkDay delegates to the same helper; no import
 * cycle since et-day-shared is a pure leaf). NEVER inline a `new Date().getDay()`
 * in day-rule context — always go through here.
 */
function etToday(): { dateEt: string; dow: number; compactYmd: string } {
  const dateEt = etCalendarDate(new Date().toISOString()); // YYYY-MM-DD (America/New_York)
  const { dow } = etDayFromDate(dateEt); // 0=Sun..6=Sat (order_day convention)
  const compactYmd = dateEt.replace(/-/g, ""); // YYYYMMDD for the display code
  return { dateEt, dow, compactYmd };
}

/**
 * The UTC instant of an ET wall-clock TIME on an ET calendar date, as an ISO
 * timestamptz. Reuses the exported operationalDayUtcRange (ET-midnight-as-UTC,
 * DST-correct) as the day anchor, then adds the cutoff's seconds-of-day. The
 * offset is fixed for the whole ET day (DST never flips mid-day), so
 * ET-midnight-UTC + seconds is the correct instant for any wall-clock time that
 * day — EXCEPT the ~1h DST-transition window, an accepted advisory slop (the
 * cutoff is a wall-clock INTENT per the 0174 comment, not an instant). `time` is
 * a bare "HH:MM[:SS]" (Postgres `time` render). Returns null on a malformed time.
 */
function etWallClockToUtcIso(dateEt: string, time: string): string | null {
  const parts = time.split(":");
  const h = Number(parts[0]);
  const m = Number(parts[1] ?? "0");
  const s = Number(parts[2] ?? "0");
  if (!Number.isInteger(h) || h < 0 || h > 23) return null;
  if (!Number.isFinite(m) || m < 0 || m > 59) return null;
  if (!Number.isFinite(s) || s < 0 || s > 59) return null;
  const { startIso } = operationalDayUtcRange(dateEt); // ET midnight (of dateEt) as a UTC instant
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return null;
  const secondsOfDay = h * 3600 + Math.floor(m) * 60 + Math.floor(s);
  return new Date(startMs + secondsOfDay * 1000).toISOString();
}

// ── Display code generation (spec §5b.3 / plan convention) ───────────────────────
/** First 6 alphanumeric characters of a vendor name, uppercased. Empty → "VENDOR". */
function vendorCodeFragment(vendorName: string): string {
  const alnum = vendorName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return alnum.slice(0, 6) || "VENDOR";
}

/**
 * The base display code `{location.code}-{YYYYMMDD ET}-{vendor first-6 alnum upper}`.
 * Collision within the day is uniquified by appending `-2`, `-3`, … (the base is
 * suffix "1" implicitly). Pure over its inputs.
 */
function baseDisplayCode(locationCode: string, compactYmd: string, vendorName: string): string {
  return `${locationCode}-${compactYmd}-${vendorCodeFragment(vendorName)}`;
}

/**
 * Resolve the next free display code for a base, given the codes already taken
 * today. The unsuffixed base is the first (suffix 1 implicit); then -2, -3, …
 * `taken` is the set of existing/reserved codes sharing the base. Bounded by
 * `limit` — an absurd collision count throws rather than spin forever.
 */
function nextFreeCode(base: string, taken: Set<string>, limit = 200): string {
  for (let suffix = 1; suffix <= limit; suffix++) {
    const code = suffix === 1 ? base : `${base}-${suffix}`;
    if (!taken.has(code)) return code;
  }
  throw new PurchaseOrderError(500, "display_code_exhausted", "Could not allocate a unique PO code");
}

export interface DraftLineInput {
  skuId: string;
  orderQty: number;
  orderUnitLabel?: string | null;
  note?: string | null;
}

export interface CreatedDraft {
  poId: string;
  vendorId: string;
  displayCode: string;
}

/**
 * Create one `draft` PO (+ its lines) per vendor from grouped order lines (KH+ +
 * location-bind). Called by the walker's submitParPass (par_pass birth) and by
 * cutoff surfacing's "generate draft" path (parPassEventId null). Per vendor:
 *   - resolve a unique display code (base + -2/-3 on same-day collision; the
 *     23505 unique-violation race is caught + retried at the next suffix, bounded);
 *   - snapshot each line's guide_position into guide_position_snapshot at creation;
 *   - one PO header + its lines, error-checked and sequential (house pattern).
 * Emits ONE `po.draft_created` audit row for the whole batch with the po_ids +
 * source. Vendors with no lines are skipped. Append-only.
 *
 * opts.noCodeSuffixRetry (generateDraftForVendor path): repurpose the display-code
 * unique index as the DAY-IDEMPOTENCY arbiter for a single-vendor generate. Instead
 * of retrying the 23505 at the next suffix (-2, -3…), attempt ONLY the unsuffixed
 * base code and, on a unique-violation, throw PurchaseOrderError(409, "po_exists").
 * This closes the double-call race generateDraftForVendor's pre-check can't (two
 * concurrent generates both pass the pre-check, then only ONE wins the base code).
 * TRADEOFF (documented): a PO that was PLACED earlier today already holds the base
 * code → a later generate 409s. Accepted — an order already went out for this
 * vendor today, so re-generating is exactly what we want to block; the walker path
 * (multi-vendor births, retry ON) is unaffected and still handles genuine seconds.
 */
export async function createDraftsFromLines(
  actor: AuthContext,
  locationId: string,
  byVendor: Map<string, DraftLineInput[]>,
  parPassEventId: string | null,
  opts?: { noCodeSuffixRetry?: boolean },
): Promise<CreatedDraft[]> {
  requireLevel(actor, PO_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new PurchaseOrderError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();

  // Only vendors that actually carry ≥1 line get a PO.
  const vendorIds = [...byVendor.keys()].filter((vid) => (byVendor.get(vid)?.length ?? 0) > 0);
  if (vendorIds.length === 0) return [];

  const { dateEt, compactYmd } = etToday();

  // Location code for the display code (NOT NULL text on locations).
  const { data: loc, error: locErr } = await sb.from("locations")
    .select("id, code").eq("id", locationId)
    .maybeSingle<{ id: string; code: string }>();
  if (locErr) throw new Error(`createDraftsFromLines location: ${locErr.message}`);
  if (!loc) throw new PurchaseOrderError(404, "not_found", "Location not found");

  // Batch: vendor names (for the code fragment) + guide positions for every SKU
  // across all vendors (one query — never per-SKU/per-vendor).
  const allSkuIds = [...new Set(vendorIds.flatMap((vid) => (byVendor.get(vid) ?? []).map((l) => l.skuId)))];
  const [{ data: vendorRows, error: vErr }, { data: skuRows, error: sErr }] = await Promise.all([
    sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
    allSkuIds.length
      ? sb.from("vendor_items").select("id, guide_position").in("id", allSkuIds)
          .returns<Array<{ id: string; guide_position: number | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; guide_position: number | null }>, error: null }),
  ]);
  if (vErr) throw new Error(`createDraftsFromLines vendors: ${vErr.message}`);
  if (sErr) throw new Error(`createDraftsFromLines skus: ${sErr.message}`);
  const vNameById = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));
  const guidePosBySku = new Map((skuRows ?? []).map((s) => [s.id, s.guide_position]));

  // Prefetch every existing display code for TODAY at this location so collision
  // resolution is in-memory (the 23505 retry handles the rare cross-request race).
  const { startIso, endExclusiveIso } = operationalDayUtcRange(dateEt);
  const { data: existingRows, error: exErr } = await sb.from("purchase_orders")
    .select("display_code")
    .eq("location_id", locationId)
    .gte("created_at", startIso).lt("created_at", endExclusiveIso)
    .returns<Array<{ display_code: string }>>();
  if (exErr) throw new Error(`createDraftsFromLines existing codes: ${exErr.message}`);
  const takenCodes = new Set((existingRows ?? []).map((r) => r.display_code));

  const created: CreatedDraft[] = [];
  // Sequential per vendor (house pattern — each insert error-checked; the code
  // uniqueness across vendors in THIS batch is preserved by adding to takenCodes).
  for (const vendorId of vendorIds) {
    const lines = byVendor.get(vendorId) ?? [];
    if (lines.length === 0) continue;
    const vendorName = vNameById.get(vendorId) ?? "(vendor)";
    const base = baseDisplayCode(loc.code, compactYmd, vendorName);

    let poId: string | null = null;
    let usedCode = "";
    // 23505 race retry: another request may claim a code between our in-memory scan
    // and the INSERT. On a unique-violation we add that code to takenCodes and
    // re-scan — nextFreeCode then skips it and yields the next free suffix. Bounded.
    // opts.noCodeSuffixRetry (generate path): ONE attempt at the base code only; a
    // 23505 means a PO already holds today's base code for this vendor → treat the
    // unique index as the day-idempotency arbiter and 409 `po_exists` (never suffix).
    for (let attempt = 0; attempt < 25; attempt++) {
      const code = nextFreeCode(base, takenCodes);
      const { data: po, error: poErr } = await sb.from("purchase_orders").insert({
        location_id: locationId,
        vendor_id: vendorId,
        par_pass_event_id: parPassEventId,
        display_code: code,
        status: "draft",
        created_by: actor.user.id,
      }).select("id").maybeSingle<{ id: string }>();
      if (poErr) {
        // 23505 = unique_violation on the display_code unique index.
        if ((poErr as { code?: string }).code === "23505") {
          if (opts?.noCodeSuffixRetry) {
            // The base code is already taken today → an order for this vendor already
            // exists (draft/confirmed/placed). Day-idempotency: reject the duplicate
            // generate rather than mint a -2 second order for the same day.
            throw new PurchaseOrderError(409, "po_exists", "A draft or confirmed order already exists today for this vendor");
          }
          // Walker path: mark taken and re-scan for the next free suffix.
          takenCodes.add(code);
          continue;
        }
        throw new Error(`createDraftsFromLines po insert: ${poErr.message}`);
      }
      if (!po) throw new Error("createDraftsFromLines po insert returned no row");
      poId = po.id;
      usedCode = code;
      takenCodes.add(code); // reserve for the rest of this batch
      break;
    }
    if (poId == null) {
      throw new PurchaseOrderError(500, "display_code_exhausted", "Could not allocate a unique PO code");
    }

    // Insert the PO's lines (guide_position snapshotted at creation; qty tolerated
    // fractional as par-pass qtys are; unit label carried from the walker line).
    const { error: lErr } = await sb.from("po_lines").insert(
      lines.map((l) => ({
        po_id: poId,
        sku_id: l.skuId,
        order_qty: l.orderQty,
        order_unit_label: l.orderUnitLabel ?? null,
        guide_position_snapshot: guidePosBySku.get(l.skuId) ?? null,
        note: l.note?.trim() || null,
      })),
    );
    if (lErr) throw new Error(`createDraftsFromLines lines: ${lErr.message}`);

    created.push({ poId, vendorId, displayCode: usedCode });
  }

  // ONE batch audit row (plan header: walker/cutoff births log once per batch).
  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "po.draft_created", resourceTable: "purchase_orders", resourceId: null,
    metadata: {
      po_ids: created.map((c) => c.poId),
      location_id: locationId,
      source: parPassEventId ? "par_pass" : "cutoff_draft",
      par_pass_event_id: parPassEventId,
    },
    ipAddress: null, userAgent: null,
  });

  return created;
}

// ── updateDraftLines: edit a draft's lines in place (append-only) ─────────────────
export interface DraftLineEdit {
  skuId: string;
  orderQty: number;
  note?: string | null;
}

/**
 * Edit a draft PO's lines (KH+ + location-bind). DRAFT-ONLY: a non-draft PO 409s
 * `not_draft` (frozen after Confirm). APPEND-ONLY: replace-by-delete is
 * FORBIDDEN — we UPDATE existing (po_id, sku_id) rows' qty/note (rowcount-checked)
 * and INSERT genuinely-new SKUs. Removing a line is expressed as qty 0 (the review
 * UI treats 0 as removed; transmission rendering skips 0-qty lines) — the row
 * survives as history. Duplicate SKUs in the input are rejected. guide_position is
 * NOT re-snapshotted here (creation-time snapshot is the anchor); a new SKU added
 * during a draft edit gets its current guide position.
 */
export async function updateDraftLines(
  actor: AuthContext,
  poId: string,
  lines: DraftLineEdit[],
): Promise<void> {
  requireLevel(actor, PO_MIN);
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PurchaseOrderError(400, "no_lines", "At least one line is required");
  }
  for (const l of lines) {
    if (typeof l.skuId !== "string" || !l.skuId) throw new PurchaseOrderError(400, "invalid_sku", "Each line needs a SKU");
    if (!Number.isFinite(l.orderQty) || l.orderQty < 0) throw new PurchaseOrderError(400, "invalid_qty", "Order qty must be zero or greater");
  }
  const skuIds = [...new Set(lines.map((l) => l.skuId))];
  if (skuIds.length !== lines.length) {
    throw new PurchaseOrderError(400, "duplicate_sku", "A SKU appears more than once");
  }

  const sb = getServiceRoleClient();
  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, location_id, status").eq("id", poId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (poErr) throw new Error(`updateDraftLines load: ${poErr.message}`);
  if (!po) throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  if (!lockLocationContext(actorLoc(actor), po.location_id)) {
    throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  }
  if (po.status !== "draft") {
    throw new PurchaseOrderError(409, "not_draft", "Only draft orders can be edited");
  }

  // Which SKUs already have a line on this PO (batch)?
  const { data: existing, error: exErr } = await sb.from("po_lines")
    .select("sku_id, guide_position_snapshot").eq("po_id", poId)
    .returns<Array<{ sku_id: string; guide_position_snapshot: number | null }>>();
  if (exErr) throw new Error(`updateDraftLines existing: ${exErr.message}`);
  const existingSkus = new Set((existing ?? []).map((r) => r.sku_id));

  const toUpdate = lines.filter((l) => existingSkus.has(l.skuId));
  const toInsert = lines.filter((l) => !existingSkus.has(l.skuId));

  // UPDATE each existing line in place (rowcount-checked per the silent-UPDATE law).
  for (const l of toUpdate) {
    const { error: uErr, count } = await sb.from("po_lines")
      .update({ order_qty: l.orderQty, note: l.note?.trim() || null }, { count: "exact" })
      .eq("po_id", poId).eq("sku_id", l.skuId);
    if (uErr) throw new Error(`updateDraftLines update: ${uErr.message}`);
    if (count === 0) throw new PurchaseOrderError(404, "not_found", "Line not found");
  }

  // INSERT genuinely-new SKUs (fetch their current guide positions in one batch).
  if (toInsert.length > 0) {
    const newSkuIds = toInsert.map((l) => l.skuId);
    const { data: skuRows, error: sErr } = await sb.from("vendor_items")
      .select("id, guide_position").in("id", newSkuIds)
      .returns<Array<{ id: string; guide_position: number | null }>>();
    if (sErr) throw new Error(`updateDraftLines new skus: ${sErr.message}`);
    const guidePosBySku = new Map((skuRows ?? []).map((s) => [s.id, s.guide_position]));
    const { error: iErr } = await sb.from("po_lines").insert(
      toInsert.map((l) => ({
        po_id: poId,
        sku_id: l.skuId,
        order_qty: l.orderQty,
        guide_position_snapshot: guidePosBySku.get(l.skuId) ?? null,
        note: l.note?.trim() || null,
      })),
    );
    if (iErr) throw new Error(`updateDraftLines insert: ${iErr.message}`);
  }

  // TOCTOU close (Fix 3): our draft-only guard above is a check-then-act — a concurrent
  // confirmPO can flip draft→confirmed AFTER we passed the guard but our po_lines writes
  // may still land. confirmPO's snapshot is frozen at its (earlier) linearizing flip, so
  // a write that landed after the flip is in po_lines but NOT in the confirmed snapshot
  // (which is authoritative for transmission/disputes). Re-read the status after writing;
  // if the PO is no longer a draft, tell the editor their last change missed the snapshot.
  const { data: after, error: aErr } = await sb.from("purchase_orders")
    .select("status").eq("id", poId)
    .maybeSingle<{ status: string }>();
  if (aErr) throw new Error(`updateDraftLines recheck: ${aErr.message}`);
  if (after && after.status !== "draft") {
    throw new PurchaseOrderError(
      409,
      "confirmed_during_edit",
      "This order was confirmed while you were editing — your last change did not make it into the confirmed snapshot",
    );
  }
}

// ── confirmPO: freeze the snapshot + governing cutoff ─────────────────────────────
interface SnapshotLine {
  skuId: string;
  name: string;
  itemNumber: string | null;
  qty: number;
  unitLabel: string | null;
  priceCents: number | null;
  guidePos: number | null;
}
interface ConfirmedSnapshot {
  displayCode: string;
  vendor: { id: string; name: string };
  lines: SnapshotLine[];
  confirmedBy: { id: string; name: string | null };
  confirmedAtEt: string;
}

/**
 * Confirm a draft PO → freeze the snapshot (KH+ + location-bind). DRAFT-ONLY (409
 * `not_draft`). Resolves price_cents_at_order per line from the latest
 * vendor_price_history row for the SKU's vendor_item (one batched query, newest by
 * effective_date then recorded_at; null when none — advisory, never fabricated;
 * unit_price is DOLLARS → round to cents), UPDATEs the lines with the frozen price,
 * builds the confirmed_snapshot jsonb (spec §2.2 shape), and stamps
 * cutoff_at_confirm when a vendor_cutoffs row governs today's ET day-of-week.
 *
 * ── LINEARIZATION: the status flip is STEP 1 (TOCTOU fix) ───────────────────────
 * The guarded draft→confirmed UPDATE (`.eq("status","draft")` + rowcount) runs
 * FIRST — it is the linearization point. Only after the row is ours do we load the
 * lines, price them, and write the snapshot (a SECOND, unguarded UPDATE — we own
 * the row now). This way any updateDraftLines writes that landed BEFORE the flip
 * are INCLUDED in the snapshot, and updateDraftLines' own post-write status
 * re-check (409 `confirmed_during_edit`) tells an editor whose write landed AFTER
 * the flip that it missed the snapshot. A concurrent double-confirm still loses the
 * race here (the second flip sees no draft row → 409). Audited `po.confirmed`.
 */
export async function confirmPO(actor: AuthContext, poId: string): Promise<void> {
  requireLevel(actor, PO_MIN);
  const sb = getServiceRoleClient();

  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, location_id, vendor_id, display_code, status").eq("id", poId)
    .maybeSingle<{ id: string; location_id: string; vendor_id: string; display_code: string; status: string }>();
  if (poErr) throw new Error(`confirmPO load: ${poErr.message}`);
  if (!po) throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  if (!lockLocationContext(actorLoc(actor), po.location_id)) {
    throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  }
  if (po.status !== "draft") {
    throw new PurchaseOrderError(409, "not_draft", "Only draft orders can be confirmed");
  }

  // STEP 1 — the LINEARIZATION POINT: guarded draft→confirmed flip FIRST. Only a
  // still-draft row transitions (race-safe: a concurrent double-confirm loses here).
  // Everything below runs on a row we now exclusively own — no further status guard
  // is needed for the snapshot write, and any updateDraftLines edit that raced ahead
  // of this flip is already visible to the line load that follows.
  const confirmedAt = new Date().toISOString();
  const { error: flipErr, count: flipCount } = await sb.from("purchase_orders")
    .update({ status: "confirmed", confirmed_by: actor.user.id, confirmed_at: confirmedAt }, { count: "exact" })
    .eq("id", poId).eq("status", "draft");
  if (flipErr) throw new Error(`confirmPO flip: ${flipErr.message}`);
  if (flipCount === 0) throw new PurchaseOrderError(409, "not_draft", "Order is no longer a draft");

  // Load the lines to price + snapshot (post-flip: includes any pre-flip edits).
  const { data: lineRows, error: lErr } = await sb.from("po_lines")
    .select("id, sku_id, order_qty, order_unit_label, guide_position_snapshot")
    .eq("po_id", poId).order("created_at", { ascending: true })
    .returns<Array<{ id: string; sku_id: string; order_qty: number | string; order_unit_label: string | null; guide_position_snapshot: number | null }>>();
  if (lErr) throw new Error(`confirmPO lines: ${lErr.message}`);
  const lines = lineRows ?? [];
  const skuIds = [...new Set(lines.map((l) => l.sku_id))];

  // Batch: SKU names/item numbers, latest price per SKU, vendor name, actor name.
  const [{ data: skuRows, error: sErr }, priceBySku, { data: vend, error: vErr }, { data: user, error: uuErr }] =
    await Promise.all([
      skuIds.length
        ? sb.from("vendor_items").select("id, name, item_number").in("id", skuIds)
            .returns<Array<{ id: string; name: string; item_number: string | null }>>()
        : Promise.resolve({ data: [] as Array<{ id: string; name: string; item_number: string | null }>, error: null }),
      loadLatestPriceCentsBySku(sb, skuIds),
      sb.from("vendors").select("id, name").eq("id", po.vendor_id).maybeSingle<{ id: string; name: string }>(),
      sb.from("users").select("id, name").eq("id", actor.user.id).maybeSingle<{ id: string; name: string | null }>(),
    ]);
  if (sErr) throw new Error(`confirmPO skus: ${sErr.message}`);
  if (vErr) throw new Error(`confirmPO vendor: ${vErr.message}`);
  if (uuErr) throw new Error(`confirmPO user: ${uuErr.message}`);
  const skuById = new Map((skuRows ?? []).map((s) => [s.id, s]));

  // Freeze the price onto each line (rowcount-checked). Null price → leave null.
  for (const l of lines) {
    const priceCents = priceBySku.get(l.sku_id) ?? null;
    const { error: puErr, count } = await sb.from("po_lines")
      .update({ price_cents_at_order: priceCents }, { count: "exact" })
      .eq("id", l.id);
    if (puErr) throw new Error(`confirmPO price update: ${puErr.message}`);
    // count === 0 tolerated: po_lines are append-only (a line cannot vanish) and we are
    // PAST the status flip — throwing here would strand the row confirmed-without-snapshot.
    // A missing price on one line is advisory-null anyway; log and continue.
    if (count === 0) console.error(`confirmPO: line ${l.id} missing during price freeze (po ${poId}) — continuing`);
  }

  // Governing cutoff for today's ET day-of-week (location null-or-match, active).
  const { dateEt, dow } = etToday();
  const cutoffAtConfirm = await resolveGoverningCutoffIso(sb, po.vendor_id, po.location_id, dateEt, dow);

  // THE SNAPSHOT IS AUTHORITATIVE for transmission/disputes. It is built here from the
  // lines as they stood AFTER the linearizing status flip above. po_lines rows serve
  // queries and may diverge from the snapshot in the narrow race window (an
  // updateDraftLines write that lands AFTER the flip touches po_lines but never the
  // frozen snapshot) — updateDraftLines' post-write status re-check throws
  // `confirmed_during_edit` in exactly that case so the editor learns their last change
  // did not make it in. Never treat po_lines as the confirmed truth; read the snapshot.
  const snapshot: ConfirmedSnapshot = {
    displayCode: po.display_code,
    vendor: { id: po.vendor_id, name: vend?.name ?? "(vendor)" },
    lines: lines.map((l) => {
      const sku = skuById.get(l.sku_id);
      return {
        skuId: l.sku_id,
        name: sku?.name ?? "(sku)",
        itemNumber: sku?.item_number ?? null,
        qty: num(l.order_qty) ?? 0,
        unitLabel: l.order_unit_label,
        priceCents: priceBySku.get(l.sku_id) ?? null,
        guidePos: l.guide_position_snapshot,
      };
    }),
    confirmedBy: { id: actor.user.id, name: user?.name ?? null },
    // House ET formatting — the human-readable confirm time in the operational TZ.
    confirmedAtEt: formatTime(confirmedAt, actor.user.language),
  };

  // STEP 2 — write the snapshot + cutoff onto the row we already own (status flipped
  // to confirmed in step 1). NO status guard needed here: the linearization already
  // happened, so this UPDATE cannot lose a race (only this call owns the confirmed
  // transition). confirmed_by/at were stamped in step 1; we set them again idempotently
  // for a single coherent confirmed record.
  const { error: cErr } = await sb.from("purchase_orders")
    .update({
      confirmed_snapshot: snapshot,
      confirmed_by: actor.user.id,
      confirmed_at: confirmedAt,
      cutoff_at_confirm: cutoffAtConfirm,
    })
    .eq("id", poId);
  if (cErr) throw new Error(`confirmPO snapshot: ${cErr.message}`);

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "po.confirmed", resourceTable: "purchase_orders", resourceId: poId,
    metadata: { location_id: po.location_id, vendor_id: po.vendor_id, display_code: po.display_code, cutoff_at_confirm: cutoffAtConfirm },
    ipAddress: null, userAgent: null,
  });
}

/**
 * Latest price (in CENTS) per SKU from vendor_price_history. ONE batched query
 * over the SKU set, ordered newest-first by effective_date then recorded_at; the
 * FIRST row seen per vendor_item wins. unit_price is DOLLARS (numeric) → cents via
 * Math.round(× 100). A SKU with no price row is absent from the map (→ advisory
 * null at the call site — never fabricated). Bounded by the SKU set; no per-SKU I/O.
 */
async function loadLatestPriceCentsBySku(sb: ServiceClient, skuIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (skuIds.length === 0) return out;
  const { data, error } = await sb.from("vendor_price_history")
    .select("vendor_item_id, unit_price, effective_date, recorded_at")
    .in("vendor_item_id", skuIds)
    .order("effective_date", { ascending: false })
    .order("recorded_at", { ascending: false, nullsFirst: false })
    .returns<Array<{ vendor_item_id: string; unit_price: number | string; effective_date: string; recorded_at: string | null }>>();
  if (error) throw new Error(`loadLatestPriceCentsBySku: ${error.message}`);
  for (const r of data ?? []) {
    if (out.has(r.vendor_item_id)) continue; // desc order → first seen is the latest.
    const dollars = num(r.unit_price);
    // Epsilon-safe dollars→cents: bare `dollars * 100` inherits binary-float error
    // (the 0.1 + 0.2 class — e.g. 19.99 * 100 = 1998.9999999999998), and Math.round
    // usually saves it but not at every value. Fix the scaled value to 4 decimals
    // FIRST (killing the sub-cent float noise) then round to an integer cent.
    if (dollars != null) out.set(r.vendor_item_id, Math.round(Number((dollars * 100).toFixed(4))));
  }
  return out;
}

/**
 * The ISO timestamptz of today's GOVERNING cutoff for a vendor at a location, or
 * null when none governs. Matches active vendor_cutoffs rows for the vendor where
 * (location_id IS NULL OR location_id = the PO's location) AND order_day = today's
 * ET dow. When multiple match (a location-specific + a both-shops row), the
 * location-specific one wins (most specific); otherwise the EARLIEST cutoff_time
 * governs (the binding deadline). The chosen bare TIME is expressed on today's ET
 * date as a UTC instant (etWallClockToUtcIso). Returns null when no row matches or
 * the time is malformed (advisory — never fabricate a deadline).
 */
async function resolveGoverningCutoffIso(
  sb: ServiceClient,
  vendorId: string,
  locationId: string,
  dateEt: string,
  dow: number,
): Promise<string | null> {
  const { data, error } = await sb.from("vendor_cutoffs")
    .select("location_id, cutoff_time")
    .eq("vendor_id", vendorId).eq("active", true).eq("order_day", dow)
    .or(`location_id.is.null,location_id.eq.${locationId}`)
    .returns<Array<{ location_id: string | null; cutoff_time: string }>>();
  if (error) throw new Error(`resolveGoverningCutoffIso: ${error.message}`);
  const rows = data ?? [];
  if (rows.length === 0) return null;

  // Most-specific wins: prefer a location-scoped row over a both-shops row.
  const scoped = rows.filter((r) => r.location_id === locationId);
  const pool = scoped.length > 0 ? scoped : rows;
  // Earliest cutoff_time is the binding deadline (bare "HH:MM[:SS]" sorts lexically).
  pool.sort((a, b) => a.cutoff_time.localeCompare(b.cutoff_time));
  return etWallClockToUtcIso(dateEt, pool[0]!.cutoff_time);
}

// ── markPlaced / recordPlacement: record transmission + placed metadata ───────────
export interface MarkPlacedInput {
  channel: "email" | "sms" | "phone" | "portal" | "in_person";
  target?: string | null;
  note?: string | null;
}
const PLACEMENT_CHANNELS = new Set(["email", "sms", "phone", "portal", "in_person"]);

/**
 * The one-and-only confirmed→placed placement machinery (spec V2 §3). Extends
 * MarkPlacedInput with an optional `providerMessageId` (Resend id from the auto-email
 * adapter; null for every manual placement). lib/po-email.ts's sendOrderEmail emits
 * its own `po.email_sent` audit AFTER placement completes (send→place causally; the
 * audit rows land place→email, both fail-open) — the flip logic exists EXACTLY ONCE.
 */
export interface RecordPlacementInput extends MarkPlacedInput {
  /** Resend message id when placed by the auto-email adapter; null for manual tiers. */
  providerMessageId?: string | null;
}

/**
 * SHARED placement core (KH+ + location-bind) — the guarded confirmed→placed flip +
 * po_transmissions insert + `po.placed` audit, in ONE place. CONFIRMED-ONLY: a PO in
 * any other status 409s with a code naming the ACTUAL status (e.g. `not_confirmed` for
 * a draft, `already_placed` for a placed one). Writes placed_by/at/note in a single
 * guarded UPDATE (`.eq("status","confirmed")` + rowcount, race-safe), then INSERTs a
 * po_transmissions row (channel/target/sent_by/provider_message_id) — the durable
 * outbound record (spec §5c.1; every placement records how it went out, including
 * manual tiers). Audited `po.placed` { channel }.
 *
 * ── FLIP-FIRST LAW (V2-D1) ────────────────────────────────────────────────────────
 * When a `transmit` callback is supplied (the auto-email adapter), the guarded flip is
 * the LINEARIZATION POINT and runs BEFORE the transmission: of two concurrent sends,
 * exactly one wins the flip; the loser 409s having sent NOTHING — a double-tap can
 * never email a vendor twice. On transmit failure the claim is REVERTED (guarded
 * placed→confirmed, scoped to this actor's own claim) and the failure rethrown, so the
 * PO is back where it started with no transmission row. A transmission-row/audit
 * failure AFTER a successful transmit is tolerated with console.error (the email is
 * irreversible; placed is TRUE — a missing transmission row is a data gap, not a lie).
 * Without a callback (manual tiers) behavior is unchanged: no side effect precedes the
 * flip, and a transmission-insert failure still throws.
 *
 * Callers: markPlaced (manual tiers, providerMessageId null, no callback) and
 * sendOrderEmail (auto tier, transmit = the Resend send, which returns the provider id).
 */
export async function recordPlacement(
  actor: AuthContext,
  poId: string,
  input: RecordPlacementInput,
  transmit?: () => Promise<{ providerMessageId: string }>,
): Promise<void> {
  requireLevel(actor, PO_MIN);
  if (!input || !PLACEMENT_CHANNELS.has(input.channel)) {
    throw new PurchaseOrderError(400, "invalid_channel", "A valid placement channel is required");
  }
  const sb = getServiceRoleClient();

  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, location_id, status").eq("id", poId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (poErr) throw new Error(`recordPlacement load: ${poErr.message}`);
  if (!po) throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  if (!lockLocationContext(actorLoc(actor), po.location_id)) {
    throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  }
  if (po.status !== "confirmed") {
    // Name the actual status: already_placed / already_received / already_reconciled
    // for a forward status; not_confirmed for draft (must confirm first).
    const code = po.status === "draft" ? "not_confirmed" : `already_${po.status}`;
    throw new PurchaseOrderError(409, code, `Order is ${po.status}, not confirmed`);
  }

  const target = input.target?.trim() || null;
  const note = input.note?.trim() || null;
  const placedAt = new Date().toISOString();

  const { error: uErr, count } = await sb.from("purchase_orders")
    .update({ status: "placed", placed_by: actor.user.id, placed_at: placedAt, placed_note: note }, { count: "exact" })
    .eq("id", poId).eq("status", "confirmed");
  if (uErr) throw new Error(`recordPlacement update: ${uErr.message}`);
  if (count === 0) throw new PurchaseOrderError(409, "not_confirmed", "Order is no longer confirmed");

  let providerMessageId = input.providerMessageId?.trim() || null;
  if (transmit) {
    try {
      providerMessageId = (await transmit()).providerMessageId;
    } catch (sendErr) {
      // Revert OUR claim only (status + placed_by must both match — never undo a rival's
      // placement). Rowcount 0 = the PO advanced in the microsecond window (practically
      // impossible; requires a completed intake) — log loudly, still rethrow the send error.
      const { error: rErr, count: rCount } = await sb.from("purchase_orders")
        .update({ status: "confirmed", placed_by: null, placed_at: null, placed_note: null }, { count: "exact" })
        .eq("id", poId).eq("status", "placed").eq("placed_by", actor.user.id);
      if (rErr || rCount === 0) {
        console.error(`recordPlacement: claim revert failed for po ${poId} (count=${rCount ?? 0}${rErr ? `, ${rErr.message}` : ""}) — status may need attention`);
      }
      throw sendErr;
    }
  }

  // Durable transmission record (append-only) — the outbound half of the linking
  // requirement. After a successful transmit the email is irreversible, so a failure
  // here is tolerated (logged); on the manual path it remains a real error.
  const { error: tErr } = await sb.from("po_transmissions").insert({
    po_id: poId, channel: input.channel, target, sent_by: actor.user.id, note,
    provider_message_id: providerMessageId,
  });
  if (tErr) {
    if (transmit) console.error(`recordPlacement: transmission row failed for po ${poId} after successful send — ${tErr.message}`);
    else throw new Error(`recordPlacement transmission: ${tErr.message}`);
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "po.placed", resourceTable: "purchase_orders", resourceId: poId,
    metadata: { location_id: po.location_id, channel: input.channel, target, provider_message_id: providerMessageId },
    ipAddress: null, userAgent: null,
  });
}

/**
 * Mark a confirmed PO as placed via a MANUAL tier (KH+ + location-bind). Thin wrapper
 * over recordPlacement with no provider_message_id — the status-flip logic lives once,
 * in recordPlacement. Existing callers (route `place` action) are unchanged.
 */
export async function markPlaced(actor: AuthContext, poId: string, input: MarkPlacedInput): Promise<void> {
  await recordPlacement(actor, poId, { ...input, providerMessageId: null });
}

// ── advanceToReceived: service-internal placed→received (called by receiving) ─────
/**
 * Advance a `placed` PO to `received` (SERVICE-INTERNAL — no actor; lib/receiving.ts
 * calls this on its completeDelivery path when a delivery links the PO). Guarded
 * placed→received UPDATE + rowcount. When the PO is NOT in `placed` (already
 * received, still draft/confirmed, etc.) this is a SILENT no-op returning false —
 * the caller decides what that means (e.g. a second delivery claiming an already-
 * received PO). Audits `po.received` with actorId null (machine — same precedent
 * as the delivery auto-link path). Returns true when it advanced.
 */
export async function advanceToReceived(sb: ServiceClient, poId: string): Promise<boolean> {
  // Guarded placed→received with RETURNING: the returned row IS the rowcount signal
  // (proven idiom, lib/portal/session.ts). A missed guard returns no row → false.
  const { data: po, error } = await sb.from("purchase_orders")
    .update({ status: "received" })
    .eq("id", poId).eq("status", "placed")
    .select("id, location_id, vendor_id")
    .maybeSingle<{ id: string; location_id: string; vendor_id: string }>();
  if (error) throw new Error(`advanceToReceived: ${error.message}`);
  if (!po) return false; // not in `placed` → silent no-op (caller decides).

  await audit({
    actorId: null, actorRole: null,
    action: "po.received", resourceTable: "purchase_orders", resourceId: poId,
    metadata: { location_id: po.location_id, vendor_id: po.vendor_id, actor_context: "delivery_auto_advance" },
    ipAddress: null, userAgent: null,
  });
  return true;
}

// ── markReconciled: the thin AGM+ terminal transition ────────────────────────────
/**
 * Mark a received PO reconciled (AGM+ + location-bind). RECEIVED-ONLY (409 with a
 * status-naming code). Requires ZERO open credits (status open|in_progress) on the
 * PO's linked deliveries — 409 `open_credits` (with the count) otherwise. Single
 * guarded received→reconciled UPDATE + rowcount (race-safe). Audited
 * `po.reconciled`. Append-only.
 */
export async function markReconciled(actor: AuthContext, poId: string): Promise<void> {
  requireLevel(actor, PO_RECONCILE_MIN);
  const sb = getServiceRoleClient();

  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, location_id, status").eq("id", poId)
    .maybeSingle<{ id: string; location_id: string; status: string }>();
  if (poErr) throw new Error(`markReconciled load: ${poErr.message}`);
  if (!po) throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  if (!lockLocationContext(actorLoc(actor), po.location_id)) {
    throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  }
  if (po.status !== "received") {
    const code = po.status === "reconciled" ? "already_reconciled" : "not_received";
    throw new PurchaseOrderError(409, code, `Order is ${po.status}, not received`);
  }

  // Linked deliveries + their open credits. Open credits block reconcile.
  const { data: deliveries, error: dErr } = await sb.from("vendor_deliveries")
    .select("id").eq("purchase_order_id", poId)
    .returns<Array<{ id: string }>>();
  if (dErr) throw new Error(`markReconciled deliveries: ${dErr.message}`);
  const deliveryIds = (deliveries ?? []).map((d) => d.id);
  if (deliveryIds.length > 0) {
    const { count: openCount, error: cErr } = await sb.from("vendor_credits")
      .select("id", { count: "exact", head: true })
      .in("delivery_id", deliveryIds).in("status", ["open", "in_progress"]);
    if (cErr) throw new Error(`markReconciled open credits: ${cErr.message}`);
    if ((openCount ?? 0) > 0) {
      throw new PurchaseOrderError(409, "open_credits", `${openCount} open credit(s) must be resolved first`);
    }
  }

  const { error: uErr, count } = await sb.from("purchase_orders")
    .update({ status: "reconciled" }, { count: "exact" })
    .eq("id", poId).eq("status", "received");
  if (uErr) throw new Error(`markReconciled update: ${uErr.message}`);
  if (count === 0) throw new PurchaseOrderError(409, "not_received", "Order is no longer received");

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role,
    action: "po.reconciled", resourceTable: "purchase_orders", resourceId: poId,
    metadata: { location_id: po.location_id, delivery_count: deliveryIds.length },
    ipAddress: null, userAgent: null,
  });
}

// ── Loaders (KH+ + location-bind) ────────────────────────────────────────────────
export interface TodaysOrderVendor {
  poId: string;
  displayCode: string;
  vendorId: string;
  vendorName: string;
  status: string;
  lineCount: number;
}

/**
 * POs created TODAY (ET day window) at a location, one entry per PO, grouped/sorted
 * by vendor name (KH+ + location-bind). The ET day window is derived from the ET
 * calendar date via operationalDayUtcRange (DST-correct UTC range over created_at).
 * Batches the vendor-name + line-count lookups (never per-PO).
 */
export async function loadTodaysOrders(actor: AuthContext, locationId: string): Promise<TodaysOrderVendor[]> {
  requireLevel(actor, PO_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new PurchaseOrderError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { dateEt } = etToday();
  const { startIso, endExclusiveIso } = operationalDayUtcRange(dateEt);

  const { data: pos, error } = await sb.from("purchase_orders")
    .select("id, display_code, vendor_id, status, created_at")
    .eq("location_id", locationId)
    .gte("created_at", startIso).lt("created_at", endExclusiveIso)
    .order("created_at", { ascending: false })
    .returns<Array<{ id: string; display_code: string; vendor_id: string; status: string; created_at: string }>>();
  if (error) throw new Error(`loadTodaysOrders: ${error.message}`);
  const list = pos ?? [];
  if (list.length === 0) return [];

  const poIds = list.map((p) => p.id);
  const vendorIds = [...new Set(list.map((p) => p.vendor_id))];
  const [{ data: vendorRows, error: vErr }, { data: lineRows, error: lErr }] = await Promise.all([
    sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
    sb.from("po_lines").select("po_id").in("po_id", poIds).returns<Array<{ po_id: string }>>(),
  ]);
  if (vErr) throw new Error(`loadTodaysOrders vendors: ${vErr.message}`);
  if (lErr) throw new Error(`loadTodaysOrders lines: ${lErr.message}`);
  const vName = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));
  const lineCount = new Map<string, number>();
  for (const l of lineRows ?? []) lineCount.set(l.po_id, (lineCount.get(l.po_id) ?? 0) + 1);

  return list
    .map((p) => ({
      poId: p.id,
      displayCode: p.display_code,
      vendorId: p.vendor_id,
      vendorName: vName.get(p.vendor_id) ?? "(vendor)",
      status: p.status,
      lineCount: lineCount.get(p.id) ?? 0,
    }))
    .sort((a, b) => a.vendorName.localeCompare(b.vendorName));
}

export interface PoHistoryRow {
  poId: string;
  displayCode: string;
  vendorId: string;
  vendorName: string;
  status: string;
  createdAt: string;
  confirmedAt: string | null;
  placedAt: string | null;
  lineCount: number;
}

/**
 * Recent POs at a location (KH+ + location-bind), newest first, limited. Batches
 * vendor names + line counts (never per-PO).
 */
export async function loadPoHistory(actor: AuthContext, locationId: string, limit = 20): Promise<PoHistoryRow[]> {
  requireLevel(actor, PO_MIN);
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new PurchaseOrderError(404, "not_found", "Location not found");
  }
  const sb = getServiceRoleClient();
  const { data: pos, error } = await sb.from("purchase_orders")
    .select("id, display_code, vendor_id, status, created_at, confirmed_at, placed_at")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<Array<{ id: string; display_code: string; vendor_id: string; status: string; created_at: string; confirmed_at: string | null; placed_at: string | null }>>();
  if (error) throw new Error(`loadPoHistory: ${error.message}`);
  const list = pos ?? [];
  if (list.length === 0) return [];

  const poIds = list.map((p) => p.id);
  const vendorIds = [...new Set(list.map((p) => p.vendor_id))];
  const [{ data: vendorRows, error: vErr }, { data: lineRows, error: lErr }] = await Promise.all([
    sb.from("vendors").select("id, name").in("id", vendorIds).returns<Array<{ id: string; name: string }>>(),
    sb.from("po_lines").select("po_id").in("po_id", poIds).returns<Array<{ po_id: string }>>(),
  ]);
  if (vErr) throw new Error(`loadPoHistory vendors: ${vErr.message}`);
  if (lErr) throw new Error(`loadPoHistory lines: ${lErr.message}`);
  const vName = new Map((vendorRows ?? []).map((v) => [v.id, v.name]));
  const lineCount = new Map<string, number>();
  for (const l of lineRows ?? []) lineCount.set(l.po_id, (lineCount.get(l.po_id) ?? 0) + 1);

  return list.map((p) => ({
    poId: p.id,
    displayCode: p.display_code,
    vendorId: p.vendor_id,
    vendorName: vName.get(p.vendor_id) ?? "(vendor)",
    status: p.status,
    createdAt: p.created_at,
    confirmedAt: p.confirmed_at,
    placedAt: p.placed_at,
    lineCount: lineCount.get(p.id) ?? 0,
  }));
}

export interface PoDetailLine {
  skuId: string;
  skuName: string;
  itemNumber: string | null;
  orderQty: number;
  orderUnitLabel: string | null;
  priceCentsAtOrder: number | null;
  guidePositionSnapshot: number | null;
  note: string | null;
}
export interface PoTransmissionRow {
  id: string;
  channel: string;
  target: string | null;
  sentAt: string;
  sentByName: string | null;
  note: string | null;
}
export interface PoStatusEvent {
  status: string;
  at: string;
}
/** One vendor contact for the manual-tier transmit card (accepts_text_orders badged, D5). */
export interface PoTransmitContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  acceptsTextOrders: boolean;
}
/** One vendor ordering-detail affordance (method/value/label) — reused by the transmit block. */
export interface PoTransmitOrderingDetail {
  method: string; // email | url | phone | portal | other
  value: string;
  label: string | null;
}
/**
 * The tier-appropriate transmit context for the CONFIRMED state (spec §3). The panel
 * renders: manual → contact cards (accepts_text_orders badged) + ordering-detail
 * affordances; assisted → portal deep link + guide-position-sorted lines. All fields are
 * read-only vendor config — the panel never mutates them. Contacts/details are active-only.
 */
export interface PoTransmit {
  tier: "auto" | "assisted" | "manual";
  portalUrl: string | null;
  contacts: PoTransmitContact[];
  orderingDetails: PoTransmitOrderingDetail[];
  /** V2 §3/§6: is the auto-email leg awake for THIS PO's location? Derived from the
   *  location alias + EMAIL_FROM domain via the pure emailOrderingAvailable (no env
   *  leaks to the client). The panel shows the Send-to-vendor preview when true;
   *  the server re-checks at send time (409 `email_dormant`). Manual affordances
   *  render regardless (no pipe blocks ordering). */
  emailOrderingAvailable: boolean;
  /** V2-D3: the ACTIVE email-method ordering-detail addresses (plausible-email
   *  filtered) — the auto tier's recipients (rep + orders desk both see it). The
   *  panel shows the count + first N; the AUTHORITATIVE recipient list is re-derived
   *  server-side in sendOrderEmail (client never composes the send). */
  orderEmailRecipients: string[];
}
export interface PoDetail {
  poId: string;
  displayCode: string;
  locationId: string;
  vendorId: string;
  vendorName: string;
  status: string;
  parPassEventId: string | null;
  confirmedSnapshot: unknown | null;
  cutoffAtConfirm: string | null;
  createdAt: string;
  confirmedAt: string | null;
  placedAt: string | null;
  placedNote: string | null;
  lines: PoDetailLine[];
  transmissions: PoTransmissionRow[];
  deliveryIds: string[];
  /** Open-credit summary across the linked deliveries (open|in_progress count). */
  credits: { openCount: number; totalCount: number };
  /** Status timeline derived from the row's OWN timestamps (not the audit log). */
  timeline: PoStatusEvent[];
  /** Tier-appropriate transmit context (vendor config; read-only). Powers the confirmed
   *  state's contact card / portal deep link (spec §3). */
  transmit: PoTransmit;
}

/**
 * One PO's full detail (KH+ read; location-bind via the PO's OWN location_id —
 * IDOR). Returns the joined lines, the frozen snapshot, transmissions, linked
 * delivery ids, a credits summary across those deliveries (reusing
 * loadCreditsForDelivery from lib/credits.ts — same server-side authority + bind),
 * and a status timeline built from the row's own created/confirmed/placed
 * timestamps (received/reconciled carry no dedicated column in V1, so the timeline
 * ends at the last stamped transition + the current status). All lookups batched.
 */
export async function loadPoDetail(actor: AuthContext, poId: string): Promise<PoDetail> {
  requireLevel(actor, PO_MIN);
  const sb = getServiceRoleClient();

  const { data: po, error: poErr } = await sb.from("purchase_orders")
    .select("id, location_id, vendor_id, display_code, status, par_pass_event_id, confirmed_snapshot, cutoff_at_confirm, created_at, confirmed_at, placed_at, placed_note")
    .eq("id", poId)
    .maybeSingle<{
      id: string; location_id: string; vendor_id: string; display_code: string; status: string;
      par_pass_event_id: string | null; confirmed_snapshot: unknown | null; cutoff_at_confirm: string | null;
      created_at: string; confirmed_at: string | null; placed_at: string | null; placed_note: string | null;
    }>();
  if (poErr) throw new Error(`loadPoDetail load: ${poErr.message}`);
  if (!po) throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  if (!lockLocationContext(actorLoc(actor), po.location_id)) {
    throw new PurchaseOrderError(404, "not_found", "Purchase order not found");
  }

  // Lines + transmissions + vendor (w/ transmit config) + linked deliveries + the vendor's
  // active contacts + ordering details (batched — the transmit block's read is server-side).
  const [
    { data: lineRows, error: lErr },
    { data: txRows, error: tErr },
    { data: vend, error: vErr },
    { data: delivRows, error: dErr },
    { data: contactRows, error: ctErr },
    { data: orderingRows, error: orErr },
    { data: locRow, error: locErr },
  ] = await Promise.all([
    sb.from("po_lines")
      .select("sku_id, order_qty, order_unit_label, price_cents_at_order, guide_position_snapshot, note")
      .eq("po_id", poId).order("guide_position_snapshot", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true })
      .returns<Array<{ sku_id: string; order_qty: number | string; order_unit_label: string | null; price_cents_at_order: number | null; guide_position_snapshot: number | null; note: string | null }>>(),
    sb.from("po_transmissions")
      .select("id, channel, target, sent_at, sent_by, note")
      .eq("po_id", poId).order("sent_at", { ascending: true })
      .returns<Array<{ id: string; channel: string; target: string | null; sent_at: string; sent_by: string | null; note: string | null }>>(),
    sb.from("vendors").select("id, name, transmission_tier, portal_url").eq("id", po.vendor_id)
      .maybeSingle<{ id: string; name: string; transmission_tier: string | null; portal_url: string | null }>(),
    sb.from("vendor_deliveries").select("id").eq("purchase_order_id", poId).returns<Array<{ id: string }>>(),
    sb.from("vendor_contacts")
      .select("id, name, email, phone, accepts_text_orders, display_order")
      .eq("vendor_id", po.vendor_id).eq("active", true).order("display_order", { ascending: true })
      .returns<Array<{ id: string; name: string; email: string | null; phone: string | null; accepts_text_orders: boolean | null; display_order: number }>>(),
    sb.from("vendor_ordering_details")
      .select("method, value, label, display_order")
      .eq("vendor_id", po.vendor_id).eq("active", true).order("display_order", { ascending: true })
      .returns<Array<{ method: string; value: string; label: string | null; display_order: number }>>(),
    // The PO location's outbound alias — FROM/reply-to for the auto tier + half the
    // emailOrderingAvailable gate (V2-D3, §6 row 1). Bound by po.location_id (own row).
    sb.from("locations").select("receipt_email_address").eq("id", po.location_id)
      .maybeSingle<{ receipt_email_address: string | null }>(),
  ]);
  if (lErr) throw new Error(`loadPoDetail lines: ${lErr.message}`);
  if (tErr) throw new Error(`loadPoDetail transmissions: ${tErr.message}`);
  if (vErr) throw new Error(`loadPoDetail vendor: ${vErr.message}`);
  if (dErr) throw new Error(`loadPoDetail deliveries: ${dErr.message}`);
  if (ctErr) throw new Error(`loadPoDetail contacts: ${ctErr.message}`);
  if (orErr) throw new Error(`loadPoDetail ordering details: ${orErr.message}`);
  if (locErr) throw new Error(`loadPoDetail location: ${locErr.message}`);

  // The transmit block (spec §3): tier + portal + active contacts (accepts_text_orders
  // badged) + ordering-detail affordances. Tier defaults to manual (D4 — every vendor
  // seeds at the lowest pipe); an unexpected value falls back to manual, never crashes.
  const rawTier = vend?.transmission_tier ?? "manual";
  const tier: PoTransmit["tier"] = rawTier === "assisted" || rawTier === "auto" ? rawTier : "manual";
  const orderingDetails = (orderingRows ?? []).map((o) => ({ method: o.method, value: o.value, label: o.label }));
  // Auto-tier availability + recipients (V2-D3, §6 row 1). Availability is the pure
  // location-alias × EMAIL_FROM-domain gate; recipients are the active email-method
  // ordering details, plausible-email filtered + de-duped (case-insensitive). The
  // client gets these for the preview; sendOrderEmail re-derives authoritatively.
  const recipientSeen = new Set<string>();
  const orderEmailRecipients: string[] = [];
  for (const o of orderingDetails) {
    if (o.method !== "email") continue;
    const v = o.value.trim();
    if (!isPlausibleEmail(v)) continue;
    const key = v.toLowerCase();
    if (recipientSeen.has(key)) continue;
    recipientSeen.add(key);
    orderEmailRecipients.push(v);
  }
  const transmit: PoTransmit = {
    tier,
    portalUrl: vend?.portal_url ?? null,
    contacts: (contactRows ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      acceptsTextOrders: c.accepts_text_orders === true,
    })),
    orderingDetails,
    emailOrderingAvailable: emailOrderingAvailable(locRow?.receipt_email_address ?? null, process.env.EMAIL_FROM ?? null),
    orderEmailRecipients,
  };
  const lines = lineRows ?? [];
  const txs = txRows ?? [];
  const deliveryIds = (delivRows ?? []).map((d) => d.id);

  // SKU names + transmission sender names (batched).
  const skuIds = [...new Set(lines.map((l) => l.sku_id))];
  const senderIds = [...new Set(txs.map((t) => t.sent_by).filter((v): v is string => v != null))];
  const [{ data: skuRows, error: sErr }, { data: userRows, error: uErr }] = await Promise.all([
    skuIds.length
      ? sb.from("vendor_items").select("id, name, item_number").in("id", skuIds)
          .returns<Array<{ id: string; name: string; item_number: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; item_number: string | null }>, error: null }),
    senderIds.length
      ? sb.from("users").select("id, name").in("id", senderIds).returns<Array<{ id: string; name: string | null }>>()
      : Promise.resolve({ data: [] as Array<{ id: string; name: string | null }>, error: null }),
  ]);
  if (sErr) throw new Error(`loadPoDetail skus: ${sErr.message}`);
  if (uErr) throw new Error(`loadPoDetail users: ${uErr.message}`);
  const skuById = new Map((skuRows ?? []).map((s) => [s.id, s]));
  const userName = new Map((userRows ?? []).map((u) => [u.id, u.name]));

  // Credits summary across the linked deliveries. Reuse lib/credits.ts loader
  // (same KH+ read + per-delivery location-bind) — no parallel query path.
  // V1 = single delivery per PO (spec non-goal); batch this loop when multi-delivery
  // lands (V2) — a per-delivery await is fine at V1's one-delivery cardinality.
  let openCount = 0;
  let totalCount = 0;
  for (const did of deliveryIds) {
    const rows = await loadCreditsForDelivery(actor, did);
    totalCount += rows.length;
    openCount += rows.filter((r) => r.status === "open" || r.status === "in_progress").length;
  }

  // Status timeline from the row's own timestamps (NOT the audit log). Each stamped
  // transition contributes an event; the current status is appended if it has no
  // dedicated timestamp column (received/reconciled in V1).
  const timeline: PoStatusEvent[] = [{ status: "draft", at: po.created_at }];
  if (po.confirmed_at) timeline.push({ status: "confirmed", at: po.confirmed_at });
  if (po.placed_at) timeline.push({ status: "placed", at: po.placed_at });
  if ((po.status === "received" || po.status === "reconciled") && !timeline.some((e) => e.status === po.status)) {
    // No dedicated received_at/reconciled_at column in V1 — surface the current
    // status without a fabricated timestamp (the transition instant lives in audit).
    timeline.push({ status: po.status, at: po.placed_at ?? po.confirmed_at ?? po.created_at });
  }

  return {
    poId: po.id,
    displayCode: po.display_code,
    locationId: po.location_id,
    vendorId: po.vendor_id,
    vendorName: vend?.name ?? "(vendor)",
    status: po.status,
    parPassEventId: po.par_pass_event_id,
    confirmedSnapshot: po.confirmed_snapshot,
    cutoffAtConfirm: po.cutoff_at_confirm,
    createdAt: po.created_at,
    confirmedAt: po.confirmed_at,
    placedAt: po.placed_at,
    placedNote: po.placed_note,
    lines: lines.map((l) => {
      const sku = skuById.get(l.sku_id);
      return {
        skuId: l.sku_id,
        skuName: sku?.name ?? "(sku)",
        itemNumber: sku?.item_number ?? null,
        orderQty: num(l.order_qty) ?? 0,
        orderUnitLabel: l.order_unit_label,
        priceCentsAtOrder: l.price_cents_at_order,
        guidePositionSnapshot: l.guide_position_snapshot,
        note: l.note,
      };
    }),
    transmissions: txs.map((t) => ({
      id: t.id,
      channel: t.channel,
      target: t.target,
      sentAt: t.sent_at,
      sentByName: t.sent_by ? userName.get(t.sent_by) ?? null : null,
      note: t.note,
    })),
    deliveryIds,
    credits: { openCount, totalCount },
    timeline,
    transmit,
  };
}
