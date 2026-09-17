/**
 * lib/barcodes.ts — the receiving door's barcode memory (V3-B §5). DB layer over the pure laws.
 *
 * THE PURE SURFACE LIVES IN `lib/barcodes-shared.ts` and is re-exported here, because this
 * file imports the service-role client and `ScanField` is a client island. Server consumers
 * import either path; client code must import the shared module directly — the AGENTS.md
 * § Module boundaries split, the same shape `lib/order-guides.ts` ships for V3-A.
 *
 * THERE IS NO DELIVERY ID AT THE DOOR. `components/receiving/ReceivingForm.tsx` holds its
 * lines in client state and the `vendor_deliveries` row is not created until submit, so the
 * spec's `deliveryId` key reads as **`vendorId` + `locationId`** (both known while the form
 * is open) everywhere in this module. "Which codes were taught on delivery X" is still a
 * query on the audit log, by vendor + day: every teach row carries `vendor_id`,
 * `location_id`, and the `invoice_number` typed so far (nullable — the receiver may scan
 * the first case before keying the invoice).
 *
 * Three laws this file owns, and the reasons they are here rather than in a route:
 *
 *   LOCATION FIRST. Each entry point binds the actor to the location before it touches the
 *   database (`lockLocationContext`, 404 `not_found` — the same shape `lib/receiving.ts`
 *   uses at :241 and :410). The routes could not do this for us without duplicating the
 *   refusal three times, which is precisely the BC-asymmetry class the CI bind test watches.
 *
 *   FORGOTTEN ROWS ARE INVISIBLE. `forget` is a soft delete (0206's partial unique index
 *   covers live rows only), so every read carries `.is("forgotten_at", null)` and a
 *   forgotten code can be re-taught cleanly.
 *
 *   TEACHING ADDS, NEVER REWRITES. A code already taught for this SKU at this level is a
 *   no-op with no audit row. At ANOTHER level it is a 409 `level_differs` carrying the
 *   stored level; only an explicit `confirmLevelChange` inserts the second level, and both
 *   meanings then stand (spec §11 finding 6 — the same UPC really is printed on the case
 *   and on the inner pack).
 */
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import {
  normalizeCode,
  resolveScan,
  type Level,
  type NormalizedCode,
  type ScanContext,
  type ScanMatch,
  type Symbology,
} from "@/lib/barcodes-shared";

export {
  dedupeCameraDecode,
  gs1Gtin,
  gtinCheckOk,
  normalizeCode,
  resolveScan,
  ScanBurst,
} from "@/lib/barcodes-shared";
export type {
  Level,
  NormalizedCode,
  ScanContext,
  ScanMatch,
  Symbology,
  TaughtCode,
} from "@/lib/barcodes-shared";

/**
 * = RECEIVE_MIN (4, key holder). Scanning is not a new privilege — it is a faster hand on
 * the same door the stepper already opens, so it sits on the receiving floor deliberately
 * (spec §11 finding 1: receivers ARE key holders).
 */
export const SCAN_MIN = 4;

/** The symbology vocabulary, mirroring 0206's check constraint. The routes validate against it. */
export const SYMBOLOGIES: readonly Symbology[] = [
  "ean_13",
  "upc_a",
  "code_128",
  "gs1_128",
  "itf_14",
  "qr",
  "unknown",
] as const;

/**
 * `extra` carries the one or two fields a specific refusal needs the client to branch on —
 * today only `storedLevel` on 409 `level_differs`. The routes spread it into the error body,
 * so a new field reaches the client without a new mapping branch per route.
 */
export class BarcodeError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "BarcodeError";
  }
}

function actorLoc(actor: AuthContext): LocationActor {
  return { role: actor.user.role, locations: actor.locations };
}

function bind(actor: AuthContext, locationId: string): void {
  if (!lockLocationContext(actorLoc(actor), locationId)) {
    throw new BarcodeError(404, "not_found", "Location not found");
  }
}

function normalizeOrRefuse(code: string): NormalizedCode {
  const normalized = normalizeCode(code);
  if (!normalized) throw new BarcodeError(400, "invalid_code", "That is too short to be a barcode");
  return normalized;
}

