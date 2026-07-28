import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { loadSkus, createSku, deactivateSku, AdminSkuError, isSkuClass, type CreateSkuInput } from "@/lib/admin/skus";
import { replaceSkuPackChain, PackChainError, type PackChainLevelInput } from "@/lib/admin/pack-chain";
import type { SkuClass } from "@/lib/admin/catalog-shared";

// GET — list SKUs (≥6). Optional ?vendorId=<uuid> filters to a vendor;
//   ?vendorId=none → manual / vendor-less SKUs only; absent → all.
// POST — create a SKU (GM+ ≥7, Tier B). vendor_id + location_id optional (null
//   = manual / global). The lib enforces ≥7.
export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/skus");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 6) return jsonError(403, "forbidden");

  const vendorParam = req.nextUrl.searchParams.get("vendorId");
  let opts: { vendorId?: string | null } | undefined;
  if (vendorParam !== null) {
    opts = { vendorId: vendorParam === "none" ? null : vendorParam };
  }

  try {
    const skus = await loadSkus(ctx, opts);
    return jsonOk({ skus });
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/skus");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 7) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Record<string, unknown>;
  if (typeof b.name !== "string" || typeof b.packFormat !== "string") {
    return jsonError(400, "invalid_payload", { message: "name and packFormat are required" });
  }
  // vendorId / locationId: string id, or null (manual / global). Anything else invalid.
  if (b.vendorId !== undefined && b.vendorId !== null && typeof b.vendorId !== "string") {
    return jsonError(400, "invalid_payload", { field: "vendorId" });
  }
  if (b.locationId !== undefined && b.locationId !== null && typeof b.locationId !== "string") {
    return jsonError(400, "invalid_payload", { field: "locationId" });
  }
  for (const k of ["unitsPerPack", "eachSize", "avgOzPerEach", "leadTimeDays"] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "number") {
      return jsonError(400, "invalid_payload", { field: k });
    }
  }
  if (b.skuClass !== undefined && b.skuClass !== null && !isSkuClass(b.skuClass)) {
    return jsonError(400, "invalid_payload", { field: "skuClass" });
  }

  // Optional atomic chain draft (SKU Builder streamline): the SkuBuilder can
  // persist a starter/edited pack chain alongside the new SKU in ONE request
  // under the single Tier-B step-up above. Shape mirrors the pack-chain route's
  // PackChainLevelInput (index-linked). Absent/empty → a bare unchained SKU
  // ("add pack detail later"). Parse strictly before we mint the SKU.
  let chainLevels: PackChainLevelInput[] | null = null;
  if (b.chain !== undefined && b.chain !== null) {
    if (!Array.isArray(b.chain)) return jsonError(400, "invalid_payload", { field: "chain" });
    if (b.chain.length > 0) {
      const levels: PackChainLevelInput[] = [];
      for (const raw of b.chain) {
        if (typeof raw !== "object" || raw === null) return jsonError(400, "invalid_payload", { field: "chain" });
        const l = raw as Record<string, unknown>;
        if (typeof l.label !== "string") return jsonError(400, "invalid_payload", { field: "label" });
        if (typeof l.containsQty !== "number") return jsonError(400, "invalid_payload", { field: "containsQty" });
        const containsIndex = l.containsIndex === null || l.containsIndex === undefined ? null : l.containsIndex;
        if (containsIndex !== null && typeof containsIndex !== "number") {
          return jsonError(400, "invalid_payload", { field: "containsIndex" });
        }
        const containsMeasureUnit =
          l.containsMeasureUnit === null || l.containsMeasureUnit === undefined ? null : l.containsMeasureUnit;
        if (containsMeasureUnit !== null && typeof containsMeasureUnit !== "string") {
          return jsonError(400, "invalid_payload", { field: "containsMeasureUnit" });
        }
        levels.push({
          label: l.label,
          containsQty: l.containsQty,
          containsIndex: containsIndex as number | null,
          containsMeasureUnit: containsMeasureUnit as string | null,
        });
      }
      chainLevels = levels;
    }
  }

  const input: CreateSkuInput = {
    vendorId: typeof b.vendorId === "string" ? b.vendorId : null,
    locationId: typeof b.locationId === "string" ? b.locationId : null,
    name: b.name,
    packFormat: b.packFormat,
    unitsPerPack: typeof b.unitsPerPack === "number" ? b.unitsPerPack : null,
    eachSize: typeof b.eachSize === "number" ? b.eachSize : null,
    eachMeasure: typeof b.eachMeasure === "string" ? b.eachMeasure : null,
    eachContainerLabel: typeof b.eachContainerLabel === "string" ? b.eachContainerLabel : null,
    avgOzPerEach: typeof b.avgOzPerEach === "number" ? b.avgOzPerEach : null,
    itemNumber: typeof b.itemNumber === "string" ? b.itemNumber : null,
    sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : null,
    leadTimeDays: typeof b.leadTimeDays === "number" ? b.leadTimeDays : null,
    notes: typeof b.notes === "string" ? b.notes : null,
    skuClass: isSkuClass(b.skuClass) ? (b.skuClass as SkuClass) : null,
  };

  let id: string;
  try {
    ({ id } = await createSku(ctx, input));
  } catch (e) {
    if (e instanceof AdminSkuError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }

  // Atomic add: persist the chain through replaceSkuPackChain's validated path
  // (same L1/L7 rules as the standalone chain editor). Postgres has no
  // cross-statement transaction available through the JS client here, so on
  // chain failure we CLEAN UP by deactivating the just-minted SKU (append-only:
  // no DELETE) and return the chain error — the manager sees ONE failure, not a
  // stranded chain-less SKU. avg_oz_per_each was written by createSku above, so
  // a count/volume leaf resolves against it during chain validation.
  if (chainLevels) {
    try {
      await replaceSkuPackChain(ctx, { skuId: id, levels: chainLevels });
    } catch (e) {
      try {
        await deactivateSku(ctx, { id, active: false });
      } catch (cleanupErr) {
        // Cleanup is best-effort; the original chain error is the one to surface.
        console.error("atomic-add cleanup (deactivate) failed", cleanupErr);
      }
      if (e instanceof PackChainError) return jsonError(e.status, e.code, { message: e.message });
      throw e;
    }
  }

  return jsonOk({ id }, 201);
}
