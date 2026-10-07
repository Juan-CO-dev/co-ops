import "server-only";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { selectAllRows } from "@/lib/supabase-paginate";
import { getRoleLevel } from "@/lib/roles";
import { lockLocationContext } from "@/lib/locations";
import type { AuthContext } from "@/lib/session";
import { audit } from "@/lib/audit";
import { ReceivingError, RECEIVE_MIN } from "@/lib/receiving";
import { pendingItemInput, storeName } from "@/lib/receiving-stores-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireLocation(actor: AuthContext, locationId: string, minimum: number): void {
  if (getRoleLevel(actor.user.role) < minimum) throw new ReceivingError(403, "forbidden");
  if (typeof locationId !== "string" || !UUID.test(locationId)) throw new ReceivingError(400, "invalid_location");
  if (!lockLocationContext({ role: actor.user.role, locations: actor.locations }, locationId)) {
    throw new ReceivingError(404, "not_found");
  }
}
function rpcError(error: { code?: string; message: string } | null): void {
  if (!error) return;
  if (error.code === "P0002") throw new ReceivingError(404, "not_found");
  if (error.code === "22023") throw new ReceivingError(400, "invalid_payload");
  if (error.code === "23505" || error.code === "P0001") throw new ReceivingError(409, "store_item_conflict");
  throw new Error(`Receiving store writer: ${error.message}`);
}

export async function createStore(actor: AuthContext, input: { locationId: string; name: unknown }): Promise<{
  store: { id: string; name: string; sourceKind: "store" };
}> {
  requireLocation(actor, input.locationId, RECEIVE_MIN);
  const name = storeName(input.name);
  if (!name) throw new ReceivingError(400, "invalid_name");
  const { data, error } = await getServiceRoleClient().rpc("receiving_create_store", {
    p_name: name, p_actor: actor.user.id, p_location: input.locationId,
  });
  rpcError(error);
  const result = data as { id: string; name: string; created: boolean };
  if (result.created) await audit({ actorId: actor.user.id, actorRole: actor.user.role,
    action: "receiving.store_create", resourceTable: "vendors", resourceId: result.id,
    metadata: { location_id: input.locationId, name }, ipAddress: null, userAgent: null });
  return { store: { id: result.id, name: result.name, sourceKind: "store" } };
}

export interface StoreItemInput {
  locationId: string; storeId: string; referenceSkuId?: string;
  requestId?: string;
  name?: unknown; countUnit?: unknown; contentOz?: unknown;
}
export async function createStoreItem(actor: AuthContext, input: StoreItemInput): Promise<{ skuId: string }> {
  requireLocation(actor, input.locationId, RECEIVE_MIN);
  if (typeof input.storeId !== "string" || !UUID.test(input.storeId)) throw new ReceivingError(400, "invalid_store");
  if (input.referenceSkuId !== undefined && (typeof input.referenceSkuId !== "string" || !UUID.test(input.referenceSkuId))) {
    throw new ReceivingError(400, "invalid_sku");
  }
  const pending = input.referenceSkuId ? null : pendingItemInput(input.name, input.countUnit, input.contentOz);
  if (!input.referenceSkuId && !pending) throw new ReceivingError(400, "invalid_payload");
  if (pending && (typeof input.requestId !== "string" || !UUID.test(input.requestId))) {
    throw new ReceivingError(400, "invalid_request_id");
  }
  const { data, error } = await getServiceRoleClient().rpc("receiving_create_store_item", {
    p_store: input.storeId, p_location: input.locationId, p_actor: actor.user.id,
    p_reference: input.referenceSkuId ?? null, p_name: pending?.name ?? null,
    p_unit: pending?.countUnit ?? null, p_content_oz: pending?.contentOz ?? null,
    p_request: pending ? input.requestId : null,
  });
  rpcError(error);
  const result = data as { id: string; created: boolean; product_id: string | null };
  if (result.created) await audit({ actorId: actor.user.id, actorRole: actor.user.role,
    action: pending ? "receiving.pending_create" : "receiving.store_sku_create",
    resourceTable: "vendor_items", resourceId: result.id,
    metadata: { location_id: input.locationId, store_id: input.storeId,
      reference_sku_id: input.referenceSkuId ?? null, product_id: result.product_id, ...pending },
    ipAddress: null, userAgent: null });
  return { skuId: result.id };
}

export async function resolvePendingStoreItem(actor: AuthContext, input: {
  locationId: string; skuId: string; referenceSkuId: string;
}): Promise<{ skuId: string }> {
  requireLocation(actor, input.locationId, 7);
  if (!UUID.test(input.skuId) || !UUID.test(input.referenceSkuId)) throw new ReceivingError(400, "invalid_sku");
  const { data, error } = await getServiceRoleClient().rpc("receiving_resolve_pending_item", {
    p_sku: input.skuId, p_reference: input.referenceSkuId, p_location: input.locationId, p_actor: actor.user.id,
  });
  rpcError(error);
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "receiving.pending_resolve",
    resourceTable: "vendor_items", resourceId: input.skuId,
    metadata: { location_id: input.locationId, reference_sku_id: input.referenceSkuId, product_id: data },
    ipAddress: null, userAgent: null });
  return { skuId: input.skuId };
}

export async function loadPendingStoreItems(actor: AuthContext, locationId: string): Promise<
  Array<{ id: string; name: string; unit: string | null; vendorName: string }>
> {
  requireLocation(actor, locationId, 7);
  const sb = getServiceRoleClient();
  const rows = await selectAllRows<{ id: string; name: string; unit: string | null; vendors: { name: string } }>(
    (from, to) => sb.from("vendor_items").select("id,name,unit,vendors!inner(name)")
      .eq("pending_review", true).eq("active", true).eq("location_id", locationId)
      .order("id").range(from, to)
      .returns<Array<{ id: string; name: string; unit: string | null; vendors: { name: string } }>>(),
  );
  return rows.map((r) => ({ id: r.id, name: r.name, unit: r.unit, vendorName: r.vendors.name }));
}
