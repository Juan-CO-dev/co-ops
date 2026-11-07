import "server-only";
import type { AuthContext } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { audit } from "@/lib/audit";
import { selectAllRows } from "@/lib/supabase-paginate";
import { isShopId } from "@/lib/shop-context-shared";
import { canManageInboundAliases, canManageVendorAccount, inboundAliasAddress, type InboundShop, type InboundAlias, type VendorShopAccount } from "./inbound-settings-shared";

export class InboundSettingsError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
function check(error: { code?: string } | null) {
  if (error) throw new InboundSettingsError(error.code === "23505" ? 409 : 503, error.code === "23505" ? "conflict" : "unavailable");
}
function accountRole(actor: AuthContext) {
  if (actor.user.role !== "gm" && !canManageInboundAliases(actor.user.role)) throw new InboundSettingsError(403, "forbidden");
}
async function activeShop(id: string) {
  const { data, error } = await getServiceRoleClient().from("locations").select("id").eq("id", id).eq("active", true).maybeSingle();
  check(error);
  if (!data) throw new InboundSettingsError(404, "not_found");
}
export async function loadInboundShops(actor: AuthContext): Promise<InboundShop[]> {
  accountRole(actor);
  return selectAllRows<InboundShop>(async (from, to) => {
    let query = getServiceRoleClient().from("locations").select("id, name, receipt_email_address").eq("active", true);
    if (!canManageInboundAliases(actor.user.role)) query = query.in("id", actor.locations);
    const { data, error } = await query.order("id").range(from, to);
    check(error); return { data: data as InboundShop[] | null };
  });
}
export async function loadVendorShopAccounts(actor: AuthContext, vendorId: string): Promise<VendorShopAccount[]> {
  accountRole(actor);
  return selectAllRows<VendorShopAccount>(async (from, to) => {
    let query = getServiceRoleClient().from("vendor_location_accounts").select("location_id, account_number").eq("vendor_id", vendorId);
    if (!canManageInboundAliases(actor.user.role)) query = query.in("location_id", actor.locations);
    const { data, error } = await query.order("location_id").range(from, to);
    check(error); return { data: data as VendorShopAccount[] | null };
  });
}
export async function saveVendorShopAccount(actor: AuthContext, vendorId: string, locationId: string, value: unknown) {
  if (!canManageVendorAccount({ role: actor.user.role, locations: actor.locations }, locationId)) throw new InboundSettingsError(403, "forbidden");
  if (!isShopId(locationId) || !isShopId(vendorId) || typeof value !== "string" || !value.trim() || value.trim().length > 200 || /[\x00-\x1f\x7f]/.test(value)) throw new InboundSettingsError(400, "invalid_payload");
  await activeShop(locationId);
  const sb = getServiceRoleClient();
  const vendor = await sb.from("vendors").select("id").eq("id", vendorId).eq("active", true).maybeSingle();
  check(vendor.error);
  if (!vendor.data) throw new InboundSettingsError(404, "not_found");
  // Separate insert/update preserves creation provenance; a concurrent first insert returns a visible conflict.
  const prior = await sb.from("vendor_location_accounts").select("vendor_id").eq("vendor_id", vendorId).eq("location_id", locationId).maybeSingle();
  check(prior.error);
  const fields = { account_number: value.trim(), updated_by: actor.user.id, updated_at: new Date().toISOString() };
  const result = prior.data
    ? await sb.from("vendor_location_accounts").update(fields, { count: "exact" }).eq("vendor_id", vendorId).eq("location_id", locationId)
    : await sb.from("vendor_location_accounts").insert({ ...fields, vendor_id: vendorId, location_id: locationId, created_by: actor.user.id }).select("vendor_id").maybeSingle();
  check(result.error);
  if (prior.data ? result.count !== 1 : !result.data) throw new InboundSettingsError(404, "not_found");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "vendor_location_account.save", resourceTable: "vendor_location_accounts", resourceId: vendorId, metadata: { location_id: locationId }, ipAddress: null, userAgent: null });
}
export async function loadInboundAliases(actor: AuthContext): Promise<InboundAlias[]> {
  if (!canManageInboundAliases(actor.user.role)) throw new InboundSettingsError(403, "forbidden");
  return selectAllRows<InboundAlias>(async (from, to) => {
    const { data, error } = await getServiceRoleClient().from("inbound_address_aliases").select("id, address, lane, location_id").eq("active", true).order("id").range(from, to);
    check(error); return { data: data as InboundAlias[] | null };
  });
}
export async function saveInboundAlias(actor: AuthContext, input: Record<string, unknown>) {
  if (!canManageInboundAliases(actor.user.role)) throw new InboundSettingsError(403, "forbidden");
  const sb = getServiceRoleClient();
  if (input.remove === true) {
    if (typeof input.id !== "string" || !isShopId(input.id)) throw new InboundSettingsError(400, "invalid_payload");
    const { count, error } = await sb.from("inbound_address_aliases").update({ active: false, updated_by: actor.user.id, updated_at: new Date().toISOString() }, { count: "exact" }).eq("id", input.id).eq("active", true);
    check(error);
    if (count !== 1) throw new InboundSettingsError(404, "not_found");
    await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "inbound_alias.deactivate", resourceTable: "inbound_address_aliases", resourceId: input.id, metadata: {}, ipAddress: null, userAgent: null });
    return;
  }
  const address = inboundAliasAddress(input.address);
  if (!address || (input.lane !== "vendor_receipt" && input.lane !== "catering")) throw new InboundSettingsError(400, "invalid_payload");
  const locationId = input.locationId;
  if (input.lane === "vendor_receipt") {
    if (typeof locationId !== "string" || !isShopId(locationId)) throw new InboundSettingsError(400, "invalid_payload");
    await activeShop(locationId);
  } else if (locationId !== null) throw new InboundSettingsError(400, "invalid_payload");
  const prior = await sb.from("inbound_address_aliases").select("id, active").eq("address", address).maybeSingle();
  check(prior.error);
  if (prior.data?.active) throw new InboundSettingsError(409, "conflict");
  const fields = { address, lane: input.lane, location_id: locationId, active: true, updated_by: actor.user.id, updated_at: new Date().toISOString() };
  const result = prior.data
    ? await sb.from("inbound_address_aliases").update(fields, { count: "exact" }).eq("id", prior.data.id).eq("active", false)
    : await sb.from("inbound_address_aliases").insert({ ...fields, created_by: actor.user.id }).select("id").maybeSingle();
  check(result.error);
  if (prior.data ? result.count !== 1 : !result.data) throw new InboundSettingsError(409, "conflict");
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "inbound_alias.save", resourceTable: "inbound_address_aliases", resourceId: prior.data?.id ?? result.data!.id, metadata: { lane: input.lane, location_id: locationId }, ipAddress: null, userAgent: null });
}
