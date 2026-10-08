import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { accessibleLocations } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import { LINK_ADMIN_MIN_LEVEL, LINK_ALL_SHOPS_LEVEL, loadLinkReview, whosHereEnabled } from "@/lib/toast/employee-links";
import { ToastEmployeeLinks } from "@/components/admin/toast-employees/ToastEmployeeLinks";

/** 0233: Toast employee → CO-OPS user links. GM+ for their own shop, level 8+ for every shop. */
export default async function ToastEmployeesPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/toast-employees");
  if (auth.level < LINK_ADMIN_MIN_LEVEL) redirect("/admin");
  const language = auth.user.language;
  const actor = { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations };
  const sb = getServiceRoleClient();
  const scope = auth.level >= LINK_ALL_SHOPS_LEVEL ? "all" : accessibleLocations(actor);
  let query = sb.from("locations").select("id,name").eq("active", true).not("toast_restaurant_guid", "is", null).order("name");
  if (scope !== "all") query = query.in("id", scope);
  const { data, error } = await query;
  if (error) throw error;
  const locations = (data ?? []) as { id: string; name: string }[];
  const { loc } = await searchParams;
  const selected = locations.find((l) => l.id === loc) ?? locations[0];
  const enabled = whosHereEnabled();
  const review = enabled && selected ? await loadLinkReview(sb, { actor, locationId: selected.id }) : null;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "toastLinks.title")}</h1>
    <p className="text-co-text-muted">{serverT(language, "toastLinks.intro")}</p>
    <nav aria-label={serverT(language, "assignments.locations")} className="flex flex-wrap gap-2">{locations.map((location) =>
      <Link key={location.id} href={`/admin/toast-employees?loc=${location.id}`} aria-current={location.id === selected?.id ? "page" : undefined}
        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{location.name}</Link>)}</nav>
    {!enabled ? <p className="co-card p-4 text-co-text-muted">{serverT(language, "toastLinks.disabled")}</p>
      : !selected ? <p>{serverT(language, "assignments.noLocation")}</p>
      : review && <ToastEmployeeLinks key={review.locationId} review={review} />}
  </div>;
}
