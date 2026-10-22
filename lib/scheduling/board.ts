/**
 * `loadBoard` — THE BOARD'S ONE LOADER (Scheduling Phase 2, chunk F). Server-only, service role, read-only.
 *
 * Order: the permission rule first (`gate`, before any I/O: the social media manager by ROLE, the catering / prep
 * managers forbidden, below MoO own shops only); then the shop switch (no row / off → OFF, with "turn it on" for MoO+);
 * then the ONE batch load (`loadSchedulingInputs`) — a missing 0274 / 0275 / 0270 table is NOT INSTALLED (the 503 line),
 * never a 500. The head week is shown EXACTLY as saved (the historical contract): each date reads its OWN validation
 * context — the head's, or, for a day an edit carried, its origin revision's (one extra read of those contexts). The
 * suggestion is computed only for an actor with the budget act and only when demand loaded; the current-inputs
 * advisory only when demand loaded. Wages stay SERVER-side: `boardView` uses them for money viewers, and for anyone else
 * only inside the labor-target card's head maths, whose $ lines and fields are then absent (J1); no wage, rate or
 * per-person $ ever reaches the serialized view. No write, no email, no notification.
 */
import { canApproveSchedule, canEditStructure, canManageShopSwitch, canSeeScheduleMoney, scheduleActRefusal } from "./access-shared";
import type { PeopleActor } from "@/lib/people/access-shared";
import { operationalNow } from "@/lib/midshift-shared";
import { selectAllRows } from "@/lib/supabase-paginate";
import { budgetForDates, suggestionHidden } from "./budget-shared";
import { boardView, type BoardSource, type BoardView, type PositionLabel } from "./board-view-shared";
import { ruleContextFromSnapshot, type DayContext } from "./context-shared";
import { ScheduleError } from "./errors-shared";
import { loadScheduleShopSettings, loadSchedulingInputs } from "./inputs";
import { effectiveScheduleRole } from "./works-as-shared";
import { makeSkillLookup } from "./people-input-shared";
import { adviseFromInputs, gate, type ScheduleDeps } from "./schedules";
import { budgetSuggestion } from "./settings";
import { isoWeekStart, weekDays } from "./time-shared";

/** The shop's position labels (en + es). */
export async function loadPositionLabelRows(service: ScheduleDeps["service"], locationId: string): Promise<Array<{ id: string; name: string; name_es: string | null }>> {
  return selectAllRows<{ id: string; name: string; name_es: string | null }>((f, t) => service.from("station_positions")
    .select("id, name, name_es").eq("location_id", locationId).order("id", { ascending: true }).range(f, t));
}

/** The stored validation contexts of the given revisions (the origin of each day an edit carried). */
export async function loadOriginContexts(service: ScheduleDeps["service"], locationId: string, revisionIds: readonly string[]): Promise<Map<string, Record<string, DayContext>>> {
  const out = new Map<string, Record<string, DayContext>>();
  if (revisionIds.length === 0) return out;
  const rows = await selectAllRows<{ revision_id: string; context: unknown }>((f, t) => service.from("schedule_revision_contexts")
    .select("revision_id, context").eq("location_id", locationId).in("revision_id", [...revisionIds]).order("revision_id", { ascending: true }).range(f, t));
  for (const r of rows) out.set(r.revision_id, ruleContextFromSnapshot(r.context).days);
  return out;
}

export type BoardLoad = { state: "off"; canTurnOn: boolean; locationId: string } | { state: "not_installed" } | ({ state: "ready" } & BoardView);

const notInstalled = (e: unknown) => e instanceof ScheduleError && e.code === "inputs_unavailable";

