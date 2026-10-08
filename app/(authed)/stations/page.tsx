import Link from "next/link";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { accessibleLocations } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";

/** Staff view of the GM-managed station positions. */
export default async function StaffStationsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/stations");
  const service = getServiceRoleClient();
  const scope = accessibleLocations({ role: auth.role, locations: auth.locations });
  let locationsQuery = service.from("locations").select("id,name").eq("active", true).order("name");
  if (scope !== "all") locationsQuery = locationsQuery.in("id", scope);
  const locationsResult = await locationsQuery;
  if (locationsResult.error) throw locationsResult.error;
  const locations = locationsResult.data ?? [];
  const { loc } = await searchParams;
  const location = locations.find((row) => row.id === loc) ?? locations[0];
  const stationsResult = location ? await service.from("stations").select("id,name,name_es,staffed")
    .eq("location_id", location.id).eq("active", true).order("sort").order("name") : null;
  if (stationsResult?.error) throw stationsResult.error;
  const positionsResult = location ? await service.from("station_positions").select("id,station_id,name,name_es,duty,duty_es,sort")
    .eq("location_id", location.id).eq("active", true).order("sort").order("name") : null;
  if (positionsResult?.error) throw positionsResult.error;
  const es = auth.user.language === "es";
  return <main className="space-y-4">
    <h1 className="text-2xl font-bold">{serverT(auth.user.language, "assignments.stations")}</h1>
    <nav aria-label={serverT(auth.user.language, "assignments.locations")} className="flex flex-wrap gap-2">
      {locations.map((row) => <Link key={row.id} href={`/stations?loc=${row.id}`}
        aria-current={row.id === location?.id ? "page" : undefined}
        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 aria-[current=page]:border-co-text">{row.name}</Link>)}
    </nav>
    {!location && <p>{serverT(auth.user.language, "assignments.noLocation")}</p>}
    {(stationsResult?.data ?? []).map((station) => <section key={station.id} className="co-card space-y-2 p-4">
      <h2 className="font-bold">{es ? station.name_es || station.name : station.name}</h2>
      <p className="text-sm text-co-text-muted">{serverT(auth.user.language, station.staffed ? "assignments.staffed" : "assignments.unstaffed")}</p>
      {(positionsResult?.data ?? []).filter((p) => p.station_id === station.id).map((position) => <div key={position.id} className="border-t border-co-border pt-2">
        <p className="font-bold">{es ? position.name_es || position.name : position.name}</p>
        <p className="text-sm text-co-text-muted">{es ? position.duty_es || position.duty : position.duty}</p>
      </div>)}
    </section>)}
  </main>;
}
