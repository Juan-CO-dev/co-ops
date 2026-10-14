import { hasTaskAccess } from "@/lib/assignments";
/**
 * /operations/mid-day — Mid-day Prep instance surface (C.43).
 *
 * Keyed by ?instance=<id> (NOT location+date) because mid-day prep is
 * multi-instance per day — the dashboard tile creates a numbered instance via
 * POST /api/prep/mid-day and links here with its id.
 *
 * Routed by phase via instance.status: open = Phase 1 count (MidDayPhase1Form);
 * phase1_complete = Phase 2 prep (MidDayPhase2Form); phase2_complete = the
 * read-only FINALIZED view (banner "Finalized at {time} by {name}" + per item
 * need · made, rows from the pure midDayFinalizedRows). Any other status falls
 * to the same read-only rows under a neutral heading. Mid-day has its own
 * phase-1/phase-2 submit paths (the AM-prep submit writes status='confirmed' +
 * closing auto-complete, which mid-day must NOT do).
 */

import { redirect } from "next/navigation";

import { serverT } from "@/lib/i18n/server";
import { formatTime } from "@/lib/i18n/format";
import { lockLocationContext, type LocationActor } from "@/lib/locations";
import {
  loadMidDayPrepDashboardState,
  loadMidDayPrepState,
  type MidDayOverUnder,
} from "@/lib/prep";
import { resolveSectionLabel } from "@/lib/prep-sections";
import { etCalendarDate } from "@/lib/operational-day";
import { requireSessionFromHeaders } from "@/lib/session";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { needForLine, type BatchRowContext } from "@/lib/batch-prep-shared";
import { midDayFinalizedRows, midDayPhase2RowSeed, type MidDayFinalizedRow } from "@/lib/mid-day-shared";
import { formatPrepQty } from "@/lib/prep-display-shared";
import { canEditConsumption } from "@/lib/consumption-edit-shared";

