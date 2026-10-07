import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { accessibleLocations } from "@/lib/locations";
import { loadShiftBoard } from "@/lib/assignments";
import { etCalendarDate } from "@/lib/operational-day";
import { serverT } from "@/lib/i18n/server";
import { StationsAdmin } from "@/components/assignments/StationsAdmin";

export default async function StationsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin/stations");
  if (auth.level < 7) redirect("/admin");
  const sb = getServiceRoleClient();
  const actor = { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations };
  const scope = accessibleLocations(actor);
  let query = sb.from("locations").select("id,name").eq("active", true).order("name");
  if (scope !== "all") query = query.in("id", scope);
  const { data, error } = await query;
  if (error) throw error;
  const locations = (data ?? []) as { id: string; name: string }[];
  const { loc } = await searchParams;
  const selected = locations.find((l) => l.id === loc) ?? locations[0];
  const board = selected ? await loadShiftBoard(sb, { actor, locationId: selected.id, date: etCalendarDate(new Date().toISOString()) }) : null;
  const language = auth.user.language;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "assignments.stations")}</h1>
    <nav aria-label={serverT(language, "assignments.locations")} className="flex flex-wrap gap-2">{locations.map((location) => <Link key={location.id} href={`/admin/stations?loc=${location.id}`} aria-current={location.id === selected?.id ? "page" : undefined} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{location.name}</Link>)}</nav>
    {board ? <StationsAdmin key={board.locationId} locationId={board.locationId} stations={board.stations} /> : <p>{serverT(language, "assignments.noLocation")}</p>}
  </div>;
}
