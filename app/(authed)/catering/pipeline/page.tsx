/**
 * /catering/pipeline — the catering pipeline board (Wave 1 slice 1C).
 *
 * Server component: the (authed) layout is the auth boundary; this page gates the
 * catering read floor (>= 5) and loads the board + follow-up queue + the actor's
 * locations server-side via the lib loaders, then hands to the client board.
 */

import { redirect } from "next/navigation";

import { requireSessionFromHeaders } from "@/lib/session";
import { getRoleLevel } from "@/lib/roles";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { isAllLocationsAccess } from "@/lib/locations";
import {
  loadPipelineBoard,
  loadFollowUps,
  PIPELINE_READ_MIN,
  PIPELINE_WRITE_MIN,
} from "@/lib/catering/pipeline";
import { PipelineClient } from "@/components/catering/pipeline/PipelineClient";

export default async function CateringPipelinePage() {
  const auth = await requireSessionFromHeaders("/catering/pipeline");
  const level = getRoleLevel(auth.user.role);
  if (level < PIPELINE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  // Follow-up window: due on/before today (operational TZ — both CO locations are in DC).
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [leads, followUps] = await Promise.all([
    loadPipelineBoard(auth),
    loadFollowUps(auth, today),
  ]);

  // Locations for the add-form select (the actor's accessible locations, by name).
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
        {serverT(lang, "catering.pipeline.title")}
      </h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.pipeline.subtitle")}</p>
      <PipelineClient
        leads={leads}
        followUps={followUps}
        locations={locations}
        actorLevel={level}
        writeMin={PIPELINE_WRITE_MIN}
      />
    </div>
  );
}
