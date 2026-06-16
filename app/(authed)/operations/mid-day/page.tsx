/**
 * /operations/mid-day — Mid-day Prep instance surface (C.43).
 *
 * Keyed by ?instance=<id> (NOT location+date) because mid-day prep is
 * multi-instance per day — the dashboard tile creates a numbered instance via
 * POST /api/prep/mid-day and links here with its id.
 *
 * This build renders the loaded instance + its template items (read view),
 * routed by phase via instance.status (open = Phase 1 count; phase1_complete =
 * Phase 2 prep). The interactive count form (Phase 1, reuses the prep form) and
 * collaborative prep grid (Phase 2, reuses OpeningPrepEntry) land in the next
 * build — mid-day needs its own phase-1/phase-2 submit paths (the AM-prep submit
 * writes status='confirmed' + closing auto-complete, which mid-day must NOT do).
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import {
  loadMidDayPrepDashboardState,
  loadMidDayPrepState,
  type MidDayOverUnder,
} from "@/lib/prep";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { ChecklistTemplateItem } from "@/lib/types";

import { MidDayPhase1Form } from "@/components/MidDayPhase1Form";
import { MidDayPhase2Form, type MidDayPhase2Item } from "@/components/MidDayPhase2Form";
import { MidDayPrepTile } from "@/components/MidDayPrepTile";
import { DashboardBackLink } from "@/components/DashboardBackLink";
import type { ManagerOption } from "@/components/opening/OverParModal";

const OPERATIONAL_TZ = "America/New_York";

function nyDateString(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

interface PageProps {
  searchParams: Promise<{ instance?: string; location?: string }>;
}

async function loadAgmPlusManagers(
  sb: ReturnType<typeof getServiceRoleClient>,
  locationId: string,
): Promise<ManagerOption[]> {
  const AGM_PLUS_CODES = ["cgs", "owner", "moo", "gm", "agm", "catering_mgr"];
  const { data: locScoped, error: locErr } = await sb
    .from("user_locations")
    .select("user_id")
    .eq("location_id", locationId);
  if (locErr) throw new Error(`loadAgmPlusManagers: location ids: ${locErr.message}`);
  const locScopedIds = ((locScoped ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  const { data: candidates, error: usersErr } = await sb
    .from("users")
    .select("id, name, role")
    .eq("active", true)
    .in("role", AGM_PLUS_CODES)
    .order("name", { ascending: true });
  if (usersErr) throw new Error(`loadAgmPlusManagers: users: ${usersErr.message}`);
  const result: ManagerOption[] = [];
  for (const u of (candidates ?? []) as Array<{ id: string; name: string; role: string }>) {
    const isGlobal = u.role === "cgs" || u.role === "owner";
    if (isGlobal || locScopedIds.includes(u.id)) result.push({ id: u.id, name: u.name, role: u.role });
  }
  return result;
}

export default async function MidDayPrepPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/operations/mid-day");
  const { instance: instanceId, location: locationParam } = await searchParams;

  const sb = getServiceRoleClient();

  // List mode — entered from the closing checklist's Mid-day Prep ref (?location,
  // no ?instance). Smart-route: exactly 1 instance → straight to it (skip the
  // list per Juan); 0 or 2+ → render the day's list (with a New button under cap).
  if (!instanceId) {
    if (!locationParam) redirect("/dashboard");
    const locActor: LocationActor = { role: auth.role, locations: auth.locations };
    if (!lockLocationContext(locActor, locationParam)) redirect("/dashboard");

    const lang = auth.user.language;
    const today = nyDateString(new Date());
    const dashState = await loadMidDayPrepDashboardState(sb, {
      locationId: locationParam,
      date: today,
      actor: { userId: auth.user.id, role: auth.role, level: auth.level },
    });

    if (dashState.instances.length === 1) {
      redirect(`/operations/mid-day?instance=${dashState.instances[0]!.instanceId}`);
    }

    return (
      <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
        <div className="mb-3">
          <DashboardBackLink />
        </div>
        <h1 className="mb-3 text-lg font-bold text-co-text">
          {serverT(lang, "mid_day_prep.page.title")}
        </h1>
        <MidDayPrepTile
          state={dashState}
          language={lang}
          locationId={locationParam}
          date={today}
        />
      </main>
    );
  }

  const state = await loadMidDayPrepState(sb, { instanceId });
  if (!state) redirect("/dashboard"); // not a mid-day instance, or not found

  const locActor: LocationActor = { role: auth.role, locations: auth.locations };
  if (!lockLocationContext(locActor, state.instance.locationId)) redirect("/dashboard");

  const lang = auth.user.language;

  // Group items by section (station), preserving display order.
  const groups: Array<{ section: string; items: ChecklistTemplateItem[] }> = [];
  const indexBySection = new Map<string, number>();
  for (const item of state.templateItems) {
    const section = item.prepMeta?.section ?? item.station ?? "Misc";
    let gi = indexBySection.get(section);
    if (gi === undefined) {
      gi = groups.length;
      indexBySection.set(section, gi);
      groups.push({ section, items: [] });
    }
    groups[gi]!.items.push(item);
  }

  const phaseHeading =
    state.instance.status === "open"
      ? serverT(lang, "mid_day_prep.page.phase1_heading")
      : serverT(lang, "mid_day_prep.page.phase2_heading");

  // Phase 2 per-item reconcile-on-load state: latest live completion per item
  // (Phase 1 wrote onHand; a Phase 2 save adds total + the saver as completedBy).
  const compByItem = new Map<string, (typeof state.completions)[number]>();
  for (const c of state.completions) {
    const prev = compByItem.get(c.templateItemId);
    if (!prev || c.completedAt > prev.completedAt) compByItem.set(c.templateItemId, c);
  }
  const phase2Items: MidDayPhase2Item[] = state.templateItems.map((item) => {
    const comp = compByItem.get(item.id);
    const onHand = comp?.prepData?.inputs.onHand ?? null;
    const prepped = comp?.prepData?.inputs.total ?? null;
    const par = item.prepMeta?.parValue ?? null;
    const need = par !== null && onHand !== null ? Math.max(par - onHand, 0) : null;
    const savedBy = prepped !== null && comp ? (state.authors[comp.completedBy] ?? null) : null;
    return {
      id: item.id,
      label: item.label,
      section: item.prepMeta?.section ?? item.station ?? "Misc",
      parValue: par,
      parUnit: item.prepMeta?.parUnit ?? null,
      need,
      initialPrepped: prepped,
      initialSavedBy: savedBy,
      initialOverUnder:
        (comp?.prepData as { overUnder?: MidDayOverUnder | null } | undefined)?.overUnder ?? null,
    };
  });

  const managers = await loadAgmPlusManagers(sb, state.instance.locationId);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>

      <p className="text-xs font-bold uppercase tracking-[0.18em] text-co-text-dim">
        {serverT(lang, "mid_day_prep.page.title")}
      </p>
      <h1 className="mt-1 text-lg font-bold text-co-text">{phaseHeading}</h1>

      {state.instance.status === "open" ? (
        <MidDayPhase1Form
          instanceId={state.instance.id}
          items={state.templateItems.map((item) => ({
            id: item.id,
            label: item.label,
            section: item.prepMeta?.section ?? item.station ?? "Misc",
            parValue: item.prepMeta?.parValue ?? null,
            parUnit: item.prepMeta?.parUnit ?? null,
          }))}
        />
      ) : state.instance.status === "phase1_complete" ? (
        <MidDayPhase2Form
          instanceId={state.instance.id}
          items={phase2Items}
          managers={managers}
        />
      ) : (
        <>
          <p className="mt-3 rounded-lg border-2 border-co-border-2 bg-co-surface px-3 py-2 text-[11px] italic leading-snug text-co-text-muted">
            {serverT(lang, "mid_day_prep.page.forms_pending")}
          </p>

          <div className="mt-4 flex flex-col gap-5">
            {groups.map((g) => (
              <section key={g.section}>
                <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-deep">
                  {g.section}
                </h2>
                <ul className="mt-2 flex flex-col gap-1">
                  {g.items.map((item) => {
                    const par = item.prepMeta?.parValue;
                    return (
                      <li
                        key={item.id}
                        className="flex items-center justify-between gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm"
                      >
                        <span className="font-semibold text-co-text">{item.label}</span>
                        {par !== null && par !== undefined ? (
                          <span className="shrink-0 text-xs font-bold uppercase tracking-[0.1em] text-co-text-muted">
                            {serverT(lang, "mid_day_prep.page.section_par")} {par}
                            {item.prepMeta?.parUnit ? ` ${item.prepMeta.parUnit}` : ""}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