/** One `sku_barcodes` row with its SKU's vendor and product embedded (the `!inner` join). */
interface TaughtRow {
  code: string;
  sku_id: string;
  level: Level;
  vendor_items: { vendor_id: string | null; product_id: string | null };
}

/**
 * A scan → what it means on THIS vendor's delivery at THIS location. Read-only, no audit
 * (spec §5: a lookup is a question, not an act).
 *
 * Two queries, both narrow: every live row for the normalised code (across all vendors —
 * the twin lane needs the other vendor's row), and this vendor's active SKUs with their
 * product id, which is what lets `resolveScan` offer this vendor's twin of a code taught on
 * someone else's shelf. The `normalized` code travels back with the match because the client
 * teaches, steps and forgets against the stored key, never against the raw label.
 */
export async function lookupScan(
  actor: AuthContext,
  input: { vendorId: string; locationId: string; code: string; lineSkuIds: string[] },
): Promise<ScanMatch & { normalized: NormalizedCode }> {
  bind(actor, input.locationId);
  const normalized = normalizeOrRefuse(input.code);

  const sb = getServiceRoleClient();
  const { data: rows, error } = await sb
    .from("sku_barcodes")
    .select("code, sku_id, level, vendor_items!inner(vendor_id, product_id)")
    .eq("code", normalized.code)
    .is("forgotten_at", null)
    .returns<TaughtRow[]>();
  if (error) throw new BarcodeError(500, "lookup_failed", `Barcode read failed: ${error.message}`);

  const { data: skus, error: skuErr } = await sb
    .from("vendor_items")
    .select("id, product_id")
    .eq("vendor_id", input.vendorId)
    .eq("active", true)
    .returns<Array<{ id: string; product_id: string | null }>>();
  if (skuErr) throw new BarcodeError(500, "lookup_failed", `Vendor SKU read failed: ${skuErr.message}`);

  const ctx: ScanContext = {
    vendorId: input.vendorId,
    lineSkuIds: input.lineSkuIds,
    // A vendor-less SKU (vendor_id is nullable — manual catalog entries) can never BE this
    // vendor's, and "" is a UUID no caller can supply, so the empty string is the honest
    // stand-in for "belongs to nobody" rather than a coincidence waiting to happen.
    taught: (rows ?? []).map((r) => ({
      code: r.code,
      skuId: r.sku_id,
      level: r.level,
      vendorId: r.vendor_items.vendor_id ?? "",
      productId: r.vendor_items.product_id,
    })),
    vendorSkus: (skus ?? []).map((s) => ({ skuId: s.id, productId: s.product_id })),
  };
  return { ...resolveScan(normalized.code, ctx), normalized };
}

/**
 * Teach a code on a SKU. Idempotent on `(code, sku_id, level)` — the same key 0206's partial
 * unique index enforces on live rows, so the read below is the readable refusal and the
 * index is the floor.
 */
