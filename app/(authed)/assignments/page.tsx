import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ShiftBoardClient } from "@/components/assignments/ShiftBoardClient";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { accessibleLocations } from "@/lib/locations";
import { loadShiftBoard } from "@/lib/assignments";
import { etCalendarDate } from "@/lib/operational-day";
import { serverT } from "@/lib/i18n/server";
import { formatDateLabel } from "@/lib/i18n/format";

export default async function AssignmentsPage({ searchParams }: { searchParams: Promise<{ loc?: string; location?: string }> }) {
  const auth = await requireSessionFromHeaders("/assignments");
  if (auth.level < 4) redirect("/dashboard");
  const sb = getServiceRoleClient();
  const actor = { userId: auth.user.id, role: auth.role, level: auth.level, locations: auth.locations };
  const scope = accessibleLocations(actor);
  let query = sb.from("locations").select("id,name").eq("active", true).order("name");
  if (scope !== "all") query = query.in("id", scope);
  const { data, error } = await query;
  if (error) throw error;
  const locations = (data ?? []) as { id: string; name: string }[];
  const { loc, location } = await searchParams;
  const selected = locations.find((l) => l.id === (location ?? loc)) ?? locations[0];
  const date = etCalendarDate(new Date().toISOString());
  const board = selected ? await loadShiftBoard(sb, { actor, locationId: selected.id, date }) : null;
  const language = auth.user.language;
  return <AuthShell width="wide"><div className="space-y-4">
    <Link className="inline-flex min-h-[44px] items-center text-co-text" href={`/dashboard${selected ? `?loc=${selected.id}` : ""}`}>{serverT(language, "assignments.dashboard")}</Link>
    <h1 className="text-2xl font-bold text-co-text">{serverT(language, "assignments.title")}</h1>
    <p className="text-co-text-muted">{formatDateLabel(date, language)}</p>
    <nav className="flex flex-wrap gap-2" aria-label={serverT(language, "assignments.locations")}>{locations.map((location) => <Link key={location.id} href={`/assignments?location=${location.id}`} aria-current={location.id === selected?.id ? "page" : undefined} className="inline-flex min-h-[44px] items-center rounded-xl border-2 border-co-border bg-co-surface px-3 font-bold text-co-text aria-[current=page]:border-co-text">{location.name}</Link>)}</nav>
    {board ? <ShiftBoardClient board={board} /> : <p>{serverT(language, "assignments.noLocation")}</p>}
  </div></AuthShell>;
}
