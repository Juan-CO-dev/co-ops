import Link from "next/link";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { accessibleLocations } from "@/lib/locations";
import { StationsAdmin } from "@/components/assignments/StationsAdmin";
import { StepUpProvider } from "@/components/admin/StepUpProvider";
import { loadShiftBoard } from "@/lib/assignments";
import { etCalendarDate } from "@/lib/operational-day";
import { serverT } from "@/lib/i18n/server";

/** Staff station view; GM+ schedule editing uses the normal settings step-up. */
export default async function StaffStationsPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const auth = await requireSessionFromHeaders("/stations");
  const service = getServiceRoleClient();
  const scope = auth.level >= 8 ? "all" : accessibleLocations({ role: auth.role, locations: auth.locations });
  let locationsQuery = service.from("locations").select("id,name").eq("active", true).order("name");
  if (scope !== "all") locationsQuery = locationsQuery.in("id", scope);
  const locationsResult = await locationsQuery;
  if (locationsResult.error) throw locationsResult.error;
  const locations = locationsResult.data ?? [];
  const { loc } = await searchParams;
  const location = locations.find((row) => row.id === loc) ?? locations[0];
  const board = location ? await loadShiftBoard(service, {
    actor: { userId: auth.user.id, role: auth.role, level: auth.level,
      locations: auth.level >= 8 ? [...auth.locations, location.id] : auth.locations },
    locationId: location.id, date: etCalendarDate(new Date().toISOString()),
  }) : null;
  return <main className="space-y-4">
    <h1 className="text-2xl font-bold">{serverT(auth.user.language, "assignments.stations")}</h1>
    <nav aria-label={serverT(auth.user.language, "assignments.locations")} className="flex flex-wrap gap-2">
      {locations.map((row) => <Link key={row.id} href={`/stations?loc=${row.id}`}
        aria-current={row.id === location?.id ? "page" : undefined}
        className="inline-flex min-h-[44px] items-center rounded-lg border-2 border-co-border px-3 aria-[current=page]:border-co-text">{row.name}</Link>)}
    </nav>
    {!location && <p>{serverT(auth.user.language, "assignments.noLocation")}</p>}
    {board && <StepUpProvider unlocked={false} unlockedAt={null}>
      <StationsAdmin key={board.locationId} locationId={board.locationId} stations={board.stations}
        translatedNames={[]} canEdit={false} canEditTiming={auth.level >= 7} />
    </StepUpProvider>}
  </main>;
}
