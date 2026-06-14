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
import { loadMidDayPrepState } from "@/lib/prep";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import type { ChecklistTemplateItem } from "@/lib/types";

import { MidDayPhase1Form } from "@/components/MidDayPhase1Form";
import { MidDayPhase2Form, type MidDayPhase2Item } from "@/components/MidDayPhase2Form";

interface PageProps {
  searchParams: Promise<{ instance?: string }>;
}

export default async function MidDayPrepPage({ searchParams }: PageProps) {
  const auth = await requireSessionFromHeaders("/operations/mid-day");
  const { instance: instanceId } = await searchParams;
  if (!instanceId) redirect("/dashboard");

  const sb = getServiceRoleClient();
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
      initialReason: comp?.prepData?.inputs.freeText ?? null,
    };
  });

  return (
    <main className="mx-auto max-w-2xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <a
          href="/dashboard"
          aria-label={serverT(lang, "mid_day_prep.page.dashboard_back_aria")}
          className="
            -ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 py-2
            text-xs font-bold uppercase tracking-[0.14em] text-co-text-muted
            transition hover:text-co-text
            focus:outline-none focus-visible:ring-4 focus-visible:ring-co-gold/60
          "
        >
          <span aria-hidden>←</span>
          <span>{serverT(lang, "mid_day_prep.page.dashboard_back")}</span>
        </a>
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
        <MidDayPhase2Form instanceId={state.instance.id} items={phase2Items} />
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
