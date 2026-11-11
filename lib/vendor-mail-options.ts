import "server-only";
import type { AuthContext } from "./session";
import { getServiceRoleClient } from "./supabase-server";
import { selectAllRows } from "./supabase-paginate";
import { vendorMailRoleAllowed } from "./vendor-mail-shared";
import { VendorMailError } from "./vendor-mail";

/** Choices are UUID-keyed and freshly membership-bound, including staff contacts. */
export async function vendorMailOptions(ctx: AuthContext) {
  if (!ctx.user.active || !vendorMailRoleAllowed(ctx.user.role)) throw new VendorMailError(403, "forbidden");
  const db = getServiceRoleClient();
  const { data: actor, error } = await db.from("users").select("role,active").eq("id", ctx.user.id).maybeSingle();
  if (error) throw new VendorMailError(503, "vendor_mail_unavailable");
  if (!actor?.active || !vendorMailRoleAllowed(actor.role)) throw new VendorMailError(403, "forbidden");
  const memberships = await selectAllRows<{ location_id: string }>((from, to) => db.from("user_locations").select("location_id").eq("user_id", ctx.user.id).eq("active", true).order("location_id").range(from, to));
  const shops = await selectAllRows<{ id: string; name: string }>((from, to) => {
    let q = db.from("locations").select("id,name").order("name").order("id").range(from, to);
    if (actor.role === "gm") q = q.in("id", memberships.map(row => row.location_id));
    return q;
  });
  const vendors = await selectAllRows<{ id: string; name: string }>((from, to) => db.from("vendors").select("id,name").order("name").order("id").range(from, to));
  // Staff recipients are restricted to authorized shop memberships; contacts support explicit send confirmation.
  const staffMemberships = await selectAllRows<{ user_id: string; location_id: string }>((from, to) => db.from("user_locations").select("user_id,location_id").in("location_id", shops.map(shop => shop.id)).eq("active", true).order("user_id").order("location_id").range(from, to));
  const people = await selectAllRows<{ id: string; name: string; active: boolean; email: string | null }>((from, to) => db.from("users").select("id,name,active,email").order("name").order("id").range(from, to));
  const staff = people.filter(person => staffMemberships.some(member => member.user_id === person.id)).map(person => ({ ...person, locations: staffMemberships.filter(member => member.user_id === person.id).map(member => member.location_id) }));
  return { shops, vendors, staff };
}