import { MidDayPhase1Form } from "@/components/MidDayPhase1Form";
import { MidDayPhase2Form, type MidDayPhase2Item } from "@/components/MidDayPhase2Form";
import { MidDayPrepTile } from "@/components/MidDayPrepTile";
import { DashboardBackLink } from "@/components/DashboardBackLink";
import type { ManagerOption } from "@/components/opening/OverParModal";

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
    .eq("location_id", locationId)
    .eq("active", true);
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
    const today = etCalendarDate(new Date().toISOString());
    const dashState = await loadMidDayPrepDashboardState(sb, {
      locationId: locationParam,
      date: today,
      actor: { userId: auth.user.id, role: auth.role, level: auth.level },
    });

    if (!dashState.isVisibleToActor) redirect("/dashboard");

    if (dashState.instances.length === 1) {
      redirect(`/operations/mid-day?instance=${dashState.instances[0]!.instanceId}`);
    }

    return (
      <main className="mx-auto w-full max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
        <div className="mb-3">
          <DashboardBackLink />
        </div>
        <h1 className="mb-4 text-lg font-bold text-co-text">
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

  if (!(await hasTaskAccess(sb, { userId: auth.user.id, level: auth.level, locationId: state.instance.locationId, date: state.instance.date, task: "mid_day_prep" }))) redirect("/dashboard");

  const lang = auth.user.language;

  const status = state.instance.status;
  const phaseHeading =
    status === "open"
      ? serverT(lang, "mid_day_prep.page.phase1_heading")
      : status === "phase1_complete"
        ? serverT(lang, "mid_day_prep.page.phase2_heading")
        : status === "phase2_complete"
          ? serverT(lang, "mid_day_prep.page.finalized_heading")
          : serverT(lang, "mid_day_prep.page.readonly_heading");

  // B1 #2 — the read-only finalized view (and the neutral fallback for any other
  // status): per item need · made, grouped by section in template order.
  const finalizedGroups: Array<{ section: string; rows: MidDayFinalizedRow[] }> = [];
  if (status !== "open" && status !== "phase1_complete") {
    const batchModeById: Record<string, boolean> = {};
    for (const [id, ctx] of Object.entries(state.batchContext)) batchModeById[id] = ctx.batchMode === true;
    const indexBySection = new Map<string, number>();
    for (const row of midDayFinalizedRows(state.templateItems, state.completions, batchModeById)) {
      let gi = indexBySection.get(row.section);
      if (gi === undefined) {
        gi = finalizedGroups.length;
        indexBySection.set(row.section, gi);
        finalizedGroups.push({ section: row.section, rows: [] });
      }
      finalizedGroups[gi]!.rows.push(row);
    }
  }
  const finalizedBanner =
    status === "phase2_complete" && state.instance.confirmedAt
      ? serverT(lang, "dashboard.mid_day_prep.finalized_by", {
          time: formatTime(state.instance.confirmedAt, lang),
          name: (state.instance.confirmedBy ? state.authors[state.instance.confirmedBy] : null) ?? "—",
        })
      : null;

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
    const par = item.prepMeta?.parValue ?? null;
    // 0215: on a batch item Phase 1's onHand is LINE and `total` was derived (line + bulk
    // backup), so need_for_line = par − LINE is the same expression; the row also receives
    // the counted BACK UP and the batch context. A non-batch item is untouched.
    const need = par !== null && onHand !== null ? Math.max(par - onHand, 0) : null;
    const ctx = state.batchContext[item.id];
    const batch: BatchRowContext | null = ctx?.batchMode
      ? {
          recipeName: ctx.recipeName,
          yieldPerBatch: ctx.yieldPerBatch ?? 0,
          shelfLifeDays: ctx.shelfLifeDays,
          backupBefore: comp?.prepData?.inputs.backUp ?? null,
          lineCount: onHand,
          need: needForLine(par, onHand),
          parUnit: item.prepMeta?.parUnit ?? null,
          madeOn: state.batchState[item.id]?.madeOn ?? null,
          blocked: ctx.eligibility === "blocked",
          blockedReason: ctx.blockedReason,
        }
      : null;
    // Astra P1 #2: a Phase 1 COUNT is never a Phase 2 save. On a batch item 0215's Phase 1 RPC
    // derives inputs.total (LINE + BACK UP), so only a `batch` object on the live completion
    // counts as saved; every other item keeps the pre-0215 rule (inputs.total = the save).
    // IDENTITY, not eligibility (Astra r2 P1): a batch_mode recipe that cannot resolve is still
    // a batch recipe — its count is never a save, the row stays unsaved (and blocked) until a
    // GM fixes the recipe and the row is saved explicitly.
    const seed = midDayPhase2RowSeed(comp?.prepData, ctx?.batchMode === true);
    return {
      id: item.id,
      itemId: item.itemId,
      derived: state.derived[item.id] ?? [],
      label: item.label,
      section: item.prepMeta?.section ?? item.station ?? "Misc",
      parValue: par,
      parUnit: item.prepMeta?.parUnit ?? null,
      need,
      initialPrepped: seed.initialPrepped,
      initialSaved: seed.saved,
      initialSavedBy: seed.saved && comp ? (state.authors[comp.completedBy] ?? null) : null,
      initialOverUnder:
        (comp?.prepData as { overUnder?: MidDayOverUnder | null } | undefined)?.overUnder ?? null,
      batch,
      batchDerived: state.batchDerived[item.id] ?? [],
      initialBatch: seed.initialBatch,
    };
  });

  const managers = await loadAgmPlusManagers(sb, state.instance.locationId);

  return (
    <main className="mx-auto w-full max-w-2xl md:max-w-3xl lg:max-w-5xl xl:max-w-6xl px-4 pb-32 pt-4 sm:px-6">
      <div className="mb-3">
        <DashboardBackLink />
      </div>

      <p className="text-xs font-bold uppercase tracking-wide text-co-text-muted">
        {serverT(lang, "mid_day_prep.page.title")}
      </p>
      <h1 className="mt-1 text-lg font-bold text-co-text">{phaseHeading}</h1>

      {state.instance.status === "open" ? (
        <MidDayPhase1Form
          instanceId={state.instance.id}
          sectionLabels={state.sectionLabels}
          items={state.templateItems.map((item) => ({
            id: item.id,
            label: item.label,
            section: item.prepMeta?.section ?? item.station ?? "Misc",
            parValue: item.prepMeta?.parValue ?? null,
            parUnit: item.prepMeta?.parUnit ?? null,
            // Identity rule: every batch_mode recipe counts LINE + BACK UP, resolvable or not.
            batchMode: state.batchContext[item.id]?.batchMode === true,
          }))}
        />
      ) : state.instance.status === "phase1_complete" ? (
        <MidDayPhase2Form
          instanceId={state.instance.id}
          items={phase2Items}
          managers={managers}
          sectionLabels={state.sectionLabels}
          todayIso={state.instance.date}
          canEditConsumption={canEditConsumption(auth.level)}
        />
      ) : (
        <>
          {finalizedBanner ? (
            <p className="mt-3 rounded-lg border-2 border-co-success bg-co-success-surface px-3 py-2 text-sm font-semibold text-co-confirm-text">
              {finalizedBanner}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-5">
            {finalizedGroups.map((g) => (
              <section key={g.section}>
                <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-co-gold-text">
                  {resolveSectionLabel(state.sectionLabels, g.section, lang, g.section)}
                </h2>
                <ul className="mt-2 flex flex-col gap-1">
                  {g.rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-md border-2 border-co-border bg-co-surface px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate font-semibold text-co-text">{row.label}</span>
                      <span className="shrink-0 text-right text-xs font-bold uppercase tracking-[0.08em] text-co-text-muted">
                        {serverT(lang, "mid_day_prep.phase1.need")} {formatPrepQty(row.need, row.parUnit)}
                        {" · "}
                        {serverT(lang, "mid_day_prep.page.made")} {formatPrepQty(row.made, row.parUnit)}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