/** Whole ISO weeks from today's week to `weekStart` (0 = this week, 1 = next; never negative). */
function weeksAheadOf(today: string, weekStart: string): number {
  const ms = Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${isoWeekStart(today)}T00:00:00Z`);
  return Math.max(0, Math.round(ms / (7 * 86400000)));
}

export async function loadBoard(deps: ScheduleDeps, args: { actor: PeopleActor; locationId: string; weekStart: string }): Promise<BoardLoad> {
  const { actor, locationId, weekStart } = args;
  await gate(deps.service, actor, locationId, "view");
  let settings;
  try { settings = await loadScheduleShopSettings(deps.service, locationId); } catch (e) { if (notInstalled(e)) return { state: "not_installed" }; throw e; }
  if (!settings.enabled) return { state: "off", canTurnOn: canManageShopSwitch(actor), locationId };
  const now = deps.now ?? new Date();
  let inputs;
  try {
    inputs = await (deps.loadInputs ?? loadSchedulingInputs)(deps.service, { locationId, weekStarts: [weekStart], now });
  } catch (e) {
    if (notInstalled(e)) return { state: "not_installed" };
    throw e;
  }
  const today = operationalNow(now).date;
  const dates = weekDays(weekStart);
  const money = canSeeScheduleMoney(actor, locationId);
  const access = { agmAccess: settings.agmAccess };
  const canBudget = scheduleActRefusal(actor, locationId, "budget", access) === null;
  const w = inputs.weeks[weekStart];
  const head = w?.head ?? null;

  // Each date's OWN context: the head's, else its origin revision's (an edit stores only the edited date's).
  const dayContexts: Record<string, DayContext | null> = {};
  if (head) {
    const missing = head.days.filter((d) => !head.context.days[d.date] && d.originRevisionId && d.originRevisionId !== head.revision.id);
    const originIds = [...new Set(missing.map((d) => d.originRevisionId!))].sort();
    const origin = await loadOriginContexts(deps.service, locationId, originIds);
    for (const date of dates) {
      const rec = head.days.find((d) => d.date === date);
      dayContexts[date] = head.context.days[date] ?? (rec?.originRevisionId ? origin.get(rec.originRevisionId)?.[date] ?? null : null);
    }
  }

  const posRows = await loadPositionLabelRows(deps.service, locationId);
  const structure = inputs.structure.structure;
  const positions: Record<string, PositionLabel> = {};
  for (const r of posRows) {
    const role = structure.positions[r.id]?.role ?? head?.context.days[Object.keys(head.context.days)[0] ?? ""]?.structure.positions[r.id]?.role ?? "line_other";
    positions[r.id] = { name: r.name, nameEs: r.name_es, role };
  }
  const people = head?.context.people ?? {};
  const names: Record<string, string> = Object.fromEntries(inputs.members.map((m) => [m.userId, m.name]));
  const personSettings = new Map(inputs.personSettings.map((s) => [s.userId, s]));
  const roles = Object.fromEntries(inputs.members.map((m) => [m.userId, effectiveScheduleRole(m.role, personSettings.get(m.userId)?.worksAs)]));
  // Server-side only: the view-model drops wages for anyone who may not see money, and uses them for an AGM only inside
  // the labor-target card's HEAD maths (its $ lines and fields are absent then — chunk C's contract).
  const wageCentsByUser: Record<string, number | null> = Object.fromEntries(Object.values(people).map((p) => [p.userId, inputs.wages.byUserCents[p.userId] ?? inputs.shopSettings.estimatedHourlyCents]));
  const demand = inputs.demand.kind;
  const forecastWeekCents = inputs.demand.kind === "ok"
    ? inputs.demand.days.filter((d) => dates.includes(d.date)).reduce((n, d) => n + (d.kind === "ok" ? d.dayCents : 0), 0)
    : null;

  let suggestion: BoardSource["suggestion"] = null;
  if (canBudget && demand !== "unavailable") {
    try {
      const s = await budgetSuggestion(deps, { actor, locationId, weekStart, inputs });
      suggestion = s.kind === "suggestion" && suggestionHidden(s, inputs.keptBudgetDigests) ? null : s;
    } catch (e) {
      if (!(e instanceof ScheduleError)) throw e;
    }
  }
  let advisory: BoardSource["advisory"] = [];
  if (head && demand !== "unavailable") {
    try { advisory = await adviseFromInputs(inputs, weekStart, actor); } catch (e) { if (!(e instanceof ScheduleError)) throw e; }
  }

  const source: BoardSource = {
    locationId, weekStart, today, weeksAhead: weeksAheadOf(today, weekStart),
    perms: {
      canSeeMoney: money, canEdit: scheduleActRefusal(actor, locationId, "edit", access) === null, canApprove: canApproveSchedule(actor, locationId),
      canEditStructure: canEditStructure(actor, locationId), canManageSwitch: canManageShopSwitch(actor), canBudget,
    },
    liveStructureId: inputs.structure.id, demand, names, roles, positions,
    skills: makeSkillLookup(inputs.skills, inputs.skillBands),
    wageCentsByUser, shopEstimateHourlyCents: inputs.shopSettings.estimatedHourlyCents,
    salariedWeeklyCents: inputs.shopSettings.estimatedSalariedWeeklyCents, forecastWeekCents,
    budget: budgetForDates(inputs.budget.entries, inputs.budget.rows, dates), suggestion, advisory,
    week: head && w ? {
      headRevisionId: head.revision.id, approvedRevisionId: w.approvedRevisionId, edited: w.edited, structureVersionId: head.revision.structureVersionId,
      shifts: head.shifts, days: head.days, gaps: head.gaps, reasons: head.reasons, dayContexts, people, closingWindowByDate: head.context.closingWindowByDate,
    } : null,
  };
  return { state: "ready", ...boardView(source) };
}
