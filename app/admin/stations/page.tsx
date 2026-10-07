import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { accessibleLocations } from "@/lib/locations";
import { loadShiftBoard } from "@/lib/assignments";
import { syncStationsFromClosing } from "@/lib/closing-stations";
import { closingStations } from "@/lib/closing-stations-shared";
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
  if (selected) await syncStationsFromClosing(selected.id, actor);
  const board = selected ? await loadShiftBoard(sb, { actor, locationId: selected.id, date: etCalendarDate(new Date().toISOString()) }) : null;
  const closingTemplates = selected ? await sb.from("checklist_templates").select("id,effective_from,created_at")
    .eq("location_id", selected.id).eq("type", "closing").eq("active", true) : null;
  if (closingTemplates?.error) throw closingTemplates.error;
  const latest = (closingTemplates?.data ?? []).sort((a, b) =>
    (b.effective_from ?? "").localeCompare(a.effective_from ?? "") || b.created_at.localeCompare(a.created_at))[0];
  const closingItems = latest ? await sb.from("checklist_template_items").select("station,display_order,translations")
    .eq("template_id", latest.id).eq("active", true) : null;
  if (closingItems?.error) throw closingItems.error;
  const translatedNames = closingStations(closingItems?.data ?? []).filter((station) => station.nameEs).map((station) => station.name);
  const language = auth.user.language;
  return <div className="space-y-4">
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "assignments.stations")}</h1>
    <p>{serverT(language, "assignments.stationsFromClosing")} <Link className="underline" href="/admin/checklist-templates/closing">{serverT(language, "assignments.editClosing")}</Link></p>
    <nav aria-label={serverT(language, "assignments.locations")} className="flex flex-wrap gap-2">{locations.map((location) => <Link key={location.id} href={`/admin/stations?loc=${location.id}`} aria-current={location.id === selected?.id ? "page" : undefined} className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 font-bold text-co-text aria-[current=page]:border-co-text">{location.name}</Link>)}</nav>
    {board ? <StationsAdmin key={board.locationId} locationId={board.locationId} stations={board.stations} translatedNames={translatedNames} /> : <p>{serverT(language, "assignments.noLocation")}</p>}
  </div>;
}
