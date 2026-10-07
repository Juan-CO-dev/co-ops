import type { ReactNode } from "react";
import { getServiceRoleClient } from "@/lib/supabase-server";

/** Call only after the page has checked the level-8 all-shop grant. */
export async function TrendShopPanels({ render }: { render: (locationId: string) => Promise<ReactNode> }) {
  const { data, error } = await getServiceRoleClient().from("locations").select("id, name").eq("active", true).order("name");
  if (error) throw new Error(error.message);
  return <div className="space-y-6">{await Promise.all((data ?? []).map(async (location) => <section key={location.id}>
    <h2 className="mx-auto max-w-6xl px-6 pt-4 text-lg font-bold text-co-text">{location.name}</h2>
    {await render(location.id)}
  </section>))}</div>;
}
