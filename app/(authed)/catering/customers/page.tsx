/**
 * /catering/customers — the catering customer directory (Wave 1 slice 1D).
 *
 * Server component: the (authed) layout is the auth boundary; this page gates the
 * catering read floor (>= 5) and loads the customer directory + the actor's
 * locations server-side, then hands to the client (grouped by company).
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { isAllLocationsAccess } from "@/lib/locations";
import { loadCustomers, CUSTOMER_READ_MIN } from "@/lib/catering/customers";
import { CustomersClient } from "@/components/catering/customers/CustomersClient";

export default async function CateringCustomersPage() {
  const auth = await requireSessionFromHeaders("/catering/customers");
  const level = getRoleLevel(auth.user.role);
  if (level < CUSTOMER_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const customers = await loadCustomers(auth);

  const sb = getServiceRoleClient();
  const locActor = { role: auth.user.role, locations: auth.locations };
  let locations: Array<{ id: string; name: string }> = [];
  if (isAllLocationsAccess(locActor)) {
    const { data } = await sb
      .from("locations")
      .select("id, name")
      .eq("active", true)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string }>>();
    locations = data ?? [];
  } else if (auth.locations.length > 0) {
    const { data } = await sb
      .from("locations")
      .select("id, name")
      .eq("active", true)
      .in("id", auth.locations)
      .order("name", { ascending: true })
      .returns<Array<{ id: string; name: string }>>();
    locations = data ?? [];
  }

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">
        {serverT(lang, "catering.customers.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.customers.subtitle")}</p>
      <CustomersClient customers={customers} locations={locations} actorLevel={level} />
    </div>
  );
}
