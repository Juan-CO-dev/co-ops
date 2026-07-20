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
  searchPipeline,
  PIPELINE_READ_MIN,
  PIPELINE_WRITE_MIN,
  type PipelineSearchResult,
} from "@/lib/catering/pipeline";
import { PipelineClient } from "@/components/catering/pipeline/PipelineClient";
import { CateringBackLink } from "@/components/catering/CateringBackLink";

export default async function CateringPipelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireSessionFromHeaders("/catering/pipeline");
  const level = getRoleLevel(auth.user.role);
  if (level < PIPELINE_READ_MIN) redirect("/dashboard");
  const lang = auth.user.language;

  const sp = await searchParams;
  const q = typeof sp["q"] === "string" ? sp["q"] : "";

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

  let leads: Parameters<typeof PipelineClient>[0]["leads"] = [];
  let followUps: Parameters<typeof PipelineClient>[0]["followUps"] = [];
  let results: PipelineSearchResult[] | null = null;

  if (q.trim()) {
    // SEARCH MODE: skip the board/follow-up loads entirely.
    results = await searchPipeline(auth, { query: q });
  } else {
    // BOARD MODE: existing parallel load.
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    [leads, followUps] = await Promise.all([
      loadPipelineBoard(auth),
      loadFollowUps(auth, today),
    ]);
  }

  return (
    <main className="mx-auto max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <CateringBackLink />
      </div>
      <h1 className="text-lg font-bold text-co-text">{serverT(lang, "catering.pipeline.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "catering.pipeline.subtitle")}</p>
      <PipelineClient
        leads={leads}
        followUps={followUps}
        locations={locations}
        actorLevel={level}
        writeMin={PIPELINE_WRITE_MIN}
        searchQuery={q}
        results={results}
      />
    </main>
  );
}