export async function teachBarcode(
  actor: AuthContext,
  input: {
    vendorId: string;
    locationId: string;
    code: string;
    skuId: string;
    level: Level;
    symbology?: Symbology;
    invoiceNumber?: string | null;
    confirmLevelChange?: boolean;
  },
): Promise<{ created: boolean }> {
  bind(actor, input.locationId);
  const normalized = normalizeOrRefuse(input.code);

  const sb = getServiceRoleClient();
  const { data: sku, error: skuErr } = await sb
    .from("vendor_items")
    .select("id, vendor_id, active")
    .eq("id", input.skuId)
    .maybeSingle<{ id: string; vendor_id: string | null; active: boolean }>();
  if (skuErr) throw new BarcodeError(500, "teach_failed", `SKU read failed: ${skuErr.message}`);
  // A deactivated SKU is refused with the same code as a missing one, on purpose: from the
  // receiver's side both mean "this is not an item you can teach a code onto", and the door
  // already refuses to RECEIVE an inactive SKU (lib/receiving.ts's `invalid_sku` gate).
  if (!sku || !sku.active) throw new BarcodeError(404, "sku_not_found", "Item not found");
  if (sku.vendor_id !== input.vendorId) {
    throw new BarcodeError(400, "vendor_mismatch", "That item belongs to a different vendor");
  }

  const { data: live, error: liveErr } = await sb
    .from("sku_barcodes")
    .select("id, level")
    .eq("code", normalized.code)
    .eq("sku_id", input.skuId)
    .is("forgotten_at", null)
    .returns<Array<{ id: string; level: Level }>>();
  if (liveErr) throw new BarcodeError(500, "teach_failed", `Barcode read failed: ${liveErr.message}`);

  const rows = live ?? [];
  if (rows.some((r) => r.level === input.level)) return { created: false };
  const other = rows.find((r) => r.level !== input.level);
  if (other && !input.confirmLevelChange) {
    throw new BarcodeError(409, "level_differs", "This code is already taught at another level", {
      storedLevel: other.level,
    });
  }

  const symbology = input.symbology ?? normalized.symbology;
  const { data: inserted, error: insErr } = await sb
    .from("sku_barcodes")
    .insert({
      sku_id: input.skuId,
      code: normalized.code,
      symbology,
      level: input.level,
      taught_by: actor.user.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (insErr || !inserted) {
    throw new BarcodeError(500, "teach_failed", `Barcode write failed: ${insErr?.message ?? "insert returned no row"}`);
  }

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "sku.barcode.taught",
    resourceTable: "sku_barcodes",
    resourceId: inserted.id,
    metadata: {
      code: normalized.code,
      sku_id: input.skuId,
      level: input.level,
      symbology,
      vendor_id: input.vendorId,
      location_id: input.locationId,
      invoice_number: input.invoiceNumber ?? null,
      // A reprinted label with a broken check digit is a real object on the floor and IS
      // stored (§3); carrying the flag means a later "why does this code look odd" question
      // is answerable from the audit row alone.
      check_digit_ok: normalized.checkDigitOk,
    },
    ipAddress: null,
    userAgent: null,
  });
  return { created: true };
}

/**
 * Forget a code on a SKU — a soft delete, so history stays and the live unique key frees up.
 *
 * The `code` is NOT re-normalised here, deliberately: the only way a client learns a code to
 * forget is from a lookup or a teach, both of which answer with the stored key. Normalising
 * a second time could only turn a stored key into something that matches no row.
 *
 * `resourceId` is null because one counted UPDATE is the whole write; the metadata carries
 * `(code, sku_id, level)`, which IS 0206's live unique key, so the row is identifiable from
 * the audit entry without a second read (audit.ts's header: orphaned/absent resource ids are
 * expected and the row itself is the source of truth).
 */
export async function forgetBarcode(
  actor: AuthContext,
  input: { vendorId: string; locationId: string; code: string; skuId: string; level: Level },
): Promise<void> {
  bind(actor, input.locationId);
  // Same normalisation as lookup/teach: the client may hold the RAW scan (a GTIN-14 with its
  // leading zero, a GS1 string) while the row stores the GTIN. First sim run proved it (09-17).
  const normalized = normalizeCode(input.code);
  if (!normalized) throw new BarcodeError(400, "invalid_code", "That code is too short to be a barcode");

  const sb = getServiceRoleClient();
  const { error, count } = await sb
    .from("sku_barcodes")
    .update({ forgotten_at: new Date().toISOString() }, { count: "exact" })
    .eq("code", normalized.code)
    .eq("sku_id", input.skuId)
    .eq("level", input.level)
    .is("forgotten_at", null);
  if (error) throw new BarcodeError(500, "forget_failed", `Barcode update failed: ${error.message}`);
  if (!count) throw new BarcodeError(404, "not_taught", "That code is not taught on this item");

  await audit({
    actorId: actor.user.id,
    actorRole: actor.user.role,
    action: "sku.barcode.forgotten",
    resourceTable: "sku_barcodes",
    resourceId: null,
    metadata: {
      code: normalized.code,
      sku_id: input.skuId,
      level: input.level,
      vendor_id: input.vendorId,
      location_id: input.locationId,
    },
    ipAddress: null,
    userAgent: null,
  });
}
